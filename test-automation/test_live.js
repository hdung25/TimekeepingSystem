const puppeteer = require('puppeteer-core');

async function run() {
    console.log("=== STARTING LIVE BROWSER AUTOMATION TEST ===");
    console.log("Launching headful Google Chrome...");
    
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false, // Run in headful mode so the user can watch
        slowMo: 150,     // Slow down operations by 150ms so actions are clearly visible
        defaultViewport: { width: 1280, height: 800 },
        args: ['--start-maximized']
    });

    try {
        const [page] = await browser.pages();
        
        // Handle dialogs (alerts/confirmations)
        page.on('dialog', async dialog => {
            console.log(`[DIALOG] Type: ${dialog.type().toUpperCase()} - Message: "${dialog.message()}"`);
            await new Promise(r => setTimeout(r, 1500)); // Pause 1.5s so user can see dialog
            await dialog.accept();
            console.log(`[DIALOG] Accepted`);
        });

        console.log("Navigating to Timekeeping System...");
        await page.goto('https://timekeeping-system-tawny.vercel.app', { waitUntil: 'networkidle2' });

        console.log("Checking for login form...");
        const isLoginPage = await page.$('input[type="password"]') !== null;
        
        if (isLoginPage) {
            console.log("Filling username: 'admin'...");
            await page.type('#username', 'admin');
            
            console.log("Filling password: '••••••••'...");
            await page.type('#password', 'tuduytre');
            
            console.log("Clicking Log In button...");
            await page.click('button.login-btn');
            
            console.log("Waiting for redirection to admin dashboard...");
            await page.waitForFunction(() => window.location.href.includes('admin.html'), { timeout: 15000 });
            console.log("Login successful! Redirected to admin.html.");
        } else {
            console.log("Already logged in or bypassed login page.");
        }

        console.log("Current URL:", page.url());
        await new Promise(r => setTimeout(r, 2000)); // Pause to let user see dashboard

        console.log("Navigating to System Settings (he-thong.html)...");
        const origin = new URL(page.url()).origin;
        await page.goto(`${origin}/he-thong.html`, { waitUntil: 'networkidle2' });
        console.log("System Settings page loaded.");
        await new Promise(r => setTimeout(r, 2000));

        console.log("--- Testing Center Closures (Quản Lý Tắt Lớp) ---");
        
        // Fill out the closure form
        const testDate = '2026-06-25'; // A future date for testing
        console.log(`Selecting date: ${testDate}...`);
        await page.type('#closure-date', '25062026'); // input[type="date"] format on Windows Chrome is DD/MM/YYYY
        
        console.log("Selecting shift: 'Ca Sáng 1'...");
        await page.select('#closure-shift', 'morning1');

        console.log("Clicking 'Thêm Ngày Nghỉ' button...");
        await page.click('#add-closure-form button[type="submit"]');

        console.log("Waiting for closure to be added to list...");
        await new Promise(r => setTimeout(r, 3000));

        // Take a screenshot of the settings page showing the added closure
        const screenshotPathAdded = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\69810964-74fb-4935-8cd5-87dc24b8bc4b\\screenshot_closure_added.png';
        await page.screenshot({ path: screenshotPathAdded });
        console.log(`Saved screenshot showing closure added: ${screenshotPathAdded}`);

        console.log("Deleting the test closure...");
        // Click the delete button for the closure we just added
        const deleteButton = await page.$('.closure-item button.btn-delete');
        if (deleteButton) {
            console.log("Clicking delete button...");
            await deleteButton.click();
            await new Promise(r => setTimeout(r, 3000));
        } else {
            console.log("WARNING: Delete button not found!");
        }

        // Take a screenshot showing closure deleted
        const screenshotPathDeleted = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\69810964-74fb-4935-8cd5-87dc24b8bc4b\\screenshot_closure_deleted.png';
        await page.screenshot({ path: screenshotPathDeleted });
        console.log(`Saved screenshot showing closure deleted: ${screenshotPathDeleted}`);

        console.log("--- Testing Complete ---");
        console.log("Leaving browser open for 5 seconds for user to view the clean state...");
        await new Promise(r => setTimeout(r, 5000));

    } catch (e) {
        console.error("Test failed with error:", e);
    } finally {
        console.log("Closing browser...");
        await browser.close();
        console.log("=== LIVE BROWSER AUTOMATION TEST FINISHED ===");
    }
}

run();
