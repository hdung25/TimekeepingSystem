const puppeteer = require('puppeteer-core');

async function run() {
    try {
        console.log("Fetching Chrome debugging version info...");
        const response = await fetch('http://127.0.0.1:9222/json/version');
        const data = await response.json();
        const webSocketDebuggerUrl = data.webSocketDebuggerUrl;
        console.log("WebSocket URL:", webSocketDebuggerUrl);

        console.log("Connecting to Chrome...");
        const browser = await puppeteer.connect({
            browserWSEndpoint: webSocketDebuggerUrl,
            defaultViewport: { width: 1280, height: 800 }
        });

        console.log("Creating new page...");
        const page = await browser.newPage();
        
        console.log("Navigating to https://timekeeping-system-tawny.vercel.app...");
        await page.goto('https://timekeeping-system-tawny.vercel.app', { waitUntil: 'networkidle2' });

        // Check if we are on the login page
        const isLoginPage = await page.$('input[type="password"]') !== null;
        console.log("Is Login Page:", isLoginPage);

        if (isLoginPage) {
            console.log("Typing login credentials...");
            // Let's find username input. Usually it's input[type="text"] or by id/placeholder
            // Let's inspect the page or just try common selectors
            await page.type('input[type="text"], input[placeholder*="tên"], input[placeholder*="username"], input[name="username"]', 'admin');
            await page.type('input[type="password"]', 'tuduytre');
            
            console.log("Clicking login button...");
            // Click submit or button
            await Promise.all([
                page.click('button[type="submit"], button.btn-login, button'),
                page.waitForNavigation({ waitUntil: 'networkidle2' })
            ]);
            console.log("Logged in successfully!");
        }

        console.log("Current URL after login:", page.url());

        // Wait a bit
        await new Promise(r => setTimeout(r, 2000));

        // Take a screenshot of the main page
        const screenshotPath = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\69810964-74fb-4935-8cd5-87dc24b8bc4b\\screenshot_dashboard.png';
        await page.screenshot({ path: screenshotPath });
        console.log("Screenshot saved to:", screenshotPath);

        // Close page and disconnect
        await page.close();
        await browser.disconnect();
        console.log("Done!");
    } catch (error) {
        console.error("Error occurred:", error);
    }
}

run();
