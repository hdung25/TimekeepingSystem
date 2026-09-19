# Hướng dẫn Admin — Xét tăng lương

Tài liệu cho màn **Xét Tăng Lương**. Cập nhật 19/09/2026 trước khi phát hành; trạng thái deploy cuối xem TODO/release note. Chỉ quản trị viên chính sử dụng màn này.

## 1. Nhập lần đầu cho từng nhân viên

1. Mở **Xét Tăng Lương** trên menu, tìm và chọn giáo viên/trợ giảng.
2. Xem nhóm môn cùng cột **Giá ghi nhận / giờ** và **Nguồn gần nhất**. Có thể mở **Mở bảng công / lương ↗** để đối chiếu.
3. Chọn đúng các môn cần xét cùng nhau. Toán tiểu học, cấp 2, cấp 3 và các folder tiếng Anh được gợi ý riêng; vẫn có thể tách ngoại lệ theo từng người qua **Thêm nhóm / tách ngoại lệ**.
4. Nhập **Mức hiện tại xác nhận (đ/giờ)**. Ví dụ 32 nghìn đồng thì nhập **32000**. Đây là mức theo dõi cho nhóm; lưu hồ sơ không đổi giá đang tính lương.
5. Chọn **Loại mốc**: biết ngày tăng thật thì chọn **Ngày tăng lương gần nhất**; không biết thì chọn **Mốc bắt đầu xét do Admin xác nhận**. Việc thấy một mức giá ở tháng 8 không chứng minh đó là ngày tăng.
6. Kiểm tra giá/phạm vi/mốc, đánh dấu xác nhận và **Bật nhắc xét cho nhóm này**, rồi bấm **Lưu hồ sơ & mốc xét**.

Có thể lưu nháp khi chưa đủ dữ liệu. Nhóm chưa xác nhận không bị xem như đã đủ điều kiện tăng. Mỗi nhân viên có thể hoàn thành từng nhóm ở những thời điểm khác nhau.

## 2. Chu kỳ và ngưỡng giờ

**Quy định chung** dùng cho những chỗ chưa nhập riêng. Ô riêng theo nhân viên hoặc nhóm để trống sẽ kế thừa; nhóm ưu tiên hơn cá nhân, cá nhân ưu tiên hơn chung.

- Mặc định 3 tháng/lần; mốc 42.000 đ/giờ mặc định xét sau 6 tháng. Admin có thể đặt chu kỳ riêng khi có thỏa thuận riêng.
- **Ngưỡng tham khảo (giờ/tháng)** chỉ cảnh báo ít giờ; người đến hạn vẫn nằm trong danh sách, không tự bị loại hoặc tự hoãn. Nhập 0 để tắt cảnh báo ít giờ.
- **Tính lại gợi ý giờ** dùng phiếu GV đã gửi/nhận của tháng gần nhất. Kiểm tra số người/kỳ dữ liệu rồi bấm **Lưu quy định chung** nếu đồng ý; con số gợi ý chưa tự có hiệu lực.

Ở bản kiểm tra ngày 19/09/2026, tháng 8 có 48/61 giáo viên/trợ giảng đủ dữ liệu: trung bình **43,2 giờ**, gợi ý **43 giờ/tháng**. 13 người thiếu phiếu không tính thành 0 giờ. Con số có thể khác khi dữ liệu/kỳ thay đổi; không phải quy định bắt buộc.

## 3. Xem đầu tháng và ghi quyết định

Dashboard hiển thị số người/nhóm cần xét; trên trang xét chọn **Cần xét trong tháng**. Đầu tháng đã thấy cả người đến hạn vào những ngày cuối tháng. Nhắc được cập nhật khi mở trang; chưa có thông báo chạy khi app đóng.

Trong **Căn cứ đánh giá**, giờ hệ thống là tổng giờ dạy của người đó trong 3 tháng đã kết thúc, không phải riêng folder. Thiếu phiếu/giờ sẽ ghi rõ. Chuyên cần và hiệu suất do Admin nhận xét.

Nếu cần bổ sung số liệu cũ, nhập **Bình quân giờ Admin xác nhận**, **Kỳ xác nhận giờ (tháng kết thúc)** và **Nguồn / cách xác nhận giờ**. Đây là giờ/tháng, không phải tổng giờ tích lũy. Chỉ dùng tháng đã kết thúc; chuyển sang kỳ mới thì số cũ được đánh dấu cần kiểm tra. Việc này không sửa dữ liệu chấm công.

Các lựa chọn:

- **Hẹn xét lại…**: nhập ngày xét tiếp và lý do, giữ mốc tăng gần nhất.
- **Chưa tăng…**: lưu quyết định, lý do và ngày cần xem lại; không đổi giá.
- **Xét mức mới…**: chuẩn bị giá mới, sau đó đối chiếu và duyệt.

Lưu thay đổi hồ sơ trước khi ra quyết định. Tất cả quyết định có lịch sử.

## 4. Duyệt mức mới

1. Bấm **Xét mức mới…**, nhập **Mức mới (đ/giờ)**, **Tháng bắt đầu áp dụng** và lý do.
2. Trong **Môn nhận mức mới**, kiểm tra từng ô chọn. Môn có giá riêng hoặc dữ liệu mơ hồ cần kiểm tra thêm; không bắt buộc tăng toàn folder.
3. Bấm **Xem giá trước khi duyệt**, đọc giá trước/sau và **Xem các giá được giữ**.
4. Khi đúng người, môn và kỳ, bấm **Duyệt & áp dụng từ [tháng]**.

Chỉ áp dụng từ ngày 01 của tháng tương lai. Tháng đã có bản tính giáo viên, kể cả chưa gửi, cần xử lý qua bảng lương và không áp tự động từ màn xét. Duyệt không gửi phiếu lương, không đổi công cũ hoặc phiếu đã gửi/nhận.

**Môn bỏ chọn giữ nguyên giá và rời khỏi nhóm xét này sau duyệt.** Có thể dùng **Thêm nhóm / tách ngoại lệ** để theo dõi chúng riêng. Nhờ vậy mốc tăng và mức mới chỉ áp cho đúng các môn được duyệt.

Nếu dữ liệu vừa được sửa ở cửa sổ khác, hệ thống yêu cầu tải lại và xem trước lại. Không bấm cố để ghi đè.

## 5. Hủy mức đang chờ hiệu lực

Bấm **Hủy mức chờ hiệu lực…**, nhập lý do. Hệ thống trả lại giá/phạm vi trước quyết định khi:

- Chưa đến ngày hiệu lực.
- Vai trò lương GV của tháng đích chưa được chỉnh tiếp hoặc tính lương.
- Khôi phục phạm vi cũ không làm một môn trùng với nhóm xét khác đang bật.

Nếu đã có chỉnh sửa tiếp, hệ thống dừng để giữ dữ liệu mới; cần đối chiếu bảng lương hoặc xử lý nhóm trùng trước. Hủy không xóa phần tiếp tân, phiếu cũ hay toàn bộ tài liệu lương tháng. Mức đã có hiệu lực không hủy bằng nút này.

Người nghỉ/ngừng xét: tắt **Bật nhắc xét cho nhóm này** và ghi chú. Chưa có lịch nghỉ dài theo khoảng ngày tự động trong đợt này.

## 6. Những phần chưa có trong đợt này

Chưa triển khai thêm công dạy liên kết/tại nhà, tăng giữa tháng/hồi tố, tự gửi lương, worker thông báo khi app đóng hoặc xuất bảng tổng hợp theo mẫu mới. Các luồng chấm công, bảng công và in/PDF/ZIP cũ tiếp tục dùng như trước.
