const UIService = {
    init() {
        if (!document.querySelector('.toast-container')) {
            const container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
    },

    toast(message, type = 'info') {
        this.init();
        const container = document.querySelector('.toast-container');

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        // Icons based on type
        let icon = '';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';
        if (type === 'warning') icon = '⚠️';
        if (type === 'info') icon = 'ℹ️';

        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 1.2rem;">${icon}</span>
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
