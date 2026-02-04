const Archiver = {
    // 1. Scan for Old Data
    async scanOldData(days) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffDateStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

        console.log(`Scanning for logs before ${cutoffDateStr}...`);

        try {
            // Firestore Query: ID < cutoffDateStr
            // Using FieldPath.documentId() for lexicographical comparison works because our IDs are YYYY-MM-DD_UserID
            const snapshot = await db.collection('attendance_logs')
                .where(firebase.firestore.FieldPath.documentId(), '<', cutoffDateStr)
                .get();

            if (snapshot.empty) {
                return { count: 0, docs: [] };
            }

            const docs = [];
            snapshot.forEach(doc => {
                docs.push({ id: doc.id, ...doc.data() });
            });

            return { count: docs.length, docs, cutoffDateStr };

        } catch (error) {
            console.error("Scan Error:", error);
            throw error;
        }
    },

    // 2. Export to Excel (CSV)
    exportToCSV(docs) {
        if (!docs || docs.length === 0) return;

        // Header
        const headers = ["Ngày Tháng", "Họ Tên", "Giờ Vào", "Giờ Ra", "Ghi Chú ID"];

        // Rows
        const rows = docs.map(doc => {
            // Format Date: doc.date or extract from ID
            const date = doc.date || doc.id.split('_')[0];

            // Format Time
            let checkIn = doc.checkIn ? new Date(doc.checkIn).toLocaleTimeString('vi-VN') : '';
            if (!checkIn && doc.sessions && doc.sessions.length > 0) {
                checkIn = new Date(doc.sessions[0].start).toLocaleTimeString('vi-VN');
            }

            let checkOut = doc.checkOut ? new Date(doc.checkOut).toLocaleTimeString('vi-VN') : '';
            if (!checkOut && doc.sessions && doc.sessions.length > 0) {
                // Get last session checkout
                const last = doc.sessions[doc.sessions.length - 1];
                if (last.checkOut) checkOut = new Date(last.checkOut).toLocaleTimeString('vi-VN');
            }

            return [
                date,
                `"${doc.name || 'Không tên'}"`, // Quote name to handle commas
                checkIn,
                checkOut,
                doc.id
            ].join(",");
        });

        // Combine
        const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n"); // Add BOM for Excel UTF-8

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Backup_ChamCong_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // 3. Delete Data
    async deleteData(docIds) {
        const batchSize = 400; // Limit is 500
        const batches = [];
        let batch = db.batch();
        let count = 0;

        docIds.forEach((id, index) => {
            const ref = db.collection('attendance_logs').doc(id);
            batch.delete(ref);
            count++;

            if (count >= batchSize || index === docIds.length - 1) {
                batches.push(batch.commit());
                batch = db.batch();
                count = 0;
            }
        });

        await Promise.all(batches);
        return true;
    }
};

window.Archiver = Archiver;
