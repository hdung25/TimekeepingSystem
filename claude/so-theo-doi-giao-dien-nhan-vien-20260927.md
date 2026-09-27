# Sổ theo dõi đợt 3 — 27/09/2026 (bản phát hành v208)

Yêu cầu chủ hệ thống (ảnh iPhone tối 27/09, bản production lúc đó là v206; đợt 2 = v207 chưa deploy):
1. Chấm Công: ca sáng đã quá giờ tan (10:45) mà 14:00 mở app vẫn thấy RA CA ~4–5 giây rồi mới tự ra ca.
2. Họp Của Tôi: nút `<` `>` tháng xếp dọc.
3. Bảng Công Cá Nhân: nút chưa tròn/đều, trông lổm chổm, chưa giống app.
4. Nghỉ lễ Quốc khánh 01–02/09: toàn bộ nhân viên không bị ghi nhận vắng.
5. Trang xếp lịch: thao tác hàng loạt ngày lễ / ngày nghỉ trung tâm cho toàn bộ nhân viên.
6. Làm lại giao diện đăng nhập, giữ form/chức năng, không phải cuộn lên xuống.

## Nguyên nhân & cách sửa
| # | Nguyên nhân | Sửa |
|---|---|---|
| 1 | Tự ra ca chạy trên điện thoại. Khoá màn hình lúc tan ca thì không chạy; mở lại app, khung vẽ RA CA theo dữ liệu rồi mới đọc lịch 3 cơ sở (≈10 lượt đọc) để khép ca. | `main.js`: mỗi lần tính được mốc tan ca của ca đang mở thì lưu trên máy (`tdt_shift_end_hint_v1`, đúng người + đúng ca); hẹn một lượt kiểm tra đúng mốc khi app đang mở. `timekeeping.js`: đã quá mốc → hiện ngay VÀO CA + "Ca trước đã tự kết thúc lúc HH:mm theo lịch"; chưa có mốc mà ca mở > 20 phút → "Đang cập nhật ca…" (tối đa 6 giây) thay vì RA CA sai; đang trong ca → thêm dòng "Tự ra ca lúc …". Ghi giờ ra vẫn qua transaction cũ (đọc lịch mới từ máy chủ, `expectedSession`). Toast ghi rõ mốc thay cho "hết giờ làm hôm nay". |
| 2 | Đã sửa ở đợt 2 (d567275) nhưng chưa deploy. | Deploy cùng bản này. |
| 3 | Thẻ ngày tô màu T7/CN theo cột lịch máy tính, ngày trống to, nút ghi chú ô vuông xám, nút trong chip nhỏ/lệch. | `app-ui.css` (≤900px): thẻ trắng bo 16px, ngày trống một hàng thấp, nút tròn 40px có `aria-label`, nhãn lễ dạng viên, nút trong chip xuống một hàng riêng cùng cỡ 36px; nút đầu trang + ô lọc dạng viên thuốc. `report.js` chỉ thêm lớp (`is-holiday`, `has-note`, `cal-note-btn`…). |
| 4 | Ngày trung tâm nghỉ, lớp có báo VP/VĐX hoặc phiên admin đánh dấu vắng vẫn thành chip vắng (và bị đếm ở chuyên cần/thống kê). | `evaluation-service.js`: ca thuộc phạm vi nghỉ trung tâm mà không có phiên làm việc thật → "(Nghỉ)" (`isCenterOff`), kể cả VP/VĐX/phiên vắng (giữ liên kết phiên để admin sửa). Người đi làm vẫn tính công. Nhãn 01/09/2026 = "Quốc Khánh". **Dữ liệu nghỉ 01–02/09 phải đặt bằng công cụ ở #5** (phiên này không được đọc/ghi production). |
| 5 | Chỉ tắt được từng ca của từng ngày, không sửa ngày đã qua. | `js/center-holidays.js` + nút "Ngày nghỉ lễ" (Xếp Lịch, Cài đặt hệ thống): khoảng ngày (≤62), phạm vi Cả ngày/Sáng/Chiều/Tối, tên ngày nghỉ, gợi ý nhanh (Quốc khánh 01–02/09/2026…), danh sách + "Mở lại". Một transaction trên `settings/system` (`centerClosures`, `centerHolidayNames`, `centerClosuresUpdatedAt/By`). Rules không đổi (người xếp lịch đã được cập nhật settings). |
| 6 | — | `index.html` + `login.css` viết lại: ảnh hoa sen + logo phía trên, khung trắng bo góc; 100dvh, `overflow:hidden`; màn thấp tự co ảnh; xoay ngang và máy tính chia đôi. Giữ nguyên id/form/`togglePasswordVisibility`. Dòng "Chào mùa hè 2026" → lời chào theo giờ. |

Thêm: Lịch Làm xoay ngang — ô lọc ca (đợt 2) ép tiêu đề ngày thành cột hẹp; sửa trong khối landscape của `app-ui.css`. `timekeeping.js` `isCenterClosed` nhận khóa buổi (`morning` = ca 1 + ca 2).

## Kiểm tra
- `npm run pretest && npm test` (thêm `center-holidays.test.js`; mở rộng `auto-checkout`, `evaluation-service`, `mobile-ui-session`), `test:rules`, `test:browser`, `test:meeting-ui`, `test:payroll-ui`: PASS.
- WebKit (lõi Safari) giả lập iPhone SE/13/14 Pro Max, xoay ngang, iPad, máy tính: không tràn ngang/không đè; đăng nhập vừa một màn hình ở mọi cỡ.
- Kịch bản emulator: ca tối 17:55 chưa ra, mở lúc 22:3x → có mốc: VÀO CA ngay; chưa có mốc: "Đang cập nhật ca…" rồi VÀO CA; lịch sử ghi 17:55–21:00 "Tự ra ca". Công cụ nghỉ lễ: đặt 01–02/09 + một ngày có ca, mở lại, Bảng Công giáo viên hiện "(Nghỉ)" thay cho vắng, ca đã làm vẫn tính giờ.

## Phiên bản
`main.js`, `timekeeping.js`, `report.js`, `app-ui.css` → `?v=20260927-round3-v1`; `evaluation-service.js` → `20260927-holiday-off-v1`; `schedule.js`, `center-holidays.js` → `20260927-holidays-v1`; `login.css` → `20260927-login-v3`; APP_RELEASE `tdt-chamcong-v208-round3-20260927`.
