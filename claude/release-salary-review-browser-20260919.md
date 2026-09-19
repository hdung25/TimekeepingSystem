# Kiểm thử trình duyệt xét tăng lương — 19/09/2026

## Môi trường và phạm vi

Test mới: `test-automation/salary-review-ui-flow.test.js`, dùng Chrome thật headless
và Firebase Auth/Firestore Emulator `demo-timekeeping` (8088/9098). Server chỉ phục
vụ file local, Firebase config đổi project sang demo, chặn các request Firebase
production. Tài khoản và mật khẩu trong test là fixture chỉ tạo trên emulator.
Không đăng nhập hoặc ghi vào production.

Fixture tự lấy tháng hiện tại theo UTC+7, sinh tháng trước và tháng kế tiếp; không
phụ thuộc ngày release. Có giáo viên kiêm tiếp tân, nhóm Toán nhiều giá, nhóm
Tiếng Anh, giá lớp ghép/lớp đông, cấu hình `giao_vien` cùng alias cũ trái giá,
phiếu giáo viên đã nhận tháng trước, phiếu tiếp tân đã nhận ở tháng đích và công
đã chỉnh bởi admin. Snapshot toàn bộ các tài liệu nguồn để so sánh sau mỗi bước.

## Kết quả đã qua

- Đăng nhập Admin qua UI; banner Tổng quan đếm đúng một người có hai nhóm đến hạn.
- Điều hướng trực tiếp vào hồ sơ; thấy giá môn cũ, cảnh báo folder khác giá,
  Toán 2 ngoại lệ được giữ ngoài phạm vi đã chọn.
- Lưu mốc và đánh giá qua form; nguồn lương, users, công và phiếu cũ không đổi.
- Hẹn lại qua dialog; đổi ngày hẹn nhưng giữ mốc gốc.
- Xem trước tăng Toán 1/5 từ 32.000 lên 36.000; chưa bấm duyệt thì tháng đích
  vẫn nguyên vẹn, gồm phiếu tiếp tân đã nhận.
- Duyệt vào tháng sau: đủ bản đồ giá kế thừa được giữ, Toán 2 vẫn 34.000, E5 vẫn
  56.000, giá lớp ghép/lớp đông và toàn bộ phần tiếp tân không đổi. Nhóm Tiếng Anh
  trong hồ sơ vẫn giữ mức 56.000. Có ngày hiệu lực và lịch sử quyết định.
- Mở trang Tính lương thật cho ba tháng, không lưu: tháng đích đọc 36.000,
  tháng hiện tại 32.000, tháng trước dùng alias cũ 30.000. Đọc báo cáo không ghi
  lại bất cứ nguồn lương/công nào.
- Hủy mức chưa có hiệu lực qua UI: tháng đích khôi phục chính xác như trước
  (kể cả TT/phiếu đã nhận); nhóm xét trở lại giá/mốc/ngày hẹn trước khi duyệt.
- Lịch sử có đủ `profile`, `deferred`, `approved`, `cancelled`, kèm timestamp
  server, `actorUserId` đúng và tên Admin đọc được trong UI. Không có lỗi
  JavaScript chưa được bắt trong browser.
- Viewport 390×844 không tràn ngang. Đã xem ảnh desktop và mobile.

## Lỗi thật phát hiện và đã sửa trong phiên

Lần đầu UI gọi `loadIndex()` trước khi Firebase khôi phục phiên sau điều hướng.
Trang báo hết phiên dù sidebar sau đó đã xác thực thành công. Agent chính thêm
`await window.waitAuth()` trước bước tải. Test được chạy lại từ đăng nhập sạch
và toàn bộ flow qua. Đây là lý do cần browser test ngoài unit test.

Một lần test dừng vì chính harness đổi `isMobile` của Puppeteer khi dialog đang
mở; thao tác đó reload trang. Đã sửa harness chỉ đổi kích thước viewport, giữ
nguyên device mode để không làm mất preview. Không phải lỗi ứng dụng.

## Bằng chứng local

- `scratch/salary-review-ui-audit.json`: kết quả và mảng lỗi rỗng.
- `scratch/salary-review-ui-desktop-initial.png`.
- `scratch/salary-review-ui-mobile-preview.png`.
- `scratch/salary-review-ui-mobile-applied.png`.
- `scratch/salary-review-ui-mobile-restored.png`.

Ảnh `salary-review-ui-fatal.png` còn từ lần kiểm thử lỗi trước đó; không dùng ảnh
này làm kết luận cho bản cuối. Các file scratch là chứng cứ local, không deploy.

## Kiểm tra luồng cũ

`browser-staff-flow.test.js` đã qua với 8 fixture role: login, vào/ra ca thật,
dashboard, chấm công, bảng công, lịch, tiếp tân/văn phòng, nhân sự, hệ thống.
Mobile 390px không tràn ngang; không lỗi JS. Có thêm kiểm tra sửa công +10,
read-failure chặn xuất/gửi lương và retry, đóng/mở lại lớp bảo toàn ghi chú/lịch sử,
refresh giáo viên và thay người đúng ca, refresh danh sách nhân viên.

Lần đầu `payroll-ui-flow.test.js` dừng ở assertion cũ trong
`scheduled-overtime-ui.cjs:42`: mode ban đầu là `actual` nhưng test đòi `schedule`.
Agent review_engine chạy cùng harness với toàn bộ app/rules từ git HEAD trên
emulator riêng và tái hiện đúng lỗi. Contract từ commit `a78c1f9` đã đổi mặc định
sang actual. Chỉ sửa assertion mặc định về đúng contract; giữ kiểm tra chuyển
actual→schedule, 105 phút tăng ca → 90 phút sau thu hồi, fingerprint và sửa đè
cạnh tranh. Chạy lại đã qua toàn bộ phần tăng ca.

Lần chạy tiếp đã qua tính/lưu/gửi/nhận lương, alias cũ, giá theo tháng, xuất ZIP,
chuyên cần, phiếu hiệu chỉnh và link lịch. Browser xác nhận bước trợ lý cấp cao
lưu phí tư vấn bị Firestore từ chối khi fixture legacy có `evaluation` dạng một
object. UI đã tải đúng người/tháng, input đúng; DBService đổi object thành array
trong thao tác lưu hẹp, nhưng rule so sánh dùng trực tiếp phép toán list trên map.
Nguồn dữ liệu giữ nguyên sau lần ghi bị từ chối. Bản git HEAD trên emulator riêng
cũng tái hiện lỗi. Agent review_engine sửa hẹp phép so sánh để nhận một map có
`id` như một dòng list, giữ ràng buộc chỉ đổi amount phí tư vấn và mọi ràng buộc
khác. Toàn Rules suite cùng các negative tests legacy/tamper đã qua. Diagnostic chỉ chạy khi fail
trong `payroll-review-ui.cjs`, không nới assertion hay quyền ghi.

## Xác nhận cuối trước bàn giao deploy

Đã chạy tuần tự bằng một emulator sạch, trên mã cuối và Rules đã sửa:

```powershell
firebase emulators:exec --only auth,firestore --project demo-timekeeping --config ../firebase.browser.json "node payroll-ui-flow.test.js && node salary-review-ui-flow.test.js"
```

Exit code **0**, cả hai suite **PASS**. Toàn bộ payroll bao gồm tăng ca, giá theo
tháng, dữ liệu legacy, lọc/lưu/tính/gửi/nhận, phiếu lịch sử/hiệu chỉnh, ZIP, thống
kê chuyên cần/trễ, lỗi đọc/retry, link lịch và trợ lý cấp cao lưu phí tư vấn rồi
Admin tính lại đều qua. Giữ nguyên các assertion về nguồn đã gửi và quyền hạn.
Luồng xét lương cuối cũng qua toàn bộ save/defer/preview/apply/report/cancel,
kiểm tra giá 36.000 ở tháng sau và 32.000/30.000 ở các tháng cũ; audit có tên Admin.
Hai JSON evidence đều `errors: []`, không `fatal`. Ảnh mobile đã được ghi lại từ
chính lượt cuối. Browser staff tám vai trò đã qua trong lượt riêng trước đó.

Sau đó service thêm đóng băng ngày xét/cấu hình/ghi đè cá nhân trong audit duyệt;
đã chạy riêng lại toàn `salary-review-ui-flow.test.js`, thêm assertion trực tiếp
`reviewDate`, `reviewSettings.cycleMonths/minimumHours`, `personOverrides`.
Exit **0**, toàn flow vẫn **PASS** trên đúng service cuối. Không cần chạy lại
payroll vì chỉnh sửa này chỉ thuộc service trang xét mới.

Một lần khởi động emulator song song trước lượt cuối lỗi hub cục bộ trước khi
test bắt đầu. Đã dừng đúng tiến trình emulator mồ côi của phiên và chạy lại tuần
tự; không phải lỗi app và không liên quan môi trường production. Emulator cuối
đã shutdown đầy đủ. Chưa có thao tác ghi production hay deploy từ agent phụ này.
