# Chuyên cần giáo viên — 09/09/2026

## Phạm vi Rule HD

Hồ sơ `teachingMode` → công theo ca → cửa sổ tính lương → tiêu chí evaluation theo tháng → nháp/hiệu chỉnh → gửi → nhân viên nhận → chi lương/file xuất. Bản phát hành không thay schema bắt buộc, không migration, không sửa dữ liệu production hoặc Firestore Rules.

- Chế độ mới: Admin nhập đơn giá tháng; chuyên cần = phút dạy được trả lương / 60 × đơn giá, làm tròn tiền cuối cùng. Chấp nhận 0; không gồm giờ tiếp tân/văn phòng.
- Chế độ cũ: áp dụng sau xác nhận >=3 tháng và ca cố định. Chuyên cần 1.000đ/giờ khi >50 giờ và <=1 buổi vắng; 2.000đ/giờ khi >65 giờ và <3 buổi vắng, lấy mức cao hơn. Ngưỡng do chủ hệ thống xác nhận trong phiên này.
- Chưa chốt cộng thưởng với phạt và cộng phạt theo lần hay một mức: Admin phải chọn rõ. Xem trước ghi riêng tiền thưởng/phạt; ví dụ 60 giờ, 1 VP, cộng cả hai thì 0đ.
- VP/VĐX lấy phân loại ca đang có; ca thiếu cập nhật dùng mức nghỉ đột xuất riêng trong bộ tính, không sửa chip công. Đối chiếu phân loại nghỉ dưới 24h trong lịch/công trước khi áp dụng.
- Các mức tổng giờ 50/65/80 và họp có tối thiểu; trễ, tập trung, nhiệt tình, trách nhiệm, soạn bài được ánh xạ vào đúng tiêu chí hiện hữu. Khoảng thưởng/phạt và miễn phạt cần Admin chọn; không tự quyết định thay lớp, tăng bậc hoặc thôi việc.
- Mặc định không thay số cũ. Áp dụng chỉ thay tiêu chí chọn trong bộ nhớ; Lưu & Tính dùng transaction hiện có, kiểm tra baseline. Dữ liệu mới bổ sung `giao_vien.teacherAttendancePolicy` và `teacherAttendanceHistory` chứa điều kiện, công nguồn, trước/sau, người/thời điểm.
- Khôi phục lần trước tạo bản sửa có lịch sử, không xóa mục lương khác. Bảng đã gửi/đã nhận giữ nguyên tới thao tác gửi hiệu chỉnh rõ ràng. Quản lý cấp cao chỉ xem phần này, quyền phí tư vấn giữ nguyên.
- Chặn lưu điều kiện chưa áp dụng hoặc công nguồn đã đổi; cần đối chiếu/áp dụng lại, tránh lưu số chuyên cần cũ theo giờ mới. Thứ tự khóa Firestore không ảnh hưởng so sánh.

## Kiểm thử và phát hành

- Unit: `teacher-attendance-policy.test.js`: biên 50/65/80, VP/VĐX/VKP/chưa cập nhật, tối thiểu họp, điều kiện, số lẻ, 0, phạm vi giờ giáo viên.
- Browser: `teacher-attendance-ui.cjs`, tích hợp emulator `demo-timekeeping`: mở không ghi, áp dụng chưa ghi, lưu/tải lại, tổng đa vai trò, khôi phục, hiệu chỉnh về 0, bảng đã nhận, stale save, công thay đổi, quản lý chỉ xem.
- Regression hiện có bao phủ công tháng, sửa ca, early-10, tháng chi, gửi/nhận/file xuất. Log trong `scratch/teacher-attendance-*.log`.
- PWA: v164, giữ quy trình cập nhật không ngắt thao tác ghi đang chạy.
- Đích đã kiểm tra: account `hdung25`, scope `ha-huy-dungs-projects`, project `timekeeping-system`, ID `prj_58GRPpalLQeeweIG1MYu3ji5K6ZH`, alias `https://timekeeping-system-tawny.vercel.app`.
- Mốc rollback trước phát hành: `dpl_6VBm7BtTqbtoHG5anVGs22AVKvoV`, production Ready. Nếu rollback mã, giữ dữ liệu evaluation và lịch sử; mã trước vẫn đọc số tiền theo định dạng cũ.
- Các thay đổi tài liệu có sẵn từ tác vụ trước được giữ ngoài commit này.

## Kết quả kiểm chứng trước deploy

- PASS `npm test`, `npm run test:payroll-ui`, `npm run test:rules` (exit 0); cú pháp JS và `git diff --check` đạt.
- Browser xác minh 4 giờ GV × 1.234đ = 4.936đ; giữ 2 giờ TT riêng; tổng GV 384.936đ, hiệu chỉnh đơn giá 0 về 380.000đ; họp đủ dưới 30 giờ nhận tối thiểu 30.000đ.
- Kiểm tra thêm ngăn cộng lại phạt vắng/trễ khi ô khấu trừ đã có tiền, cả lúc áp dụng và trước lưu. Không tự xóa khoản phạt đã nhập.
- Đã xem ảnh giao diện hai chế độ; bộ tính dùng vùng cuộn chính, không nằm trong bảng tiêu chí cao 250px. Ảnh và log nằm trong scratch, không deploy.
