const puppeteer = require('puppeteer-core');

async function verify() {
    console.log("=== STARTING LIVE TIMEKEEPING VERIFICATION ===");
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
            if (msg.type() === 'error') {
                console.error('[BROWSER CONSOLE ERROR]:', msg.text());
            } else {
                console.log('[BROWSER LOG]:', msg.text());
            }
        });

        console.log("1. Navigating to Login Page...");
        await page.goto('https://timekeeping-system-tawny.vercel.app', { waitUntil: 'load' });

        console.log("2. Waiting 3 seconds for service worker/page stability...");
        await new Promise(r => setTimeout(r, 3000));

        console.log("3. Waiting for login elements and typing credentials...");
        await page.waitForSelector('#username', { timeout: 10000 });
        await page.type('#username', 'admin');
        await page.type('#password', 'tuduytre');

        console.log("4. Submitting credentials...");
        await page.click('button.login-btn');

        console.log("5. Waiting for dashboard navigation...");
        try {
            await page.waitForFunction(() => window.location.href.includes('admin.html'), { timeout: 15000 });
            console.log("Success: Logged in and reached admin.html!");
        } catch (e) {
            const errorText = await page.evaluate(() => {
                const errDiv = document.getElementById('login-error');
                return errDiv ? errDiv.innerText : null;
            });
            console.error("Login navigation failed. Screen error message:", errorText);
            throw e;
        }

        console.log("6. Navigating to cham-cong.html (Timekeeping)...");
        await page.goto('https://timekeeping-system-tawny.vercel.app/cham-cong.html', { waitUntil: 'load' });
        console.log("Timekeeping page loaded successfully!");

        console.log("7. Navigating to bao-cao.html (Report)...");
        await page.goto('https://timekeeping-system-tawny.vercel.app/bao-cao.html', { waitUntil: 'load' });
        console.log("Reports page loaded successfully!");

        console.log("=== VERIFICATION PASSED ===");
    } catch (err) {
        console.error("Verification failed with error:", err);
    } finally {
        await browser.close();
        console.log("=== BROWSER CLOSED ===");
    }
}

verify();
