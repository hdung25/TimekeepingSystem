// Chọn kết quả tìm kiếm bằng bàn phím cho MỌI thanh tìm kiếm (yêu cầu GĐ 29/09/2026):
// gõ tên → kết quả đầu tiên sáng sẵn → ↑ ↓ đổi người → Enter chọn → Esc đóng danh sách.
//
// Không sửa logic lọc/lưu của từng trang. Mỗi ô tìm kiếm chỉ KHAI BÁO ở SPECS: kết quả nằm ở
// đâu và "chọn" nghĩa là gì (bấm vào dòng đó, hoặc bấm nút bên trong). Mọi thao tác chọn đều đi
// qua đúng nút/handler mà người dùng vẫn bấm chuột, nên quyền, kiểm tra và ghi dữ liệu không đổi.
// Lắng nghe ở document nên ô được vẽ lại sau này (hộp thoại GV, danh sách nhân sự…) vẫn dùng được.
(function (global) {
    'use strict';

    const ACTIVE_CLASS = 'kn-active';
    const $ = (selector, root) => (root || document).querySelector(selector);
    const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

    // item: phần tử kết quả; pick: (tuỳ chọn) nút BÊN TRONG item để bấm khi chọn (mặc định bấm chính item);
    // dropdown: danh sách thả xuống (ẩn/hiện) — ↓ khi đang đóng sẽ mở; open/close: tên hàm của trang.
    const SPECS = [
        { input: '#staff-search-input', list: '#staff-dropdown-list', item: '.staff-dropdown-item',
            dropdown: true, open: 'openStaffDropdown', close: 'closeStaffDropdown' },
        { input: '#role-search-input', list: '#role-dropdown-list', item: '.role-dropdown-item',
            dropdown: true, open: 'openRoleDropdown' },
        { input: '#subject-search-input', list: '#subject-dropdown-list', item: '.subject-dropdown-item',
            dropdown: true, open: 'openSubjectDropdown' },
        { input: '#dash-search', list: '#dash-table-body', item: 'tr',
            pick: '[data-salary-dashboard-action="view"]' },
        { input: '#bulk-search-input', list: '#bulk-publish-modal', item: '.bulk-staff-row',
            pick: 'input[type="checkbox"]:not(:disabled)' },
        { input: '#compare-search', list: '#staff-compare-checkboxes', item: '.compare-staff-label', pick: 'input:not(:disabled)' },
        { input: '#attendee-search-input', list: '#custom-attendees-list', item: '.custom-attendee-item', pick: 'input:not(:disabled)' },
        { input: '#modal-staff-search', list: '#staff-checkbox-list', item: '.staff-checkbox-item', pick: 'input:not(:disabled)' },
        { input: '[data-action="roster-search"]', item: '.teacher-roster-item', pick: 'input:not(:disabled)',
            listOf: input => $(`[data-roster-list="${input.dataset.kind === 'substitute' ? 'substitute' : 'main'}"]`) },
        { input: '#mh-search-input', list: '#mh-tree', item: '.mh-item' },
        { input: '#ns-search-input', list: '#ns-list', item: '.ns-card', pick: '.ns-pick' },
        { input: '#f-q', list: '#rows', item: '.row' },
        { input: '#srb-search', list: '#srb-list', item: '.srb-row', pick: '.srb-act button' },
        { input: '#sr-search', list: '#sr-list', item: '.sr-person' },
        { input: '#log-search', list: '#admin-log-list', item: '.log-row', noPick: true },
        { input: '#filter-msnv, #filter-fullname, #filter-name, #filter-cs1, #filter-cs2, #filter-cs3', list: '#meetings-tbody', item: 'tr', noPick: true },
        // Ô lọc một <select> (Phân Tích Cá Nhân): ↑↓ đổi lựa chọn, Enter mới nạp biểu đồ.
        { input: '[oninput^="filterAnalyticsSelect"]', kind: 'select', select: '#analytics-staff-select' }
    ];

    const activeByInput = new WeakMap();

    function injectStyle() {
        if (document.getElementById('kn-style')) return;
        const style = document.createElement('style');
        style.id = 'kn-style';
        style.textContent = `.${ACTIVE_CLASS}{background:#DCFCE7 !important;box-shadow:inset 3px 0 0 #059669;outline:2px solid #059669;outline-offset:-2px;border-radius:8px}` +
            `tr.${ACTIVE_CLASS}{border-radius:0;outline-offset:-2px}`;
        (document.head || document.documentElement).appendChild(style);
    }

    function specFor(input) {
        if (!input || input.tagName !== 'INPUT') return null;
        return SPECS.find(spec => input.matches(spec.input)) || null;
    }

    const isShown = el => !!el && !el.hidden && el.getClientRects().length > 0;

    function listRoot(spec, input) {
        if (spec.listOf) return spec.listOf(input);
        return spec.list ? $(spec.list) : null;
    }

    function pickTarget(spec, item) {
        if (spec.noPick) return null;
        if (!spec.pick) return item;
        return $(spec.pick, item);
    }

    function itemsOf(spec, input) {
        const root = listRoot(spec, input);
        if (!root) return [];
        return $$(spec.item, root).filter(item => isShown(item) && (spec.noPick || pickTarget(spec, item)));
    }

    function dropdownOpen(spec, input) {
        const root = listRoot(spec, input);
        return !!root && isShown(root);
    }

    function clearActive(input) {
        const previous = activeByInput.get(input);
        if (previous) previous.classList.remove(ACTIVE_CLASS);
        $$('.' + ACTIVE_CLASS).forEach(el => { if (el !== previous && !input.contains(el)) el.classList.remove(ACTIVE_CLASS); });
        activeByInput.delete(input);
    }

    function setActive(input, item, scroll) {
        clearActive(input);
        if (!item) return null;
        injectStyle();
        item.classList.add(ACTIVE_CLASS);
        activeByInput.set(input, item);
        if (scroll !== false && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
        return item;
    }

    // ---------- Ô lọc <select> ----------
    function selectOptions(spec) {
        const select = $(spec.select);
        if (!select) return { select: null, options: [] };
        return { select, options: Array.from(select.options).filter(option => option.value && !option.hidden && option.style.display !== 'none') };
    }

    function moveSelect(spec, step) {
        const { select, options } = selectOptions(spec);
        if (!select || !options.length) return;
        const current = options.findIndex(option => option.value === select.value);
        const next = current === -1 ? (step > 0 ? 0 : options.length - 1) : (current + step + options.length) % options.length;
        select.value = options[next].value;
    }

    // ---------- Đồng bộ sau khi gõ ----------
    function syncAfterTyping(input) {
        const spec = specFor(input);
        if (!spec || !input.isConnected) return;
        const query = String(input.value || '').trim();
        if (spec.kind === 'select') {
            if (!query) return;
            const { select, options } = selectOptions(spec);
            if (select && options.length) select.value = options[0].value;
            return;
        }
        if (!query) { clearActive(input); return; }
        if (spec.dropdown && !dropdownOpen(spec, input)) return;
        const items = itemsOf(spec, input);
        setActive(input, items[0] || null, false);
    }

    document.addEventListener('input', event => {
        const input = event.target;
        if (!specFor(input)) return;
        // Chạy sau cả bộ lọc của trang (kể cả bộ lọc trễ/vẽ lại danh sách).
        [0, 80, 250].forEach(delay => setTimeout(() => syncAfterTyping(input), delay));
    });

    function openDropdown(spec, input) {
        const opener = spec.open && global[spec.open];
        if (typeof opener === 'function') opener.call(global);
        else input.dispatchEvent(new Event('focus'));
    }

    function closeDropdown(spec, input) {
        const closer = spec.close && global[spec.close];
        if (typeof closer === 'function') closer.call(global);
        else { const root = listRoot(spec, input); if (root) root.style.display = 'none'; }
        clearActive(input);
    }

    document.addEventListener('keydown', event => {
        const input = event.target;
        const spec = specFor(input);
        if (!spec) return;
        // Bộ gõ tiếng Việt (Telex/VNI) dùng Enter/mũi tên để chốt chữ — không phải để chọn.
        if (event.isComposing || event.keyCode === 229) return;
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        const key = event.key;
        const stop = () => { event.preventDefault(); event.stopPropagation(); };

        if (spec.kind === 'select') {
            if (key === 'ArrowDown' || key === 'ArrowUp') { stop(); moveSelect(spec, key === 'ArrowDown' ? 1 : -1); }
            else if (key === 'Enter') {
                const { select } = selectOptions(spec);
                if (select && select.value) { stop(); select.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            return;
        }

        if (key === 'Escape') {
            if (spec.dropdown && dropdownOpen(spec, input)) { stop(); closeDropdown(spec, input); }
            return;
        }
        if (key === 'Tab') {
            if (spec.dropdown && dropdownOpen(spec, input)) closeDropdown(spec, input);
            return;
        }
        if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter') return;

        if (spec.dropdown && !dropdownOpen(spec, input)) {
            if (key === 'Enter') return;
            stop();
            openDropdown(spec, input);
            const opened = itemsOf(spec, input);
            setActive(input, key === 'ArrowDown' ? opened[0] : opened[opened.length - 1]);
            return;
        }

        const items = itemsOf(spec, input);
        const current = activeByInput.get(input);
        const index = items.indexOf(current);

        if (key === 'Enter') {
            // Chưa có kết quả nào đang sáng (ô trống, hoặc không khớp ai) → để trang xử lý Enter như cũ.
            if (index === -1) return;
            stop();
            const target = pickTarget(spec, current);
            if (!target) return;
            target.click();
            if (!spec.dropdown) {
                // Danh sách thường được vẽ lại sau khi chọn (nhân sự, yêu cầu…) → giữ vị trí đang sáng.
                setTimeout(() => {
                    if (!input.isConnected) return;
                    const now = itemsOf(spec, input);
                    if (!now.length) { clearActive(input); return; }
                    setActive(input, now.includes(current) ? current : now[Math.min(index, now.length - 1)], false);
                }, 150);
            }
            return;
        }

        stop();
        if (!items.length) return;
        const step = key === 'ArrowDown' ? 1 : -1;
        const next = index === -1 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
        setActive(input, items[next]);
    }, true);

    // Rời ô tìm kiếm thì bỏ vệt sáng (danh sách thả xuống tự đóng theo cách của trang).
    document.addEventListener('focusout', event => {
        const input = event.target;
        const spec = specFor(input);
        if (!spec || spec.kind === 'select') return;
        // Bấm chuột vào một kết quả cũng làm ô mất focus: đợi click xong rồi mới bỏ vệt sáng.
        setTimeout(() => { if (document.activeElement !== input) clearActive(input); }, 200);
    });

    global.SearchKeyNav = { SPECS, specFor, itemsOf, ACTIVE_CLASS, _syncAfterTyping: syncAfterTyping };
})(typeof window !== 'undefined' ? window : globalThis);
