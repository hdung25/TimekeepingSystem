'use strict';
const assert = require('node:assert/strict');
module.exports = async ({env, admin, adminDb, staffDb, source, firebase}) => {
    await env.withSecurityRulesDisabled(c => c.firestore().collection('user_roles').doc('fee-senior').set({userId:'senior',role:'senior_assistant'}));
    const seniorDb = env.authenticatedContext('fee-senior').firestore();
    const senior = new Function('db','window','firebase','localStorage','console', source+'\nreturn DBService;')(
        seniorDb, {}, {firestore:firebase.firestore, auth:()=>({currentUser:{uid:'fee-senior'}})}, {getItem:()=> 'Senior'}, {log(){},error(){},warn(){}});
    const id = 'clock-staff', month = '2026-09';
    const ref = adminDb.collection('salary_settings_monthly').doc(`${month}_${id}`);
    const seniorRef = seniorDb.collection('salary_settings_monthly').doc(ref.id);
    const role = {advance:30000, class_rates:{reception:50000}, evaluation:[{id:0,amount:20000},{id:'1',amount:10000,note:'keep'}, {id:6,amount:25000}]};
    const original = {tiep_tan:role, giao_vien:{advance:100}, published:{role:'tiep-tan',status:'published',status_tt:'published',details_tt:{role:'tiep-tan',phiTuVan:10000,netPay:50000}}};
    await ref.set(original);
    await senior.saveConsultationFee(id, month, 81675, role);
    let data = (await ref.get()).data();
    assert.equal(data.tiep_tan.evaluation[1].amount,81675);
    assert.equal(data.consultationFeePending,true);
    assert.deepEqual(data.published,original.published);
    assert.deepEqual(data.tiep_tan.evaluation[2],role.evaluation[2]);
    await assert.rejects(senior.saveConsultationFee(id,month,1,role), /phiên khác/);
    await assert.rejects(staffDb.collection('salary_settings_monthly').doc(ref.id).update({'tiep_tan.evaluation':[{id:1,amount:12}]}), {code:'permission-denied'});
    const attack = async patch => assert.rejects(seniorRef.update({consultationFeeEdit:{...data.consultationFeeEdit, updatedAt:firebase.firestore.FieldValue.serverTimestamp()}, consultationFeePending:true, ...patch}), {code:'permission-denied'});
    await attack({'tiep_tan.advance':0});
    await attack({'tiep_tan.class_rates':{reception:999999}});
    await attack({'giao_vien.advance':0});
    await attack({published:{role:'tiep-tan',status:'published',netPay:999999}});
    await attack({'tiep_tan.evaluation':[{id:6,amount:999999}]});
    await attack({consultationFeePending:false});
    await attack({'tiep_tan.evaluation':[...data.tiep_tan.evaluation, {id:1, amount:81675, note:''}]});
    await assert.rejects(seniorRef.delete(),{code:'permission-denied'});
    await assert.rejects(admin.publishPayslipComponents(id,month,{tt:true}), /Phí tư vấn/);
    await assert.rejects(admin.savePayslipDraft(id,month,{...original.published,details_tt:{phiTuVan:10000}},'tt',{allowRevisionDraft:true}), /Phí tư vấn/);
    await senior.saveConsultationFee(id,month,0,data.tiep_tan);
    data = (await ref.get()).data();
    assert.equal(data.tiep_tan.evaluation[1].amount,0);
    const payload = {...original.published, details_tt:{role:'tiep-tan',phiTuVan:0,netPay:40000}};
    await admin.savePayslipDraft(id,month,payload,'tt',{allowRevisionDraft:true});
    data = (await ref.get()).data();
    assert.equal(data.consultationFeePending,false);
    assert.deepEqual(data.published,original.published);
    const draft = data.revisionDrafts.tt;
    await senior.saveConsultationFee(id,month,123,data.tiep_tan);
    await assert.rejects(admin.publishPayslipRevision(id,month,'tt',draft.sourceToken,draft.version,'test'), /Phí tư vấn/);
    // First month and legacy hyphenated role both remain editable with narrow writes.
    await adminDb.collection('salary_settings').doc(id).set({advance:123, evaluation:[{id:0,amount:500}], class_rates:{reception:55555}});
    await senior.saveConsultationFee(id,'2026-08',100,{});
    const firstMonth = (await adminDb.collection('salary_settings_monthly').doc(`2026-08_${id}`).get()).data().tiep_tan;
    assert.equal(firstMonth.evaluation[1].amount,100);
    assert.equal(firstMonth.evaluation[0].amount,500);
    assert.equal(firstMonth.advance,123);
    assert.equal(firstMonth.class_rates.reception,55555);
    await ref.set({'tiep-tan':{evaluation:[{id:0,amount:1}]}});
    await senior.saveConsultationFee(id,month,5,{evaluation:[{id:0,amount:1}]});
    data = (await ref.get()).data();
    assert.equal(data['tiep-tan'].evaluation[1].amount,5);
    assert.equal(data.tiep_tan,undefined);
    await assert.rejects(senior.saveConsultationFee(id,month,-1,data['tiep-tan']));

    // A historical writer saved one criterion as a map instead of a list.
    // Accept only its lossless conversion during the permitted fee edit.
    for (const key of ['tiep_tan', 'tiep-tan']) {
        const oldRow = {id:'1', amount:123, note:'keep legacy note', source:'legacy'};
        const oldRole = {...role, evaluation:oldRow};
        const legacyDocument = {[key]:oldRole, giao_vien:original.giao_vien, published:original.published};
        await ref.set(legacyDocument);
        const changedRow = {...oldRow, amount:81675};
        const legacyAttack = async (evaluation, patch = {}) => assert.rejects(seniorRef.update({
            [`${key}.evaluation`]:evaluation,
            consultationFeePending:true,
            consultationFeeEdit:{staffId:id, month, amount:81675, actorUid:'fee-senior', updatedAt:firebase.firestore.FieldValue.serverTimestamp()},
            ...patch
        }), {code:'permission-denied'});
        await legacyAttack([{...changedRow, id:6}]);
        await legacyAttack([{...changedRow, note:'changed'}]);
        await legacyAttack([{...changedRow, source:'forged'}]);
        await legacyAttack([{id:'1', amount:81675, note:oldRow.note}]);
        await legacyAttack([changedRow, {id:6,amount:999999}]);
        await legacyAttack(changedRow);
        await legacyAttack([changedRow], {[`${key}.advance`]:0});
        await legacyAttack([changedRow], {published:{...original.published,netPay:999999}});
        await senior.saveConsultationFee(id,month,81675,oldRole);
        data = (await ref.get()).data();
        assert.deepEqual(data[key], {...oldRole,evaluation:[changedRow]});
        assert.deepEqual(data.published,original.published);
        assert.deepEqual(data.giao_vien,original.giao_vien);
        assert.equal(data.consultationFeePending,true);
        await senior.saveConsultationFee(id,month,0,data[key]);
        data = (await ref.get()).data();
        assert.deepEqual(data[key].evaluation,[{...oldRow,amount:0}]);
    }

    // A single unrelated legacy criterion must survive adding the missing fee.
    const unrelatedRow = {id:6,amount:45000,note:'preserve bonus'};
    const bonusRole = {...role,evaluation:unrelatedRow};
    await ref.set({tiep_tan:bonusRole,published:original.published});
    const fee = {id:1,amount:0,note:''};
    await assert.rejects(seniorRef.update({
        'tiep_tan.evaluation':[{...unrelatedRow,amount:0},fee],
        consultationFeePending:true,
        consultationFeeEdit:{staffId:id,month,amount:0,actorUid:'fee-senior',updatedAt:firebase.firestore.FieldValue.serverTimestamp()}
    }), {code:'permission-denied'});
    await senior.saveConsultationFee(id,month,0,bonusRole);
    data = (await ref.get()).data();
    assert.deepEqual(data.tiep_tan.evaluation,[unrelatedRow,fee]);
    assert.equal(data.tiep_tan.advance,role.advance);
    assert.deepEqual(data.published,original.published);
    console.log('PASS senior fee save/zero/legacy single-map/new month, unrelated writes denied, stale calculation and revision sends blocked');
};
