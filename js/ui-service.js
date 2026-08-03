window.getIconHtml = function(name, attrs = {}) {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        const tempDiv = document.createElement('div');
        const i = document.createElement('i');
        i.setAttribute('data-lucide', name);
        
        const mergedAttrs = Object.assign({
            width: '18',
            height: '18',
            'stroke-width': '2',
            'stroke': 'currentColor',
            'fill': 'none',
            class: 'lucide-icon lucide-' + name
        }, attrs);
        
        for (const [key, value] of Object.entries(mergedAttrs)) {
            i.setAttribute(key, value);
        }
        
        tempDiv.appendChild(i);
        window.lucide.createIcons({ root: tempDiv });
        return tempDiv.innerHTML;
    }
    return `<span class="icon-fallback" data-name="${name}"></span>`;
};

const UIService = {
    init() {
        if (!document.querySelector('.toast-container')) {
            const container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
    },

    showLoading(message = 'Đang xử lý...') {
        let overlay = document.getElementById('global-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'global-loading-overlay';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; transition: opacity 0.2s;';
            document.body.appendChild(overlay);
        }
        
        overlay.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.75rem; background: white; padding: 1.5rem 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid rgba(229, 231, 235, 0.5);">
                <i data-lucide="loader-2" class="animate-spin" style="width: 36px; height: 36px; color: var(--primary-color);"></i>
                <span style="font-weight: 600; color: #374151; font-size: 0.95rem;">${message}</span>
            </div>
        `;
        
        overlay.style.opacity = '0';
        overlay.style.display = 'flex';
        // Force reflow
        overlay.offsetHeight;
        overlay.style.opacity = '1';
        
        if (window.lucide) {
            window.lucide.createIcons({ root: overlay });
        }
    },

    hideLoading() {
        const overlay = document.getElementById('global-loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 200);
        }
    },

    toast(message, type = 'info') {
        this.init();
        const container = document.querySelector('.toast-container');

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        // Icons based on type
        let iconName = 'info';
        let strokeColor = 'currentColor';
        if (type === 'success') { iconName = 'check-circle'; strokeColor = '#10B981'; }
        if (type === 'error') { iconName = 'x-circle'; strokeColor = '#EF4444'; }
        if (type === 'warning') { iconName = 'alert-triangle'; strokeColor = '#F59E0B'; }
        if (type === 'info') { iconName = 'info'; strokeColor = '#3B82F6'; }

        const iconHtml = window.getIconHtml(iconName, { stroke: strokeColor, width: '20', height: '20' });

        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="display: flex; align-items: center;">${iconHtml}</span>
                <span style="font-weight: 500;">${message}</span>
            </div>
        `;

        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    },

    // Async Confirm Dialog
    confirm(message) {
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'custom-modal-backdrop';

            backdrop.innerHTML = `
                <div class="custom-modal-box">
                    <h3 style="margin-bottom: 0.5rem; color: var(--primary-color);">Xác Nhận</h3>
                    <p style="color: var(--text-muted); margin-bottom: 1rem;">${message}</p>
                    <div class="custom-modal-actions">
                        <button id="modal-cancel-btn" class="btn" style="background: #E5E7EB; color: #374151;">Hủy bỏ</button>
                        <button id="modal-confirm-btn" class="btn btn-primary">Đồng ý</button>
                    </div>
                </div>
            `;

            document.body.appendChild(backdrop);

            const btnConfirm = backdrop.querySelector('#modal-confirm-btn');
            const btnCancel = backdrop.querySelector('#modal-cancel-btn');

            const close = (result) => {
                backdrop.remove();
                resolve(result);
            };

            btnConfirm.onclick = () => close(true);
            btnCancel.onclick = () => close(false);

            // Close on click outside
            backdrop.onclick = (e) => {
                if (e.target === backdrop) close(false);
            };
        });
    },

    // Popup 1 nút — dùng cho thông báo BẮT BUỘC phải đọc (VD giờ chấm công
    // không đủ điều kiện sớm 10p). Toast tự biến mất nên không dùng ở đây được.
    notice(message, title = 'Thông báo', tone = 'warning') {
        return new Promise((resolve) => {
            const palette = {
                warning: { color: '#B45309', bg: '#FFFBEB', border: '#FDE68A', icon: 'alert-triangle' },
                error: { color: '#B91C1C', bg: '#FEF2F2', border: '#FECACA', icon: 'x-circle' },
                success: { color: '#047857', bg: '#ECFDF5', border: '#A7F3D0', icon: 'check-circle' },
                info: { color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE', icon: 'info' }
            };
            const theme = palette[tone] || palette.warning;
            const safeText = String(message == null ? '' : message)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');

            const backdrop = document.createElement('div');
            backdrop.className = 'custom-modal-backdrop';
            backdrop.innerHTML = `
                <div class="custom-modal-box" style="max-width: 420px;">
                    <div style="display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.85rem;">
                        <span style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:${theme.bg};border:1px solid ${theme.border};color:${theme.color};">
                            <i data-lucide="${theme.icon}" style="width:20px;height:20px;"></i>
                        </span>
                        <div style="flex:1;min-width:0;">
                            <h3 style="margin:0 0 0.35rem;font-size:1rem;font-weight:700;color:${theme.color};">${title}</h3>
                            <p style="margin:0;color:#4B5563;font-size:0.9rem;line-height:1.55;">${safeText}</p>
                        </div>
                    </div>
                    <div class="custom-modal-actions">
                        <button id="modal-notice-btn" class="btn btn-primary" style="width:100%;">Đã hiểu</button>
                    </div>
                </div>
            `;
            document.body.appendChild(backdrop);
            if (window.lucide) window.lucide.createIcons({ root: backdrop });

            const close = () => { backdrop.remove(); resolve(true); };
            backdrop.querySelector('#modal-notice-btn').onclick = close;
            backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
        });
    }
};

// Override native alert
window.alert = (msg) => {
    // Basic heuristic to detect type
    let type = 'info';
    if (msg.toLowerCase().includes('lỗi') || msg.toLowerCase().includes('không')) type = 'error';
    if (msg.toLowerCase().includes('thành công') || msg.toLowerCase().includes('đã lưu')) type = 'success';
    if (msg.toLowerCase().includes('chú ý') || msg.toLowerCase().includes('warning')) type = 'warning';

    UIService.toast(msg, type);
};

// Global Tab Switcher (attached to window for onclick access)
window.switchTab = function (tabId, event) {
    if (event) event.preventDefault();

    // Check if we are on admin.html (Robust check via DOM capability)
    const dashboardTab = document.getElementById('tab-dashboard');
    const isAdminPage = !!dashboardTab; // If tab-dashboard exists, we are on a page that supports tabs

    if (isAdminPage) {
        // 1. Hide all tab contents
        document.querySelectorAll('.tab-section').forEach(el => el.style.display = 'none');

        // 2. Show the selected tab
        const target = document.getElementById(tabId);
        if (target) target.style.display = 'block';

        // 3. Update Title & Active Nav
        const titleEl = document.querySelector('header h1');
        if (titleEl) {
            if (tabId === 'tab-dashboard') titleEl.innerText = "Tổng Quan";
            if (tabId === 'tab-maintenance') titleEl.innerText = "Bảo Trì & Dọn Dẹp";
            if (tabId === 'tab-analytics') titleEl.innerText = "Thống Kê & Phân Tích";
        }

        // Update Nav Active State
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        if (tabId === 'tab-maintenance') {
            const nav = document.getElementById('nav-maintenance');
            if (nav) nav.classList.add('active');
        } else if (tabId === 'tab-analytics') {
            const nav = document.getElementById('nav-analytics');
            if (nav) nav.classList.add('active');
            // Auto-load analytics when tab is opened
            if (typeof loadAnalyticsTab === 'function') loadAnalyticsTab();
        } else {
            // Default to Dashboard link (approximated)
            const nav = document.querySelector('a[href="admin.html"]');
            if (nav) nav.classList.add('active');
        }

    } else {
        // Redirect to admin.html with tab param
        window.location.href = `admin.html?openTab=${tabId}`;
    }
};
