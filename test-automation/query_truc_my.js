const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function run() {
    console.log("=== STARTING FIRESTORE QUERY FOR PHAM THI TRUC MY ===");
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false, // Run headful to avoid bot-detection block
        defaultViewport: { width: 1280, height: 800 }
    });

    try {
        const [page] = await browser.pages();
        
        // Listen to console events in page
        page.on('console', msg => console.log('[PAGE CONSOLE]', msg.text()));

        console.log("Navigating to Timekeeping System...");
        await page.goto('https://timekeeping-system-tawny.vercel.app', { waitUntil: 'networkidle2' });

        // Let's check if we're already logged in
        const currentUrl = page.url();
        console.log("Initial URL:", currentUrl);
        
        if (currentUrl.includes('admin.html')) {
            console.log("Already logged in as admin!");
        } else {
            console.log("Logging in as admin...");
            await page.type('#username', 'admin');
            await page.type('#password', 'tuduytre');
            await page.click('button.login-btn');
            
            console.log("Waiting for redirection...");
            try {
                await page.waitForFunction(() => window.location.href.includes('admin.html'), { timeout: 15000 });
                console.log("Login successful! Redirected to admin.html.");
            } catch (waitErr) {
                console.log("Redirect failed or timed out.");
                const errorText = await page.evaluate(() => {
                    const errEl = document.getElementById('login-error');
                    return errEl ? errEl.innerText : 'No login error element';
                });
                console.log("Page Error Text:", errorText);
                console.log("Current page URL is:", page.url());
                throw new Error("Login failed: " + errorText);
            }
        }

        // Wait an extra 2 seconds to make sure firebase DB is ready
        await new Promise(r => setTimeout(r, 2000));

        // Query Firestore inside the page context
        const data = await page.evaluate(async () => {
            if (!window.db) {
                return { error: "window.db not found" };
            }
            
            const results = {};
            
            // 1. Get user document for "PHẠM THỊ TRÚC MY"
            const usersSnapshot = await window.db.collection('users').get();
            let trucMyUser = null;
            const allUsers = [];
            usersSnapshot.forEach(doc => {
                const u = doc.data();
                u.id = doc.id;
                allUsers.push(u);
                if (u.fullName && (u.fullName.toUpperCase().includes('TRÚC MY') || u.fullName.toUpperCase().includes('TRÚC MỸ'))) {
                    trucMyUser = u;
                }
            });
            results.trucMyUser = trucMyUser;

            if (!trucMyUser) {
                return { error: "User PHẠM THỊ TRÚC MY not found in users collection", allUsers: allUsers.map(u => ({ id: u.id, fullName: u.fullName, username: u.username })) };
            }

            const staffId = trucMyUser.id;
            results.staffId = staffId;
            results.username = trucMyUser.username;

            // 2. Query receptionist schedules (receptionist_schedules)
            const recepSnap = await window.db.collection('receptionist_schedules').get();
            const receptionistSchedules = [];
            recepSnap.forEach(doc => {
                const docData = doc.data();
                for (const shiftKey in docData) {
                    if (shiftKey.startsWith('_')) continue;
                    const shiftData = docData[shiftKey];
                    for (const dayKey in shiftData) {
                        const assignees = shiftData[dayKey];
                        if (Array.isArray(assignees)) {
                            for (const ass of assignees) {
                                if (ass.id === staffId || ass.id === trucMyUser.username || (ass.name && (ass.name.toUpperCase().includes('TRÚC MY') || ass.name.toUpperCase().includes('TRÚC MỸ')))) {
                                    receptionistSchedules.push({
                                        weekKey: doc.id,
                                        shift: shiftKey,
                                        day: dayKey,
                                        assignment: ass
                                    });
                                }
                            }
                        }
                    }
                }
            });
            results.receptionistSchedules = receptionistSchedules;

            // 3. Query teacher schedules (schedules)
            const schedulesSnap = await window.db.collection('schedules').get();
            const teacherSchedules = [];
            schedulesSnap.forEach(doc => {
                const dateId = doc.id;
                const docData = doc.data();
                for (const classKey in docData) {
                    if (classKey.startsWith('_')) continue;
                    const classShift = docData[classKey];
                    if (classShift.registeredTeachers) {
                        for (const tId in classShift.registeredTeachers) {
                            if (tId === staffId || tId === trucMyUser.username) {
                                teacherSchedules.push({
                                    dateId,
                                    classKey,
                                    shiftName: classShift.shiftName,
                                    role: classShift.registeredTeachers[tId]
                                });
                            }
                        }
                    }
                    if (classShift.teacherId === staffId || classShift.teacherId === trucMyUser.username) {
                        teacherSchedules.push({
                            dateId,
                            classKey,
                            shiftName: classShift.shiftName,
                            role: 'teacher'
                        });
                    }
                }
            });
            results.teacherSchedules = teacherSchedules;

            // 4. Query attendance logs for Truc My
            const attendanceSnap = await window.db.collection('attendance_logs')
                .where('userId', '==', staffId)
                .get();
            const attendanceLogs = [];
            attendanceSnap.forEach(doc => {
                attendanceLogs.push({ id: doc.id, ...doc.data() });
            });
            results.attendanceLogs = attendanceLogs.sort((a, b) => b.checkInTime - a.checkInTime).slice(0, 20); // get last 20 logs

            return results;
        });

        console.log("=== RESULTS ===");
        console.log(JSON.stringify(data, null, 2));

        // Save results to file
        const outPath = path.join(__dirname, 'query_results.json');
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
        console.log("Saved results to:", outPath);

    } catch (e) {
        console.error("Query failed with error:", e);
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
}

run();
