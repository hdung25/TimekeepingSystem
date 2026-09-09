# Quản lý cấp cao được nhập phí tư vấn — 09/09/2026

Theo xác nhận của chủ hệ thống trong phiên này, quản lý cấp cao được nhập/lưu phí tư vấn. Quyền tính/gửi/hiệu chỉnh bảng lương và sửa đơn giá, tạm ứng, thưởng khác vẫn thuộc Admin. Cập nhật quy định tại `.agents/AGENTS.md`.

## Thay đổi

- Form mở riêng ô Phí tư vấn và nút Lưu phí tư vấn cho senior_assistant; CS3 và các khoản khác giữ chỉ xem.
- DBService dùng transaction kiểm tra cấu hình đã xem, chỉ sửa evaluation ID 1, giữ nguyên các trường khác và bản lương đã gửi/đã nhận. Hỗ trợ ID tiêu chí dạng chuỗi, key tiep-tan cũ, tháng chưa có cấu hình (kế thừa nguyên vẹn mặc định do Admin thiết lập) và sửa về 0.
- Firestore Rules cho senior tạo/cập nhật đúng phí tư vấn; không mở quyền gửi lương, sửa thưởng/ứng/đơn giá, sửa lịch sử hoặc xóa bảng lương. Ghi người thao tác và thời gian máy chủ tại consultationFeeEdit.
- consultationFeePending đánh dấu cần tính lại. Luồng gửi thường/hàng loạt/gửi hiệu chỉnh của ứng dụng từ chối dùng bản tính cũ; khi Admin tính phần tiếp tân, transaction đối chiếu phí mới và gỡ cờ cùng lúc lưu bản tính/nháp hiệu chỉnh.
- Không tự đổi bản nhân viên đang xem. Với lương đã gửi, Admin tính lại và gửi hiệu chỉnh theo luồng hiện có.
- Cache PWA v163; đồng bộ version report/db-service trên các trang và service worker.

## Kiểm thử và phát hành

- Bài Rules mới: test-automation/senior-consultation-rules.cjs; bài trình duyệt bổ sung trong payroll-review-ui.cjs.
- Kiểm thử ghi dữ liệu chỉ trên Firebase Emulator demo-timekeeping; không ghi lương thật để thử.
- Production đã xác minh: Firebase timekeeping-69f3f; Vercel ha-huy-dungs-projects/timekeeping-system, prj_58GRPpalLQeeweIG1MYu3ji5K6ZH; alias https://timekeeping-system-tawny.vercel.app.
- Deployment trước phát hành: dpl_H7B7c77p5uijQwLu1WQGbqb21KGG. Nếu quay lại cần đối chiếu các consultationFeePending mới; mã cũ không có chặn gửi khi phí thay đổi. Không xóa dữ liệu hoặc lịch sử để rollback.

## Kết quả trước phát hành

- PASS npm test, npm run test:rules, npm run test:payroll-ui (exit 0).
- Rules kiểm chứng lưu phí, sửa 0, tháng mới giữ mặc định, key/ID legacy; chặn sửa khoản khác và bảng lương, chặn gửi bản tính/hiệu chỉnh cũ. Browser kiểm chứng senior lưu/tải lại 81.675đ và Admin tính lại đúng.
- Kiểm tra cú pháp JavaScript và git diff --check đạt. Log: scratch/senior-fee-regression.log, scratch/senior-fee-rules.log, scratch/senior-fee-ui.log.

## Production

- Commit đã push origin/main: a846787.
- Firebase CLI biên dịch và phát hành Rules thành công vào timekeeping-69f3f.
- Vercel dpl_6VBm7BtTqbtoHG5anVGs22AVKvoV: READY, production, 10:01 ngày 09/09/2026 UTC+7. Alias chính đã xác minh trỏ đúng deployment.
- PASS production-readonly-smoke.cjs: 9 tài nguyên HTTP 200 và SHA-256 khớp mã local; HTML đúng phiên bản; Chrome mobile không tràn ngang/uncaught JS error, service worker active và cache v163 có 52 tài nguyên. Không ghi Firestore production để test.
- Bằng chứng: scratch/senior-fee-production.log; scratch/production-senior-consultation.json/png. Nghiệp vụ ghi dữ liệu kiểm chứng trên emulator, không phải tài khoản nhân viên production.
