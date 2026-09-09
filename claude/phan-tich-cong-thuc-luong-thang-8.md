# Đối chiếu file Bảng lương tháng 8.xlsx

Nguồn: file người dùng cung cấp tại Downloads, đọc cả giá trị lưu và công thức của 8 sheet. Không sửa, ghi đè hay cập nhật liên kết ngoài của file. Các số liệu chấm công trên website tiếp tục lấy từ hệ thống; file dùng để xác định công thức, không dùng các ô 0 trong mẫu để thay dữ liệu đang tính lương.

| Sheet | Luồng dữ liệu và công thức đã đối chiếu |
|---|---|
| BẢNG LƯƠNG TG | E phân loại CDC/CD25. U tổng giờ, thường từ F:Q; một số dòng có giờ riêng ở R:T. V tính lương từ giờ từng nhóm và đơn giá tra bảng ngoài. AL/AM/AN lần lượt là vắng phép/đột xuất/không phép. AR là chuyên cần. BO cộng các khoản đánh giá, W lấy BO, AI cộng lương và các khoản bổ sung, AK trừ AJ tạm ứng. Có các công thức riêng theo nhân sự; không dùng chúng để thay hàng loạt đơn giá đã nhập trên website. |
| BẢNG LƯƠNG TT | K cộng giờ E:J. L dùng giờ nhân đơn giá. N lấy phí tư vấn. AZ/BA tách giờ cố định/linh động; BB lấy số buổi vắng × 4; BC/BD giảm hệ số cố định và chặn tối thiểu 1. BG ánh xạ đánh giá A/B/C/D. BH là điểm đóng góp và BI chia quỹ thưởng theo điểm; BJ/BK xử lý CS2. U cộng thu nhập, W trừ tạm ứng. Luồng tiếp tân được giữ nguyên trong thay đổi chuyên cần giáo viên. |
| quy định bảng lương | Ghi tiêu chí thâm niên, họp, tổng giờ, trễ, vắng, làm việc riêng, soạn bài và tác phong. Phần mô tả có những mốc khác với công thức đang dùng; yêu cầu mới nhất của chủ hệ thống chốt AR4 làm chuẩn cho chuyên cần cũ. |
| DANH SÁCH NV | Là bảng liên kết theo mã nhân viên. O tra thực lĩnh giáo viên, P là phần tiếp tân, Q cộng O:P. Các cột T/U/V là dữ liệu họp theo bộ môn. Không nhập các thông tin định danh/cá nhân từ file vào hệ thống. |
| LUONG NV | Các bảng lương riêng, có lương ngày, tỷ lệ 80%, số ngày quy đổi từ giờ, phụ cấp, hiệu suất và thực lĩnh sau khấu trừ. Đây là cách tính riêng theo người, không phải công thức chuyên cần chung. |
| phí tư vấn TT | G chọn 3%/2%/1,5% theo giá trị bill F; J = G × F / H / I, tương ứng số lần và số người tư vấn; D cộng tiền chi tiết của nhân viên. Không thay cơ chế nhập phí tư vấn đã được duyệt trước đó. |
| TIÊU CHÍ ĐÁNH GIÁ | Mẫu nhận xét bằng văn bản, không có công thức suy ra mức tiền từ giờ công. Các đánh giá và số tiền khác đã nhập tiếp tục giữ nguyên. |
| DROP LIST | Giải nghĩa trạng thái họp, nhận xét và chế độ lương: CDC là cũ, CD25 là chế độ từ 2025, TV là thử việc. |

## Công thức chuyên cần cũ được đưa vào hệ thống

Theo BẢNG LƯƠNG TG!AR4, U là giờ dạy, AL là vắng phép, AM là đột xuất, AN là không phép. Hệ thống cộng ca chưa cập nhật vào số vắng đột xuất theo quy định.

Thứ tự ưu tiên:

1. Có vắng không phép: −3.000 × giờ.
2. Nếu không, có vắng đột xuất/chưa cập nhật: −2.000 × giờ.
3. Nếu không, có nghỉ phép và dưới 50 giờ: −1.000 × giờ.
4. Không vắng phép: dưới 65 giờ được +1.000 × giờ; từ 65 giờ được +2.000 × giờ.
5. Vắng phép 1 buổi: từ 50 đến dưới 65 giờ được +1.000 × giờ; từ 65 giờ được +2.000 × giờ. Nhánh dưới 50 đã được xử lý ở bước 3.
6. Vắng phép 2 buổi: trên 64,99 giờ được +2.000 × giờ; còn lại 0, trừ trường hợp bước 3 đã áp dụng.
7. Các trường hợp còn lại: 0.

Đây là một kết quả cuối cùng, không cộng chồng thưởng và phạt từng buổi. Ví dụ 60 giờ, nghỉ phép 1 buổi là +60.000đ; 12 giờ, nghỉ phép 3 buổi là −12.000đ. Không vắng, dưới 50 giờ vẫn được +1.000đ/giờ đúng công thức AR4. Giữ nguyên mốc 64,99, không làm tròn giờ trước khi xét; chỉ làm tròn tiền đến đồng.

Chế độ mới vẫn dùng tổng giờ dạy × đơn giá Admin nhập theo yêu cầu riêng của chủ hệ thống; không tự áp công thức CD25 đang có trong file. Đơn giá 0 là hợp lệ. Chuyên cần chỉ tính giờ giáo viên, không lấy giờ tiếp tân/văn phòng, lớp nghỉ hoặc ca tương lai.

## Bảo toàn dữ liệu và đối chiếu

Kết quả hiện ngay ở bảng chính và cửa sổ tính lương; bỏ các checkbox xác nhận, chọn cách phạt và nút Áp dụng. Lưu chuyên cần đi cùng nút Lưu & Tính hiện có. Kết quả cũ, đầu vào và số tiền trước lần thay đổi được giữ trong lịch sử khi lưu. Các ghi chú, tiêu chí II–X, đơn giá lớp, tạm ứng và khấu trừ riêng không bị thay. Bảng lương đã gửi/đã nhận chỉ thay qua thao tác gửi hiệu chỉnh hiện có.

File có liên kết tới workbook ngoài [1], nhiều ô dữ liệu chưa điền và các tiêu đề tháng còn lưu từ mẫu khác. Có lỗi giá trị lưu ở sheet tiếp tân/phí tư vấn; vì vậy không dùng tổng cached của toàn file để thay tổng lương website. Công thức AR4 và các cột đầu vào đã được đọc trực tiếp, không dựa vào các ô lỗi này.

Đã kiểm tra 585 tổ hợp giờ/vắng bằng cách đánh giá độc lập công thức Excel, cộng các trường hợp giờ lẻ, ca chưa cập nhật và đơn giá 0. Kiểm thử trình duyệt có thay dữ liệu lịch thật trên emulator, tính lại sau khi phục hồi, bộ lọc lớp, lưu ở bảng chính/cửa sổ, ngăn ghi đè khi hai người cùng sửa và giữ nguyên bảng đã gửi.
