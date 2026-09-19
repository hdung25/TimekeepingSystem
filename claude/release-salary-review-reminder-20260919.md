# Nhắc xét trên Tổng quan — 19/09/2026

Thành phần `js/salary-review-notifications.js` chỉ được tải trên `admin.html` cùng
policy/service xét lương. Sau khi xác thực Firebase và quyền admin thật, gọi
`SalaryReviewService.queue()` một lần để đọc cấu hình + các hồ sơ xét đã lưu.
Không quét users, lương tháng, công, không tính giá, không dùng polling/listener
và không ghi tài liệu thông báo. Nhắc được suy ra ngay khi admin mở Tổng quan.

Nội dung tính số người riêng biệt và số nhóm đến hạn/quá hạn/còn trong tháng bằng
cùng `SalaryReviewPolicy.evaluate` của trang xét. Vào ngày 1 vẫn thấy hạn ngày 20.
Giữ ghi đè cá nhân/nhóm, chu kỳ 42k, ngày hẹn lại; bỏ nhóm tạm ngưng hoặc đã duyệt
mức mới còn chờ ngày hiệu lực. Đếm riêng số hồ sơ đã lưu còn cần xác nhận mốc.
Không gọi việc thiếu dữ liệu giờ là đủ điều kiện tăng. Không thể đếm người chưa có
hồ sơ nếu không quét users; khi chưa có hồ sơ nào hiển thị lời mời chuẩn bị mốc.

Thiếu quyền thì ẩn cả khối, không đọc queue. Đọc lỗi thì báo chưa tải được, không
hiển thị kết luận giả là không ai đến hạn. Đổi tài khoản trong lúc đọc thì bỏ kết
quả cũ. Liên kết đưa tới `xet-tang-luong.html`. Sidebar có mục Xét Tăng Lương chỉ
cho admin; auth-guard cũng chặn senior/staff ở trang đó. Service/Firestore Rules
vẫn là kiểm tra quyền thật; localStorage chỉ hỗ trợ định tuyến/menu như hiện có.

Kiểm thử `salary-review-notifications.test.js` đã qua: đếm người/nhóm, hạn cuối
tháng, quá hạn, 42k, ghi đè cá nhân, tạm ngưng, chờ hiệu lực, hồ sơ thiếu, gọi lặp
vẫn một lượt queue, lỗi đọc, đổi auth, route guard admin/senior/staff. Agent chính
thêm test vào suite, đồng bộ asset version/SW và kiểm tra giao diện trình duyệt
trong release chung. Phần này không ghi dữ liệu production và chưa tự deploy.
