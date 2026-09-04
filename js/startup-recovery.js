// Lightweight startup watchdog for staff-facing pages.
// It deliberately has no Firebase or Firestore dependency and never changes
// attendance, schedule, payroll, or browser authentication state.
(function installStartupRecoveryWatchdog() {
    const pageName = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const requiredModules = ['core'];
    if (pageName === 'bao-cao.html') requiredModules.push('report');
    if (pageName === 'cham-cong.html') requiredModules.push('timekeeping');

    const readyModules = new Set();
    let watchdogId = null;

    const syncKnownReadyModules = () => {
        // A bundle can be evaluated yet stop while restoring authentication or
        // initializing its first screen. Only an explicit ready signal can
        // suppress the recovery notice.
        if (window.__TDT_CORE_BOOTSTRAP_READY__) readyModules.add('core');
        if (window.__TDT_REPORT_BOOTSTRAP_READY__) readyModules.add('report');
        if (window.__TDT_TIMEKEEPING_BOOTSTRAP_READY__) readyModules.add('timekeeping');
    };
    const isReady = () => {
        syncKnownReadyModules();
        return requiredModules.every(moduleName => readyModules.has(moduleName));
    };
    const stopWhenReady = () => {
        if (isReady() && watchdogId) {
            window.clearTimeout(watchdogId);
            watchdogId = null;
        }
    };

    const markReady = moduleName => {
        readyModules.add(moduleName);
        stopWhenReady();
    };

    window.addEventListener('tdt:app-core-ready', () => markReady('core'));
    window.addEventListener('tdt:report-ready', () => markReady('report'));
    window.addEventListener('tdt:timekeeping-ready', () => markReady('timekeeping'));

    const showRecoveryMessage = () => {
        if (isReady() || document.getElementById('tdt-startup-recovery')) return;

        const mount = () => {
            if (isReady() || document.getElementById('tdt-startup-recovery')) return;
            if (!document.body) {
                window.setTimeout(mount, 50);
                return;
            }

            const notice = document.createElement('section');
            notice.id = 'tdt-startup-recovery';
            notice.setAttribute('role', 'alert');
            notice.style.cssText = [
                'position:fixed', 'left:16px', 'right:16px', 'bottom:16px',
                'z-index:10001', 'max-width:520px', 'margin:auto',
                'padding:16px', 'border:1px solid #FDE68A', 'border-radius:12px',
                'background:#FFFBEB', 'box-shadow:0 12px 32px rgba(0,0,0,.16)',
                'color:#78350F', 'font:500 14px/1.5 system-ui,sans-serif'
            ].join(';');

            const text = document.createElement('p');
            text.style.margin = '0 0 12px';
            text.textContent = 'Ứng dụng chưa tải xong. Vui lòng kiểm tra kết nối rồi tải lại trang.';

            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Tải lại';
            retry.style.cssText = 'border:0;border-radius:8px;padding:9px 14px;background:#059669;color:#fff;font-weight:700;cursor:pointer;';
            retry.addEventListener('click', () => window.location.reload());

            notice.append(text, retry);
            document.body.appendChild(notice);
        };

        mount();
    };

    // A genuine slow mobile network may need a few seconds for Firebase. This
    // only reports a blocked script/module after a generous, read-only wait.
    watchdogId = window.setTimeout(showRecoveryMessage, 18000);
})();
