# Báo cáo sửa lỗi nhân sự mới không hiện trong xếp lịch

Ngày: 08/09/2026
Phạm vi: Nhân sự → Lịch làm → bộ chọn GV chính/GV dạy thay

## Kết luận nguyên nhân

- Trang Lịch làm chỉ gọi `DBService.getUsers()` khi khởi tạo và giữ kết quả trong `window._teacherList` cho tới khi tải lại trang.
- Nếu Admin thêm nhân sự ở tab hoặc thiết bị khác sau khi trang lịch đã mở, bộ chọn ca tiếp tục dùng danh bạ cũ nên không thấy người mới.
- Ca chỉ có một GV chính cố ý không cho bỏ người cuối để tránh lưu ca không có GV. Khi người mới bị thiếu khỏi danh sách, thao tác đúng “chọn người mới rồi bỏ người cũ” trở thành không thể thực hiện và bị hiểu là ca không sửa được.
- Ca đã bắt đầu vẫn khóa thay đổi danh sách GV chính để bảo toàn lịch sử; luồng Vắng/GV dạy thay vẫn hoạt động. Quy tắc này được giữ nguyên.

## Bằng chứng production (chỉ đọc)

- `users`: 80 hồ sơ.
- `staff_directory`: 80 hồ sơ; khớp số lượng và các hồ sơ “THỦY” với `users`.
- Hai hồ sơ tên `THỦY` được tạo ngày 04/09/2026, lần lượt có vai trò `staff` và `teaching_assistant`; cả hai đều là vai trò được phép xuất hiện trong danh sách giảng dạy.
- Không hồ sơ nào trong hai hồ sơ trên đang được gắn vào 296 tài liệu lịch đã kiểm tra.
- Không tìm thấy hồ sơ có tên đầy đủ đúng chuỗi “Thanh Thủy”; hệ thống không tự suy đoán hoặc tạo lại hồ sơ để tránh nhân đôi dữ liệu.
- Không ghi, sửa hoặc xóa dữ liệu production trong quá trình điều tra.

## Thay đổi

- Mỗi lần mở bộ chọn GV của một ca, tải lại danh bạ trực tiếp từ máy chủ và bỏ qua cache 60 giây.
- Nếu tải mới thất bại, giữ nguyên danh sách đang có, hiển thị cảnh báo và cho bấm **Làm mới**; không xóa trắng danh sách.
- Giữ lại người đã được xếp trong dữ liệu lịch cũ ngay cả khi hồ sơ không còn trong danh bạ, tránh mất liên kết lịch sử.
- Hiển thị `@username` cùng tên và vai trò để phân biệt người trùng tên.
- Tìm kiếm không phân biệt dấu (`Thanh Thuy` vẫn tìm được `Thanh Thủy`).
- Khi không có kết quả, giải thích rõ cần làm mới hoặc kiểm tra vai trò Giáo viên/Trợ giảng tại trang Nhân sự.
- Hướng dẫn đổi GV đúng thứ tự và thông báo rõ vì sao không thể bỏ GV chính cuối cùng.
- Không thay đổi logic lương, chấm công, +10 phút, dữ liệu ca hoặc Firestore Rules.

## Kiểm thử trước deploy

- Kiểm tra cú pháp JavaScript và `git diff --check`: đạt.
- Bộ kiểm thử ứng dụng: đạt.
- Firestore Rules: 33/33 kịch bản đạt.
- Kiểm thử trình duyệt emulator đã xác nhận luồng:
  1. Mở trang lịch để tạo danh bạ cũ.
  2. Thêm nhân sự mới vào `users` và `staff_directory` từ luồng độc lập.
  3. Mở ca và thấy ngay nhân sự mới nhờ đọc máy chủ.
  4. Tìm tên không dấu và thấy username phân biệt.
  5. Không thể bỏ GV chính duy nhất trước khi chọn người mới.
  6. Chọn người mới, bỏ người cũ, lưu thành công.
  7. Ghi chú ca mục tiêu và toàn bộ ca bên cạnh được giữ nguyên.

## Deploy và hậu kiểm

Sẽ bổ sung commit, deployment ID, trạng thái production và kết quả smoke sau khi deploy.
