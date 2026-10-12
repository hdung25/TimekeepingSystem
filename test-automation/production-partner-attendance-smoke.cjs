'use strict';
// Public assets and logged-out navigation only; no login and no production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'..'),origin='https://timekeeping-system-tawny.vercel.app';
const assets=['bang-cong-lien-ket.html','mon-hoc.html','js/mon-hoc.js','js/auth-guard.js','js/search-keynav.js','js/evaluation-service.js',
 'js/partner-attendance-policy.js','js/partner-attendance.js','js/partner-attendance-xlsx.js','css/partner-attendance.css','service-worker.js',
 'js/db-service.js','js/report.js','js/admin-payroll-override.js','js/main.js','bao-cao.html','cham-cong.html','lich-lam.html'];
const digest=data=>crypto.createHash('sha256').update(data.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
(async()=>{
 const evidence={origin,checkedAt:new Date().toISOString(),assets:{},browserErrors:[]};
 const results=await Promise.allSettled(assets.map(async asset=>{
  const response=await fetch(origin+'/'+asset+'?v=20261012-linked-v1',{cache:'no-store',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,asset);const remote=Buffer.from(await response.arrayBuffer());
  assert.equal(digest(remote),digest(fs.readFileSync(path.join(root,asset))),'production differs from tested asset: '+asset);
  evidence.assets[asset]={status:response.status,sha256:digest(remote)};
 }));
 assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.message),[]);
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try{
  for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
   const page=await browser.newPage();page.on('pageerror',error=>evidence.browserErrors.push(error.message));
   await page.setViewport(viewport);await page.goto(origin+'/bang-cong-lien-ket.html',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#login-form',{visible:true});
   assert.match(page.url(),/index\.html/,'logged-out users cannot view partner data');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.close();
  }
  assert.deepEqual(evidence.browserErrors,[]);
 }finally{await browser.close();}
 fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'artifacts/production-partner-smoke.json'),JSON.stringify(evidence,null,2));
 console.log('Production verified: '+assets.length+' matching assets, desktop/mobile login guard, no browser errors; no data writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
