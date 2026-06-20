(function initSeasonalLogin() {
    const month = new Date().getMonth() + 1;
    const themes = {
        spring: {
            label: 'Chủ đề mùa xuân',
            title: 'Khởi đầu mới cho tri thức',
            copy: 'Mùa của những mục tiêu mới, thói quen tốt và từng bước tiến bộ bền bỉ.',
            quote: 'Gieo một giờ học nghiêm túc hôm nay, gặt một ngày tự tin ngày mai.'
        },
        summer: {
            label: 'Chủ đề mùa hè',
            title: 'Năng lượng cho ngày học mới',
            copy: 'Giữ tinh thần sáng rõ, học sinh hứng khởi và mỗi giờ lên lớp thật đáng nhớ.',
            quote: 'Một lớp học tốt bắt đầu từ sự chuẩn bị ấm áp và kỷ luật nhẹ nhàng.'
        },
        autumn: {
            label: 'Chủ đề mùa thu',
            title: 'Mùa xây nền vững chắc',
            copy: 'Mỗi bài học là một viên gạch nhỏ đặt vào nền tảng tư duy và ngôn ngữ.',
            quote: 'Kiên trì với điều nhỏ, giáo dục sẽ tạo nên thay đổi lớn.'
        },
        winter: {
            label: 'Chủ đề mùa đông',
            title: 'Ấm áp trong từng giờ học',
            copy: 'Giữ nhịp học đều đặn, nâng đỡ sự tự tin và cùng học sinh đi qua thử thách.',
            quote: 'Sự tận tâm của giáo viên là ánh sáng bền bỉ nhất trong lớp học.'
        }
    };

    let season = 'spring';
    if (month >= 6 && month <= 8) season = 'summer';
    else if (month >= 9 && month <= 11) season = 'autumn';
    else if (month === 12 || month <= 2) season = 'winter';

    const theme = themes[season];
    document.body.dataset.season = season;

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('season-label', theme.label);
    setText('season-title', theme.title);
    setText('season-copy', theme.copy);
    setText('season-quote', theme.quote);

    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('password');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const show = passwordInput.type === 'password';
            passwordInput.type = show ? 'text' : 'password';
            togglePassword.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
            togglePassword.setAttribute('title', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
            togglePassword.innerHTML = show ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
            if (window.lucide) window.lucide.createIcons();
        });
    }

    if (window.lucide) window.lucide.createIcons();
})();
