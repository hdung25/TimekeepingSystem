// Migration Tool
// Script này chỉ dùng 1 lần để chuyển dữ liệu từ LocalStorage lên Firebase

const MigrationTool = {
    async migrateAll() {
        if (!confirm('Bạn có chắc muốn đẩy toàn bộ dữ liệu từ máy này lên Cloud không? Hành động này nên chỉ làm 1 lần.')) return;

        const statusDiv = document.getElementById('migration-status');
        if (statusDiv) statusDiv.innerHTML = 'Đang xử lý... vui lòng không tắt trình duyệt.';

        try {
            await this.migrateUsers();
            await this.migrateSchedules();
            await this.migrateAttendance();

            alert('Đồng bộ dữ liệu thành công! Bây giờ dữ liệu đã an toàn trên Cloud.');
            if (statusDiv) statusDiv.innerHTML = '<span style="color: green;">Đồng bộ hoàn tất!</span>';
        } catch (error) {
            console.error(error);
            alert('Có lỗi xảy ra: ' + error.message);
            if (statusDiv) statusDiv.innerHTML = '<span style="color: red;">Lỗi: ' + error.message + '</span>';
        }
    },

    async migrateUsers() {
        const users = JSON.parse(localStorage.getItem('users_data')) || [];
        const salarySettings = JSON.parse(localStorage.getItem('salary_settings')) || {};

        const batch = db.batch();
        let count = 0;

        users.forEach(user => {
            const userRef = db.collection('users').doc(user.id); // Use existing ID
            const salary = salarySettings[user.id] || { rate: 0, attendance: 0 };

            batch.set(userRef, {
                ...user,
                salary_config: salary,
                migratedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            count++;
        });

        if (count > 0) await batch.commit();
        console.log(`Migrated ${count} users.`);
    },

    async migrateSchedules() {
        const scheduleData = JSON.parse(localStorage.getItem('schedule_data')) || {};
        // scheduleData structure: { "2023-10-27": { morning1: [...], ... } }

        const batch = db.batch();
        let count = 0;

        for (const [dateKey, sections] of Object.entries(scheduleData)) {
            const docRef = db.collection('schedules').doc(dateKey);
            batch.set(docRef, sections);
            count++;

            // Limit batch size (Firestore limit is 500)
            if (count % 400 === 0) {
                await batch.commit();
                // Create new batch
            }
        }

        if (count > 0 && count % 400 !== 0) await batch.commit();
        console.log(`Migrated schedules for ${count} days.`);
    },

    async migrateAttendance() {
        const attendanceData = JSON.parse(localStorage.getItem('attendance_data')) || {};
        const batch = db.batch();
        let count = 0;

        for (const [dateKey, sessions] of Object.entries(attendanceData)) {
            // attendanceData: { "2023-10-01": [ {id, checkIn, checkOut} ] }
            // We can store this as a daily log
            const docRef = db.collection('attendance').doc(dateKey);
            batch.set(docRef, { sessions: sessions });
            count++;
        }

        if (count > 0) await batch.commit();
        console.log(`Migrated attendance for ${count} days.`);
    }
};
