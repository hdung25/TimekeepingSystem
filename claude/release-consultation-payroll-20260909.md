# Sửa phí tư vấn và đồng bộ bảng lương — 09/09/2026

## Phạm vi và nguyên nhân

- Theo RuleHD tại `.agents/AGENTS.md`, đối chiếu luồng nhập → cấu hình tháng → bản tính → gửi/hiệu chỉnh → nhân viên/chi lương → file xuất.
- Form bổ sung tiếp tân cho quản lý cấp cao nhập và bấm lưu mặc dù quyền tài chính chỉ dành cho Admin. Chuyển thành chỉ xem, ẩn nút lưu và giải thích quyền; giữ quyền đối chiếu/duyệt công và Firestore Rules.
- Gõ số tiền từng sửa trực tiếp object cấu hình đã tải, làm điều kiện so sánh đồng thời của Lưu & Tính sai. Tách baseline theo đúng nhân viên/tháng, trước khi áp dụng mặc định legacy; không sửa cache dữ liệu đã tải trong sự kiện input.
- Lưu & Tính đọc doanh thu từ ID không tồn tại và có thể ghi 0. Sử dụng đúng ô doanh thu tháng trên header.
- Lưu riêng thông tin bổ sung kiểm tra baseline đã xem, giữ các trường khác, dựng bản tính từ dữ liệu đã lưu. Khi đang xem giáo viên, hiệu chỉnh phí tư vấn vẫn ghi vào thành phần tiếp tân.
- Chuẩn hóa cách tìm tiêu chí có ID số hoặc chuỗi số trong dữ liệu cũ; không tạo thêm dòng phí tư vấn trùng ID.
- Giữ bảng lương đã gửi/đã nhận. Sửa phí tạo nháp hiệu chỉnh; chỉ thao tác gửi hiệu chỉnh rõ ràng mới cập nhật bản nhân viên nhận và yêu cầu xác nhận lại phần thay đổi.

## Kiểm chứng

- Bài mới: `test-automation/consultation-payroll-ui.cjs`, tích hợp `npm run test:payroll-ui`.
- Dùng tài khoản và dữ liệu Firebase Emulator `demo-timekeeping`; không sửa dữ liệu nhân viên production.
- Kiểm tra 81.675đ + CS3 25.000đ, lưu/tải lại/tổng, Lưu & Tính, doanh thu không bị xóa, xung đột, sửa về 0, dữ liệu ID chuỗi, tháng chưa có cấu hình, hiệu chỉnh riêng TT, tổng hợp đa vai trò và mẫu bảng nhân viên.
- Bài hiện có tiếp tục kiểm tra file xuất, tháng cũ, dashboard, gửi, nhận, xác nhận trên bản cũ và quyền Admin/quản lý cấp cao.
- Test dùng Firebase SDK và Chart.js đúng phiên bản cài tại máy; CDN tùy chọn được bỏ qua để tránh timeout. Đây là kiểm thử nghiệp vụ cô lập, không phải kiểm chứng mọi CDN trên điện thoại thật.
- Log: `scratch/consultation-regression.log`, `scratch/consultation-payroll-ui.log`. Kết quả cuối và production được cập nhật sau kiểm chứng.

## Phát hành

- Report: `20260909-consultation-payroll-v1`; PWA: `tdt-chamcong-v162-consultation-payroll-20260909`.
- Đã xác minh quyền CLI `hdung25`, scope `ha-huy-dungs-projects`, project `timekeeping-system`, ID `prj_58GRPpalLQeeweIG1MYu3ji5K6ZH`, alias `https://timekeeping-system-tawny.vercel.app`.
- Deployment trước phát hành: `dpl_4hniRBAjWBLR2hZk7FEh5ZHxRnt1`, target production, Ready.
- Không thay Firestore Rules, không migration hoặc ghi dữ liệu lương thật. Các báo cáo đang sửa từ phiên trước được giữ ngoài commit này.
- Nếu cần quay lại: rollback đúng deployment trên sau đối chiếu trạng thái; không xóa cấu hình/nhật ký lương. Dữ liệu giữ tương thích với phiên bản trước.

## Kết quả trước phát hành

- PASS: npm test; npm run test:payroll-ui; npm run test:rules (exit 0).
- PASS: kiểm tra cú pháp report/service worker/test và git diff --check.
- Quyền và trạng thái tài chính kiểm tra bằng Rules thật trên emulator. Không phát hành lại Rules vì không có thay đổi Rules.
