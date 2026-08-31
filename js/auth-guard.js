/**
 * Auth Guard
 * Inclusion: Add <script src="js/auth-guard.js"></script> to the <head> of protected pages.
 * Purpose: Immediately redirect unauthorized users before the page renders.
 */
(function () {
    const currentUser = localStorage.getItem('currentUser');
    const currentRole = localStorage.getItem('currentRole');

    function clearMissingSessionAndRedirect() {
        [
            'currentUser',
            'currentRole',
            'currentUserId',
            'currentAuthUid',
            'userFullName',
            'currentUserName'
        ].forEach(key => localStorage.removeItem(key));

        const redirect = () => window.location.replace('index.html');
        const primaryAuth = window.auth;
        if (primaryAuth && typeof primaryAuth.signOut === 'function') {
            primaryAuth.signOut()
                .catch(error => console.warn('Auth Guard: Firebase sign-out failed:', error))
                .finally(redirect);
        } else {
            redirect();
        }
    }
    
    // Parse role — hỗ trợ cả string lẫn JSON array
    function parseRoles(roleStr) {
        try {
            const parsed = JSON.parse(roleStr);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch(e) {
            return roleStr ? [roleStr] : [];
        }
    }
    const currentRoles = parseRoles(currentRole);
    const hasAdminAccess = currentRoles.some(r => r === 'admin' || r === 'senior_assistant');
    const hasStaffAccess = currentRoles.some(r => ['staff','assistant','receptionist','receptionist_assistant','office_staff','teaching_assistant'].includes(r));

    const path = window.location.pathname;

    // List of pages that require Login
    // (Essentially all pages except index.html and maybe 404)
    const publicPages = ['index.html', 'gioi-thieu.html'];
    const isPublic = publicPages.some(page => path.includes(page));

    // 1. Check Login Status
    if (!currentUser) {
        if (!isPublic) {
            console.warn("Auth Guard: Unauthorized access attempt. Redirecting to login.");
            clearMissingSessionAndRedirect();
        }
        return; // Stop execution
    }

    // 2. Check Role Access checks
    // Admin Only Pages
    const adminPages = [
        'he-thong.html',
        'nhan-su.html',
        'admin.html',
        'nhat-ky-ca.html',
        'tuong-trinh.html',
        'hop-dinh-ky.html',
        'mon-hoc.html'
    ];
    const isTargetingAdminPage = adminPages.some(page => path.includes(page));

    const hasAssistantAccess = currentRoles.some(r => r === 'assistant');
    let isAllowed = true;
    if (isTargetingAdminPage) {
        if (path.includes('mon-hoc.html')) {
            isAllowed = currentRoles.includes('admin');
        } else if (path.includes('he-thong.html')) {
            isAllowed = hasAdminAccess || hasAssistantAccess;
        } else {
            isAllowed = hasAdminAccess;
        }
    }

    if (path.includes('quan-sat-ca.html')) {
        isAllowed = currentRoles.some(r => [
            'admin',
            'senior_assistant',
            'receptionist',
            'receptionist_assistant',
            'receptionist_lead',
            'receptionist_staff'
        ].includes(r));
    }

    if (path.includes('lich-van-phong.html')) {
        isAllowed = currentRoles.some(r => [
            'admin',
            'senior_assistant',
            'assistant',
            'office_staff'
        ].includes(r));
    }

    if (!isAllowed) {
        console.warn(`Auth Guard: User ${currentUser} (Role: ${currentRole}) attempted to access Admin page.`);
        alert('Bạn không có quyền truy cập trang này!');

        // Redirect based on role
        if (hasStaffAccess) {
            window.location.href = 'nhan-vien.html';
        } else {
            window.location.href = 'index.html';
        }
    }
})();
