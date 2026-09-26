# Sổ theo dõi làm lại giao diện trang nhân viên (26/09/2026 — đợt 2)

Yêu cầu chủ hệ thống (sau khi xem bản v206 trên iPhone thật):
- Làm lại hẳn giao diện trang nhân viên, không chỉ vá lên thiết kế cũ.
- Nút phải tròn trịa, đồng bộ; sắp xếp hợp lý, không lổm chổm, **không đè lên nhau**.
- Chỉ đổi giao diện: giữ nguyên mọi chức năng, chuyển trang, dữ liệu.
- Ghi chú trong lúc sửa để không bỏ sót.

## Quy tắc khi sửa (kiểm lại trước mỗi commit)
1. Giữ nguyên mọi `id`, `name`, `onclick`/`onchange`/`oninput`, `data-*`, `value` của phần tử mà JS đang dùng.
   Trước khi xoá/đổi 1 phần tử HTML: `grep` id/class trong js/*.js + trang đó + test-automation.
2. Không đổi logic JS; chỉ đổi chuỗi HTML trình bày khi bắt buộc (và giữ nguyên chữ mà test đang kiểm).
3. Mỗi trang sửa xong: chụp WebKit (lõi Safari) + Chrome ở 360/390/430, xoay ngang, máy tính; đo tràn ngang,
   phần tử đè nhau, nút < 44px.
4. Chạy `npm run pretest && npm test`, `test:browser`, `test:meeting-ui`, `test:payroll-ui` trước khi phát hành.
5. Nâng `?v=` cho mọi tệp đổi + APP_RELEASE (v207) + test liên quan.

## Lỗi chủ hệ thống chỉ ra (ảnh iPhone)
| # | Trang | Lỗi | Nguyên nhân | Trạng thái |
|---|---|---|---|---|
| 1 | hop-cua-toi | Nút `<` `>` tháng xếp dọc bên trái | style.css cũ: `.main-content > header > div:last-child { display:grid; 1 cột }` áp cả vào thanh tháng | **Đã sửa, đã kiểm WebKit** |
| 2 | bao-cao | Nút "+ Thưởng 10p" full ngang, "Ca đông học sinh" lệch phải tràn; thanh tháng/bộ lọc nút méo; chú thích lộn xộn | 2 khối CSS mobile cũ mâu thuẫn (grid 1 cột vs flex canh phải) + style nội tuyến | **Đã sửa, đã kiểm WebKit** |
| 3 | cham-bu | Ô "Giờ ra" tràn khỏi thẻ; ô Ngày canh giữa, không viền; chiều cao ô không đều | Safari iOS: input date/time có bề rộng tối thiểu riêng, lưới 2 cột không co | **Đã sửa, đã kiểm WebKit** |
| 4 | index (đăng nhập) | Nút mắt hiện **cả 2 icon** (mở + gạch) trên Safari; bấm không đổi icon | `hidden` trên thẻ SVG: Safari không ẩn; JS gán `svg.hidden` không tạo thuộc tính | **Đã sửa, đã kiểm WebKit** |
| 5 | quan-sat-ca | 3 nút ca Sáng/Chiều/Tối rớt dòng (Tối xuống hàng 2) | nút rộng theo chữ + icon, không chia đều | **Đã sửa, đã kiểm WebKit** |
| 6 | lich-tiep-tan / lich-van-phong | "Tuần 21/09 – 27/09" nằm trên, 2 nút ‹ › vuông nằm riêng hàng dưới | bố cục cũ | **Đã sửa, đã kiểm WebKit** |

## Danh sách trang nhân viên cần làm lại
| Trang | Vai trò dùng | Việc | Trạng thái |
|---|---|---|---|
| nhan-vien.html | mọi nhân viên | rà lại thẻ lương, nút tháng, bảng | Đã rà: lối tắt 1 dòng, hộp đổi mật khẩu, banner họp xếp dọc |
| cham-cong.html | mọi nhân viên | rà lại (đợt 1 đã làm) | Đã rà: hộp xác nhận, banner họp |
| bao-cao.html (nhân viên) | mọi nhân viên | đầu trang, nút hành động, thanh tháng + bộ lọc, chú thích | Xong: đầu trang, 2 nút chia đều, thanh tháng + 3 ô lọc, chú thích lưới 2 cột, ô ghi chú |
| cham-bu.html | nhân viên | thanh trên, tab, form 2 cột, ô ngày/giờ, danh sách yêu cầu | Xong: CSS mới toàn trang, form thẳng hàng |
| hop-cua-toi.html | nhân viên | thanh tháng, thẻ thống kê, thẻ cuộc họp | Xong: thanh tháng một hàng, thống kê 2×2 |
| lich-lam.html (giáo viên) | GV/TG | đầu trang, tab cơ sở, tuần, ngày, thẻ ca | Xong: thanh tuần, nút chọn ngày tròn, ô lọc ca, ẩn nút Sao Chép/Lưu với GV |
| lich-tiep-tan.html / lich-van-phong.html | tiếp tân / VP | đầu trang, điều hướng tuần, bảng tuần | Xong: thanh tuần một hàng |
| quan-sat-ca.html | tiếp tân | rà | Xong: 3 nút ca một hàng, ô chọn đồng bộ |
| index.html | đăng nhập | rà | Xong: 1 icon mắt |

## Công cụ kiểm tra
- `wk.cjs` (scratchpad): Playwright **WebKit** (lõi Safari) giả lập iPhone 13 / SE / 14 Pro Max, đo: tràn ngang,
  nút đè nhau, nút tràn khỏi thẻ chứa, nút < 40px. Chạy: `VPS='i390' USERS='teacher|reception' firebase emulators:exec ... "node wk.cjs <worktree> <nhãn>"`.
  Lưu ý: WebKit bản Windows KHÔNG vẽ ô ngày/giờ giống iOS → lỗi #3 phải sửa theo quy tắc chuẩn iOS
  (`-webkit-appearance:none; min-width:0; width:100%; ::-webkit-date-and-time-value{text-align:left}`).
- `shots.cjs`: Chrome, nhiều cỡ màn hình + máy tính.

## Nhật ký sửa
(ghi theo thứ tự làm; mỗi dòng: tệp — phần tử — thay đổi — đã kiểm)
- css/app-ui.css — thêm khối "ĐỢT 2": `.ui-icon-btn`, `.ui-monthbar`, `.ui-page-head`, sửa ô ngày/giờ iOS (toàn cục, chỉ min-width + canh trái), `.rp-*` (Bảng Công), `.cal-nav-*` mobile, `.rp-legend`, `.week-picker.ui-weekbar`, `.shift-segment` 3 cột, `#prev-week/#next-week` 44px.
  - Bảng Công: CSS cũ dùng bộ chọn `#personal-specific-header-controls` (ưu tiên id) → CSS mới cũng dùng id để thắng. Khối nút tôn trọng `style="display: none"` do report.js đặt (`switchAdminTab`).
- hop-cua-toi.html — `<header>` → `.ui-page-head`; thanh tháng → `.ui-monthbar` + 2 `.ui-icon-btn` SVG. Giữ `id="mymeet-month"`, `onclick="myMeetChangeMonth(-1|1)"`, lớp `month-navigator`/`month-nav-btn`. (Sửa lỗi #1)
- bao-cao.html — `.page-header` → `.rp-head` (tiêu đề + `#total-hours-display.rp-total` + `#personal-specific-header-controls.rp-actions`); giữ nguyên mọi nút/id/onclick/style ẩn-hiện; chú thích thêm lớp `.rp-legend`. (Sửa lỗi #2)
- cham-bu.html — thay toàn bộ `<style>` trong trang (đối chiếu: 0 lớp bị bỏ); ô nhập 48px/16px, `-webkit-appearance:none`, `.g2` = `repeat(2, minmax(0,1fr))`, ngày/giờ canh trái. HTML/JS không đổi. (Sửa lỗi #3)
- css/login.css + js/main.js — `#toggle-password svg[hidden]{display:none}`; `togglePasswordVisibility` dùng `toggleAttribute('hidden')`. (Sửa lỗi #4)
- lich-tiep-tan.html, lich-van-phong.html — `.week-picker` thêm lớp `ui-weekbar` (HTML khác giữ nguyên). (Sửa lỗi #6)
- quan-sat-ca — chỉ CSS `.shift-segment` lưới 3 cột. (Sửa lỗi #5)
- cham-bu.html — `.g2` thêm `align-items:end` để hàng ô thẳng nhau khi nhãn dài 2 dòng (ví dụ "AI PHÂN CÔNG / DUYỆT MIỆNG").
- lich-lam.html — `#admin-actions` bỏ vế `display:flex` thừa trong style nội tuyến (`display: none; display:flex` → giáo viên cũng thấy "Sao Chép Tuần/Lưu Lịch"). schedule.js vẫn đặt `display:flex` cho admin/trợ lý/trợ lý cấp cao như cũ. Đã kiểm: luật Firestore chỉ cho người xếp lịch ghi `schedules`; nút Lưu Lịch chỉ hiện thông báo → ẩn với giáo viên không mất chức năng.
- css/app-ui.css — `#admin-actions[style*="display: none"]` thắng khối xoay ngang của trang; thanh tuần Lịch Làm (điện thoại) thành viên thuốc [‹][tuần][›][Chọn ngày]; ô lọc ca 44px; ô chọn Quan Sát Ca bỏ nền xám hệ điều hành.
- Cỡ nhỏ (iPhone SE 375): Bảng Công bỏ icon trong ô chọn tuần/ngày (≤400px), nút đầu trang cỡ chữ .8rem; Lịch Làm nút "Chọn ngày" thành nút tròn icon (thêm `aria-label`), nhãn ngày xuống dòng thay vì cắt; lối tắt Bảng Cá Nhân 1 dòng.
- js/main.js — chuông thông báo trên máy tính chuyển vào ô chào ở thanh bên (`.notif-bell--sidebar`); trước đây chuông nổi góc phải đè nút tháng sau (trang Họp) và đồng hồ (trang Chấm Công). Điện thoại giữ nguyên (trong thanh trên).
- Bảng Công máy tính: tiêu đề trái – tổng giờ phải, hàng nút canh phải.
- Hộp thoại chung (UIService xác nhận/thông báo, đổi mật khẩu, ghi chú ngày): bo 20px, 2 nút chia đều 48px, ô mật khẩu chừa chỗ icon mắt, ô ghi chú bo góc nền trắng. Chỉ CSS.

## Kiểm tra trước phát hành (đợt 2)
- `npm run pretest && npm test`: xanh (mobile-ui-session.test.js thêm 20+ kiểm tra cho đợt 2).
- `test:browser`, `test:meeting-ui`, `test:payroll-ui`: PASS.
- Phiên bản: `main.js`, `app-ui.css`, `login.css` → `?v=20260926-staff-ui-v2`; APP_RELEASE `tdt-chamcong-v207-staff-ui-20260926`.
