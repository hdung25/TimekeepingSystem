# Họp và tổng quan xét tăng lương — 21/09/2026

Phạm vi theo RuleHD: setup họp, điểm danh admin/nhân viên, tổng hợp tháng, tiêu chí X, đọc phiếu lương; bổ sung yêu cầu tổng quan xét tăng lương nhiều giáo viên. Không chạy migration hoặc thay dữ liệu nghiệp vụ production.

## Họp

- Rules cho phép nhân viên đọc tài liệu điểm danh chuẩn của chính mình khi chưa tồn tại; không mở quyền đọc danh sách hoặc dữ liệu người khác. Banner lần điểm danh đầu đã được kiểm bằng Chrome + emulator.
- Bảng tháng là tổng hợp tự động. Nút Lưu chỉ lưu số tờ/chuyên môn; sửa điểm danh tại Lịch Đã Tạo → Chi tiết hoặc Thống Kê. Tránh lưu một ô tổng hợp khác với kết quả từng buổi và bảng lương.
- Admin sửa điểm danh ghi attendance và ô tháng cùng một batch, vô hiệu cache tháng. Chọn “Chưa điểm danh (mở lại)” bỏ cờ khóa/giờ cũ, giữ thông tin RSVP và các trường không liên quan để nhân viên điểm danh lại trong khung giờ.
- Trang nhân viên chỉ suy ra vắng không phép để hiển thị khi hết giờ; mở trang không ghi đè một lượt điểm danh vừa được ghi trên máy khác.
- Buổi tự chọn chỉ cung cấp bằng chứng có mặt, không tự tạo mức trừ ở tổ khác. Chuyên môn đã lưu tại bảng tháng được ưu tiên giống nhau ở grid và report.
- Cổng kiểm tra cơ sở của họp dùng cơ chế lấy điểm mới/phục hồi có giới hạn hiện có, ưu tiên CS1, không bỏ kiểm tra khi cấu hình thiếu. Nhãn thông báo giữ đúng RuleHD. Họp online có requireNetwork=false vẫn được điểm danh không qua cổng này.
- Sửa lịch cùng tháng giữ điểm danh; điểm danh sẵn chỉ dùng khi admin chủ động xác nhận toàn bộ. Nhân viên RSVP tham gia chưa phải đã điểm danh.

## Tổng quan xét tăng lương

- Trang mặc định “Tổng quan & thao tác hàng loạt”; hồ sơ chi tiết vẫn dùng cho lịch sử, tách nhóm ngoại lệ, hẹn lại hoặc hủy mức chờ hiệu lực.
- Chọn nhiều giáo viên, tải công/giá theo yêu cầu, nhập chu kỳ/ngày nhắc chung rồi sửa từng nhóm. Mốc cũ được giữ, lần setup đầu dùng ngày hiện tại làm mốc ban đầu do admin lưu rõ ràng.
- Hiển thị 3 tháng đã kết thúc từ phiếu GV đã gửi/nhận: giờ dạy, chuyên cần theo số ca, off có phép, vắng khác, trễ. Dữ liệu thiếu không đổi thành 0. Phiếu cũ không lưu thời lượng vắng thì hiện “chưa lưu giờ”; các lần Lưu & Tính sau lưu thêm phút vắng có căn cứ từ chip lịch, không sửa phiếu cũ.
- Hiển thị giá từng môn; suy nhóm mới theo từng mức giá, không gộp giá ngoại lệ hoặc tự xác nhận nguồn mâu thuẫn. Nhập mức mới hoặc cộng mức tăng vào giá thực tế. Tổng quan chỉ chấp nhận mức cao hơn giá trước.
- Lưu nhắc chỉ ghi profile/history qua service đã có. Xem trước không ghi giá. Duyệt từng nhóm qua transaction có kiểm tra revision và nguồn; nhóm tiếp theo của cùng người được xem lại giá với chỉ những thay đổi đã duyệt trong đợt được phép khác.
- Đợt nhiều người không phải một transaction toàn cục. Nếu lỗi, báo rõ số nhóm đã áp và dừng phần còn lại; không rollback đè thay đổi mới. Quyết định thành công có audit và đường hủy theo service cũ. Phiếu đã tính/gửi và tháng không hợp lệ vẫn bị chặn.

## Cách dùng cho buổi họp sắp tới

1. Tạo lịch, chọn ngày/giờ bắt đầu-kết thúc, giờ mở/đóng điểm danh và đúng người tham dự.
2. Muốn nhân viên tự điểm danh: chọn chế độ tự điểm danh. Chỉ bật điểm danh sẵn nếu admin muốn xác nhận mọi người ngay khi tạo.
3. Nhân viên vào Họp Của Tôi hoặc banner trên trang chấm công; RSVP không thay điểm danh. Sau giờ đóng điểm danh nhưng trước hết cuộc họp ghi Trễ theo chính sách hiện có.
4. Admin kiểm tra Chi tiết; sửa Có/Trễ/Vắng tại đúng buổi. Muốn cho tự điểm danh lại, chọn Chưa điểm danh (mở lại).
5. Tiêu chí X của giáo viên chế độ cũ đọc dữ liệu họp thống nhất khi tính. Phiếu đã gửi vẫn là snapshot; nếu sửa họp sau khi gửi, admin cần tính lại và gửi hiệu chỉnh theo luồng lương hiện có.

## Bằng chứng và trạng thái phát hành

- Baseline frontend: `dpl_7zBvK4L1t3sdovJPNkxHnFVRpPY3`, production alias đúng `timekeeping-system-tawny.vercel.app`.
- Baseline Rules: `projects/timekeeping-69f3f/rulesets/c4afe25a-7b36-4024-996d-918bd1f2b8e2`. Snapshot cục bộ tại `scratch/meeting-review-rules-before.rules`.
- GET-only baseline: 5 meetings, 72 meeting_attendance, 1 meetings_log, 113 salary_settings_monthly, 5 salary_settings, 0 salary_review_profiles. Tại thời điểm kiểm tra không có cuộc họp từ 21/09/2026 trở đi. CS1 đã cấu hình cổng kiểm tra cơ sở.
- Dữ liệu/ảnh/log kiểm chứng ở `scratch/`, bị loại khỏi Git và Vercel. Không dùng tài khoản nhân viên production để ghi công hoặc lương thử.
- Frontend commit `bf794b4` đã push main và deploy trực tiếp lúc 02:08:02 UTC+7. Deployment `dpl_FpGg7Ciok2terxyN7QFRyQixQzjb`, target `production`, trạng thái `Ready`; `vercel inspect` xác minh alias chính thức trỏ đúng bản này.
- Rules đã deploy đúng project `timekeeping-69f3f`, ruleset `efad8b64-1a29-4d51-8cbf-119697f4eb18`; GET Rules sau deploy có nội dung khớp file local.
- `npm test` (pretest + toàn bộ regression), Rules suites, meeting UI, salary review UI cá nhân và hàng loạt, payroll UI tính/gửi/nhận/hiệu chỉnh/in đều PASS. Kiểm tra cú pháp script và inline HTML, `git diff --check` đều qua. Luồng xét lương được chạy lại sau các chỉnh sửa cuối về giữ đề xuất chưa áp và chặn giảm giá.
- Production smoke: HTTP200, hash 19 tài nguyên khớp local, Chrome login 430px không tràn ngang, `browserErrors: []`, PWA cache `tdt-chamcong-v193-meeting-review-20260921` có65 tài nguyên. Không ghi dữ liệu production trong smoke.
- Deep equality trên dữ liệu trước02:01:25 và sau02:08:17 UTC+7: 196 tài liệu trong meetings/meeting_attendance/meetings_log/salary_settings_monthly/salary_settings giữ nguyên toàn bộ trường; salary_review_profiles vẫn0. So sánh bỏ qua thứ tự key của JSON Firestore, không chỉ so sánh chuỗi JSON thô. Bằng chứng: `scratch/meeting-review-data-comparison.json`.
- Không có cuộc họp sắp tới được tự tạo, không có lịch nhắc hoặc mức lương nào tự bật/áp trên production. Đây là lựa chọn vận hành cần admin thực hiện qua giao diện sau phát hành.
