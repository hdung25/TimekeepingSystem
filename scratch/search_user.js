const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // I assume it might exist or I can use project ID

admin.initializeApp({
  credential: admin.credential.applicationDefault(), // or just project ID if running locally with auth
  projectId: 'thanhphat-654fe'
});

const db = admin.firestore();

async function search() {
  const snapshot = await db.collection('users').get();
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.username?.toLowerCase().includes('huy') || data.name?.toLowerCase().includes('huy')) {
      console.log('ID:', doc.id);
      console.log('Data:', JSON.stringify(data, null, 2));
    }
  });
}

search();
