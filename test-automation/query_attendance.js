const puppeteer = require('puppeteer-core');

async function run() {
    console.log("=== STARTING FIRESTORE QUERY ===");
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        defaultViewport: { width: 1280, height: 800 }
    });

    try {
        const [page] = await browser.pages();

        // Listen for console errors on the page
        page.on('pageerror', error => {
            console.error('[BROWSER ERROR]:', error.message);
        });

        page.on('console', msg => {
            console.log('[BROWSER LOG]:', msg.text());
        });
        
        await page.goto('https://timekeeping-system-tawny.vercel.app', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));
        await page.waitForSelector('#username', { timeout: 10000 });
        await page.type('#username', 'admin');
        await page.type('#password', 'tuduytre');
        await page.click('button.login-btn');
        
        await page.waitForFunction(() => window.location.href.includes('admin.html'), { timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));

        const results = await page.evaluate(async () => {
            if (!window.db) {
                return { error: "window.db not found" };
            }
            
            const results = {};
            
            // 1. Get attendance document
            const attDoc = await window.db.collection('attendance_logs').doc('2026-06-23_nv_1781780950110').get();
            results.attDocExists = attDoc.exists;
            if (attDoc.exists) {
                results.attDocData = attDoc.data();
            }
            
            // 2. Get user config
            const userDoc = await window.db.collection('users').doc('nv_1781780950110').get();
            results.userExists = userDoc.exists;
            if (userDoc.exists) {
                results.userData = userDoc.data();
            }

            return results;
        });

        console.log("=== RESULTS ===");
        console.log(JSON.stringify(results, null, 2));

    } catch (e) {
        console.error("Query failed with error:", e);
        const html = await page.content();
        console.log("Page HTML context length:", html.length);
    } finally {
        await browser.close();
    }
}

run();
