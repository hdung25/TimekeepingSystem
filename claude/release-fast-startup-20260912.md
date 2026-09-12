# Release 20260912-fast-startup-v1 — app mở chậm sau các bản 11/09

## Phản hồi và phạm vi (RuleHD)

- Người dùng báo app web "vào rất chậm" từ các bản cập nhật gần đây.
- Đã rà đủ luồng khởi động: service worker → HTML/script → Firebase Auth → hồ sơ → trang Chấm Công / Nhân viên / Bảng công / Admin → tự ra ca nền → banner họp.
- Không sửa dữ liệu production, không đổi Rules, không đổi logic tính công/lương. Mọi phép thử ghi chỉ chạy trên emulator `demo-timekeeping`.

## Bằng chứng

- Cloud Monitoring (chỉ đọc): lượt đọc Firestore QUERY tăng 2–3 lần từ trưa 11/09. Cao nhất 54–72 nghìn lượt/2 giờ, trước đó 15–20 nghìn. Độ trễ API phía máy chủ vẫn 15–50ms, nên nguyên nhân nằm ở phía trình duyệt.
- Dữ liệu production: 75 nhân sự, 253 bản chấm công tháng 9, 5 cuộc họp, 72 bản điểm danh họp.
- Benchmark cùng một bộ dữ liệu giả lập, CPU chậm 4 lần, mạng 2Mbps/120ms (`scratchpad/perf-bench.cjs`):
  - `cham-cong.html` khi đang trong ca: nút hiện ở 5,8–6,2s (bản 9d84984, trước 11/09) so với 7,0–7,1s (bản 6a40566). Chậm hơn khoảng 1,2s.
  - Nguyên nhân: 96b117a bắt khung chấm công chờ `globalCheckAutoCheckout`, hàm này đọc lịch tiếp tân, lịch văn phòng và lịch lớp **lần lượt từng cơ sở**.
  - Các trang khác đọc cùng số lượt như trước.

## Thay đổi

1. `js/timekeeping.js`: khung chấm công vẽ ngay; kiểm tra ca quá giờ chạy nền. Nếu vừa khép ca thì vẽ lại khung và chip. Bấm RA CA/VÀO CA trong lúc chờ vẫn khép ca quá giờ đúng mốc tan ca trước khi ghi (luồng 96b117a giữ nguyên).
2. `js/main.js`: `findReceptionistShiftBlocks` và `findTeachingBlocks` đọc 3 cơ sở song song. Thứ tự duyệt, luật hủy ca và đóng cửa giữ nguyên.
3. `service-worker.js` (v181): script/CSS có `?v=` trả ngay từ bộ đệm và cập nhật lại ở nền (stale-while-revalidate). HTML và tệp không có `?v=` vẫn ưu tiên mạng, nên bản deploy mới hiện ngay như cũ.
4. Sửa mã `?v=` cũ trước khi dùng bộ đệm:
   - `evaluation-service.js` trên cham-cong, cham-bu, tuong-trinh đổi sang `20260911-meeting-sync-v1`.
   - `ui-service.js` trên nhan-su, mon-hoc, tuong-trinh đổi sang `20260906-early10-recovery-v1`.
   - Hai tệp này đã bị sửa sau khi mã cũ được gắn.
5. Ghim `lucide@latest` thành `lucide@1.45.0/dist/umd/lucide.min.js` (đúng bản đang chạy) trên 18 trang:
   - Lý do: `@latest` tốn thêm một redirect (cache 60s) mỗi lần chuyển trang.
   - Mỗi lần lucide ra bản mới (gần như hằng ngày), điện thoại lại phải tải và phân tích 438KB.
6. Phiên bản: `main.js`/`timekeeping.js` `?v=20260912-fast-startup-v1`; `CACHE_NAME` `tdt-chamcong-v181-fast-startup-20260912`.

## Kiểm thử

- `npm test` (57 tệp, gồm test mới `startup-performance.test.js`): PASS.
  - Chiến lược SW: có bản lưu thì không chờ mạng, cập nhật nền, HTML ưu tiên mạng, không đụng tài nguyên bên thứ ba.
  - Mỗi tệp chỉ một mã `?v=`.
  - lucide đã ghim.
  - Đọc 3 cơ sở song song, kết quả giống trước.
- `auto-checkout.test.js` chuyển sang test hành vi: khung hiện khi kiểm tra quá giờ chưa xong; khép ca thì vẽ lại khung và chip; không có ca mở thì không đọc lịch.
- `npm run test:browser` (emulator, 8 loại tài khoản, VÀO CA → RA CA thật, Admin sửa công +10p, đóng/mở lớp, nhân sự, lịch): PASS, 0 lỗi trang.
- Không chạy `test:payroll-ui` và `test:rules`: release không đổi code lương hay Rules. `test:payroll-ui` vốn có 2 lỗi đã biết ở baseline.

## Giới hạn / việc nên làm tiếp

- `getMonthlyAttendance` lọc `userId` rồi lọc tháng ở trình duyệt, nên đọc toàn bộ lịch sử của nhân viên. Muốn lọc theo tháng trên server cần index composite `userId + date`. Chưa làm vì phải deploy index.
- Chưa đo trên iPhone/Android thật. Mức cải thiện thực tế phụ thuộc mạng từng người.
- Lần mở đầu tiên sau bản này, điện thoại vẫn tải bộ đệm mới (một lần). Lợi ích bộ đệm có từ lần mở thứ hai.
