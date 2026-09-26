# Kế hoạch nâng cấp giao diện mobile + thông báo (26/09/2026)

Nguyên tắc: **chỉ đổi phần trình bày**. Không đổi cách tính công/lương, không đổi dữ liệu Firestore,
không đổi rules, không đổi luồng VÀO CA/RA CA/GPS. Mọi ID, tên hàm, onclick mà code/test đang dùng
được giữ nguyên. Làm trên nhánh riêng `ui/mobile-refresh-20260926`, kiểm tra bằng test + chụp màn
hình nhiều cỡ máy trước khi đưa lên production.

## 0. Kết quả điều tra (chỉ đọc dữ liệu thật, không ghi gì)

| Nghi vấn | Kết quả |
|---|---|
| "Chỉ Hà Huy Dũng nhận thông báo" | **Không đúng.** 35 nhân sự đã có mã nhận thông báo đẩy (25 iPhone đã cài app ra màn hình chính, còn lại Android/Windows). Máy chủ đã gửi nhắc vào ca cho 4 người (23/09), 7 người (24/09), 14 người (25/09), 11 người (26/09 tới 10h). Thông báo chấm bù/duyệt/bảng lương gửi thành công 1/1 thiết bị, không lỗi. |
| Vì sao người khác "không thấy" | (1) Chỉ ~35/70 người đã bật; người dùng iPhone mở bằng Safari/Zalo **không thể** nhận thông báo cho tới khi "Thêm vào MH chính". (2) Người đã chấm công trước giờ nhắc thì máy chủ không nhắc (đúng thiết kế). (3) iPhone ở chế độ Tập trung/Không làm phiền hoặc tắt "Biểu ngữ" thì chỉ vào Trung tâm thông báo. |
| "Người khác phải bấm đăng nhập" | Dữ liệu đăng nhập cho thấy đa số giữ phiên nhiều ngày (vd. đăng nhập mật khẩu 19–20/09, vẫn dùng tới 26/09). Các lượt đăng nhập mật khẩu dồn vào 22–26/09 khớp với lúc mọi người vừa **thêm app ra màn hình chính** (trên iPhone app cài riêng không dùng chung phiên với Safari → phải đăng nhập 1 lần). Có trường hợp 1 người có 2 mã thiết bị trong cùng 1 buổi sáng → có thể có 2 biểu tượng app / mở cả Safari lẫn app. |
| Lỗi thật tìm thấy #1 (nguyên nhân chính "không lưu đăng nhập") | Khi mở app, Firebase gọi mạng kiểm tra tài khoản **trước** khi báo phiên (điện thoại mạng chậm có thể mất tới 60 giây — xác nhận trong mã nguồn Firebase: `reloadAndSetCurrentUserOrClear`). App chỉ chờ **15 giây**; quá hạn là coi như chưa đăng nhập và **đăng xuất hẳn**. Máy mạng tốt (máy của anh Dũng) không bao giờ chạm mốc này. **Đã sửa**: quá 15 giây thì chờ tiếp kết quả thật, còn phiên thì tự vào lại. |
| Lỗi thật tìm thấy #2 | Trang bên trong **đăng xuất hẳn** nếu bước xác minh hồ sơ gặp lỗi mạng tạm thời (mạng yếu, Firestore quá tải). **Đã sửa**: lỗi mạng thì hiện "Thử lại", chỉ đăng xuất khi lỗi xác thực thật. |
| Mã nhận thông báo | Kiểm tra thử (FCM validate_only, không gửi gì): **39/40 mã hợp lệ**; 1 mã cũ đã được thay bằng mã mới cùng ngày. |
| Đăng xuất = tắt nhắc | Bấm "Đăng xuất" gỡ mã thông báo của máy (đúng về bảo mật). Ai quen đăng xuất sau mỗi ca sẽ mất nhắc vào ca ca sau. **Đã thêm** hộp hỏi lại khi đăng xuất trên máy đang nhận thông báo. |
| Bảng Cá Nhân | 3 ô thống kê, "Lịch sử chấm công gần đây" và tên người dùng **chưa từng được code điền** (luôn "--", "Trợ giảng"). **Đã sửa** bằng dữ liệu biểu đồ có sẵn (không tốn thêm lượt đọc). |
| Bảng Công máy tính | Lịch tháng bung cột theo chữ dài nhất → phải cuộn ngang mới thấy T4–CN. **Đã sửa**: 7 cột chia đều. |
| Tự động ra ca | Chạy đúng khi mở app (đã thử ca tối hôm trước quên ra ca → tự đóng đúng 21:00). Hạn chế: nếu nhân viên không mở app thì ca vẫn "mở" trong dữ liệu tới lần mở sau (Bảng Công vẫn tính theo giờ lịch). Lúc mở app, khung chấm công hiện "ĐANG TRONG CA" vài giây trước khi tự đóng → dễ gây hiểu nhầm. |
| Hàm nhắc vào ca trên máy chủ | Bản đang chạy là bản cũ (đọc toàn bộ push_tokens mỗi 2 phút). Bản tiết kiệm hơn (commit 361787b) chưa được deploy — cần chủ hệ thống chạy lệnh deploy functions. |

## 1. Việc làm trong đợt này (giao diện v1)

### 1.1 Hệ thống thiết kế chung (css/app-ui.css — tệp mới, tải sau style.css)
- Thang khoảng cách 4/8px, cỡ chữ co giãn theo màn hình bằng `clamp()` (360px → 430px → tablet → desktop).
- Nút bấm tối thiểu 44×44px (chuẩn Apple/Google), nút chính 52–56px, có hiệu ứng nhấn (phản hồi tức thì).
- Thẻ (card) nền trắng đặc trên điện thoại (bỏ hiệu ứng mờ kính tốn GPU → cuộn mượt hơn trên máy yếu).
- Màu trạng thái thống nhất: xanh lá = xong, xanh dương = đang làm, cam = cảnh báo/trễ, đỏ = vắng, tím = sắp tới, xám = nghỉ.
- Chừa vùng tai thỏ/thanh home (safe-area) cho iPhone.
- Máy tính: giới hạn bề rộng nội dung, thẻ/bảng/sidebar đồng bộ.
- Gỡ lớp này = xoá 1 dòng `<link>` → quay về giao diện cũ ngay.

### 1.2 Khung điều hướng trên điện thoại (mọi vai trò)
- Thanh trên gọn: nút menu (icon SVG, bỏ ký tự ☰/✕), tên trang, chuông thông báo nằm trong thanh (không che nội dung).
- **Thanh tab dưới đáy** (vùng ngón cái): 4 mục chính theo vai trò + "Thêm" mở menu đầy đủ.
  - Giáo viên/trợ giảng: Trang chủ · Chấm công · Lịch · Bảng công · Thêm
  - Tiếp tân/văn phòng: Trang chủ · Chấm công · Lịch trực · Bảng công · Thêm
  - Admin / Trợ lý cấp cao: Tổng quan · Xếp lịch · Tính lương · Nhân sự/Chấm công · Thêm
- Điện thoại xoay ngang giữ nguyên menu trượt (không có tab dưới để đỡ tốn chiều cao).

### 1.3 Trang Chấm Công (giáo viên dùng nhiều nhất)
- Thẻ trạng thái lớn: ngày + đồng hồ, nút VÀO CA / RA CA full-width có icon, đếm "đã làm x giờ y phút" khi đang trong ca.
- Ca hôm trước chưa ra: ghi rõ "Đang tự kết thúc ca hôm trước theo lịch…" thay vì chỉ "ĐANG TRONG CA".
- "Hôm nay": danh sách chip dạng dòng thời gian, chữ to rõ, viền màu theo trạng thái.
- Thẻ lớp: tên lớp + cơ sở, giờ/phòng bằng icon SVG (bỏ emoji 🕒 🚪), trạng thái dạng nhãn.
- Lịch sử vào/ra: dạng danh sách thay bảng.

### 1.4 Bảng Cá Nhân (trang chủ nhân viên)
- Lời chào + phím tắt nhanh (Chấm công, Lịch, Bảng công, Chấm bù).
- **Thẻ "Thông báo trên máy này"**: cho biết máy đang nhận nhắc vào ca hay chưa; hướng dẫn riêng cho iPhone chưa cài app (Chia sẻ → Thêm vào MH chính), đang mở trong Zalo/Facebook (mở bằng Safari/Chrome), đã chặn thông báo (cách mở lại).
- Nút Đổi mật khẩu chuyển thành nút phụ; bỏ emoji 🔔 🍩.

### 1.5 Bảng Công trên điện thoại
- Lưới 2 cột nhỏ → danh sách theo ngày 1 cột (mỗi ngày 1 thẻ: thứ + ngày, các chip full-width).
- Chip chữ to hơn, giờ in đậm, nút phụ (Tăng ca, +10p…) cao ≥32px, icon SVG thay ⏱ 📌 ✎.
- Máy tính giữ lịch tháng 7 cột, chỉ làm đẹp chip.

### 1.6 Thông báo
- Chuông trong thanh trên + danh sách thông báo dạng bảng trượt từ dưới lên (bottom sheet) trên điện thoại.
- Lời mời bật thông báo: bỏ emoji, hiện đúng hướng dẫn theo loại máy.

### 1.7 Bỏ emoji trên giao diện
- Thay bằng icon SVG cùng bộ (lucide) hoặc chữ: 🔔 🍩 🕒 🚪 📍 📅 🚩 📌 📝 ⏱ ⭐ ⚠️ ✅ ❌ 🔵 🔴 🟢 ⏳ 💼 🔧 🚀 ☰…
- Không đổi chuỗi dữ liệu đã lưu; chỉ đổi lúc hiển thị.

### 1.8 Độ ổn định đăng nhập
- Lỗi mạng khi xác minh phiên → màn hình "Mất kết nối – Thử lại", **không** đăng xuất.
- Lỗi xác thực thật (hồ sơ không khớp, không có phiên) → giữ nguyên hành vi đăng xuất an toàn như cũ.

### 1.9 Kiểm tra trước khi phát hành
- `npm run pretest && npm test` xanh như trước khi sửa.
- Chụp màn hình tự động (emulator, dữ liệu giả) cho 5 vai trò × các trang × 360/390/430/ngang/tablet/1366/1920: không tràn ngang, không emoji, không lỗi JS, nút ≥ 36px.
- Nâng `?v=` các tệp đổi + APP_RELEASE service worker + test tương ứng.
- Đẩy nhánh riêng trước (Vercel tạo bản xem thử), chỉ gộp vào `main` (production) khi đã kiểm tra.

## 2. Đề xuất cho đợt sau (cần chủ hệ thống quyết)
1. **Tự ra ca phía máy chủ**: hàm chạy mỗi 5–10 phút đóng ca quá giờ theo lịch cho cả người không mở app (hiện chỉ đóng khi mở app). Có ghi dữ liệu chấm công → cần duyệt riêng + chạy thử emulator.
2. Deploy hàm nhắc vào ca bản tiết kiệm (lệnh: `FUNCTIONS_DISCOVERY_TIMEOUT=90 firebase deploy --only functions:push --project timekeeping-69f3f --force`).
3. Nhắc "sắp hết ca" / "đã tự ra ca lúc …" qua thông báo đẩy.
4. Làm lại bảng biểu admin (Tính lương, Nhân sự, Xếp lịch) dạng thẻ trên điện thoại.
5. Tải font nhanh hơn (bỏ `@import` Google Fonts trong CSS).
6. Hướng dẫn nhân sự: mỗi người chỉ giữ **1** biểu tượng app, mở bằng biểu tượng đó, không bấm Đăng xuất khi hết ca.

## 3. Trạng thái (26/09/2026)
- Đã làm xong mục 1.1 → 1.8 trên nhánh `ui/mobile-refresh-20260926`.
- Kiểm tra: `npm run pretest && npm test` xanh (thêm `mobile-ui-session.test.js`); `test:browser` (đăng nhập, VÀO/RA CA thật trên emulator), `test:meeting-ui`, `test:payroll-ui` đều PASS.
- Chụp màn hình tự động 5 vai trò × 360/390/430/xoay ngang 844/tablet 820/1366/1920: 0 trang tràn ngang, 0 emoji, 0 lỗi JS mới.
- Chưa làm (đợt sau): thẻ hoá bảng admin, tự ra ca phía máy chủ, deploy hàm nhắc vào ca bản tiết kiệm.
