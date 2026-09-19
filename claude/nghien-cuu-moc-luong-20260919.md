# Nghiên cứu mức chuẩn và thiết kế xét tăng lương mở

Ngày 19/09/2026. Bổ sung cho phân tích ban đầu sau khi người dùng yêu cầu tự kiểm tra các mức đã được admin nhập và không áp dụng máy móc đề xuất ban đầu. TODO/trạng thái triển khai nằm ở `TODO_XET_TANG_LUONG.md`.

> **Bàn giao triển khai cùng ngày:** phần nghiên cứu phía dưới ghi nhận thời điểm khảo sát ban đầu. Hiện đã có mã sản phẩm và đang nghiệm thu trước phát hành; xem mục 11 cuối tài liệu, TODO và `release-checklist-20260919.md`. Không đọc các câu “chưa triển khai” của nghiên cứu cũ như trạng thái cuối hiện tại.

## 1. Đính chính quan trọng so với phân tích đầu

Người dùng đúng ở điểm lịch sử giá đã có một phần: các bảng lương và mức nhập theo tháng cung cấp bằng chứng thực tế tốt hơn chỉ nhìn cấu hình nhân sự. Không yêu cầu admin nhập lại những mức có thể đọc và đối chiếu từ dữ liệu hiện hữu.

Tuy nhiên, **lịch sử quan sát được đơn giá** và **lịch sử quyết định tăng lương có ngày hiệu lực** là hai loại thông tin khác nhau. Có thể biết tháng 8 một người nhận 34.000 cho Toán 1, nhưng chưa biết người đó bắt đầu nhận mức này từ tháng 5 hay tháng 8. Ngày gửi phiếu cũng không phải ngày tăng lương.

Giải pháp phù hợp là kế thừa bằng chứng cũ → gợi ý mốc/giá với nguồn rõ → admin xác nhận lần đầu → tạo lịch sử quyết định chuẩn từ đó. Không xóa cấu hình cũ hoặc tái tạo lịch sử giả.

## 2. Đã đọc dữ liệu gì

Đọc Firestore project hiện hành qua REST theo chế độ chỉ đọc, có phân trang, chỉ lấy các trường phục vụ nhân sự/vai trò/giá/môn/phiếu. Không đọc credential/mật khẩu, không ghi database. Bản cục bộ nằm trong thư mục `scratch/` đã được Git ignore, không đưa vào commit.

| Nguồn | Số lượng đọc | Phạm vi |
|---|---:|---|
| users | 76 | Vai trò, trạng thái, cấu hình giá và thông tin cần đối chiếu |
| subjects | 74 | Môn và nhóm, ID, tên, cha, loại nhóm |
| salary_settings_monthly | 112 | Các tháng 05–08/2026, cấu hình GV và bản phiếu |

Chưa quét toàn bộ attendance/lịch từng ca hoặc toàn bộ revision; số liệu giờ ở nghiên cứu này lấy từ phần giáo viên của phiếu đã lưu. Chưa đọc `salary_settings` cũ trên production. Những giới hạn này phải được xử lý trong adapter sản phẩm nếu nguồn fallback đó cần dùng.

Danh sách mặc định giáo viên/trợ giảng thu được 60 hồ sơ theo vai trò dạy học, loại role thuần admin/tiếp tân/trợ lý không có role dạy. Đây là phân loại theo trường hiện hữu, chưa phải xác nhận tất cả đang làm đủ kỳ; cần cho admin xem danh sách và loại trừ có lý do/ngày hiệu lực.

## 3. Ngưỡng giờ: chọn con số dựa trên bằng chứng

| Phương pháp thử | Kết quả | Đánh giá |
|---|---:|---|
| Trung bình các tháng có dữ liệu trong 06–08, theo mỗi người rồi lấy trung bình người | 41,02 giờ; 51 người, 60 quan sát người-tháng | Có cả nháp; mỗi người có số tháng khác nhau; không dùng làm chuẩn ba tháng |
| Trung bình tháng 8 gồm cả phiếu nháp | 42,72 giờ; 50 người | Chưa loại dữ liệu chưa gửi |
| Trung bình tháng 8 chỉ phần GV đã gửi/đã nhận | **43,208 giờ; 48 người** | Đủ để đề xuất ngưỡng tạm thời, chưa đại diện đủ 60 người |
| Trung vị cùng mẫu 48 người | 38,25 giờ | Cho thấy trung bình bị kéo bởi các người làm nhiều giờ |
| Chỉ giờ dạy thường + tin học + mầm non của cùng mẫu | 40,198 giờ | Phạm vi khác; không được gọi là cùng một chỉ tiêu với tổng giờ dạy |

Trong 60 hồ sơ thuộc nhóm xét mặc định: 42 người có dữ liệu giờ cho một tháng, 9 người có hai tháng, 9 người chưa có tháng nào trong 06–08 theo projection đã đọc. **Không có người nào đủ cả ba tháng** theo nguồn phiếu đang khảo sát. Thiếu phiếu không có nghĩa là không làm; công thực tế có thể vẫn tồn tại và cần đối chiếu riêng khi cần.

Mẫu chính tháng 8 có 48 phiếu GV đã gửi/nhận, 2 nháp bị loại; 12/60 người không có phiếu GV tháng 8 đủ điều kiện vào mẫu. Một phiếu trong mẫu có 0 giờ và vẫn được giữ, vì 0 đã ghi nhận khác với thiếu dữ liệu. Biên quan sát 0–161 giờ, không tự loại người cao giờ là bất thường.

**Đề xuất mặc định:** hiển thị 43 giờ/tháng, nhãn “Gợi ý từ 48 phiếu GV đã gửi/nhận tháng 08/2026; trung bình 43,2 giờ. Có thể chỉnh.” Chỉ thành ngưỡng sử dụng sau khi admin lưu. Không hardcode 43 trong công thức dài hạn.

Cách tính giờ mẫu chính: cộng `totalBaseMins`, `totalTinHocMins`, `totalPreschoolMins`, `totalAffiliateMins`, `totalTutoringMins` trong phần GV; không cộng giờ TT/VP, không cộng `totalExtraMins`. Đây là **giờ tính lương theo phiếu**, có thể khác giờ dạy thực tế. Dù chưa mở chức năng mới cho dạy liên kết/tại nhà, phiếu hiện có vẫn chứa loại giờ này; UI phải nói rõ phạm vi giờ, không âm thầm loại hoặc gộp.

Không dùng ngưỡng giờ để đánh giá thay hiệu suất. Ít giờ có thể do chưa được xếp đủ lớp; dashboard nên cho admin thấy giờ và nhận xét riêng. Nên lưu giờ được phân công khi bổ sung đủ nguồn, để phân biệt ít lịch và không hoàn thành lịch.

Ngưỡng riêng theo nhân viên/nhóm được phép ghi đè. Khi đủ dữ liệu ba tháng, có thể gợi ý tính lại theo ba tháng hoàn chỉnh; không tự thay cấu hình đã chốt hoặc tiêu chí của hồ sơ đang xét.

**Điều chỉnh so với ý tưởng đầu:** không tự giãn kỳ vì thấp hơn ngưỡng. Đến hạn vẫn thông báo; hiển thị “ít giờ, cân nhắc hoãn 1 tháng” và admin quyết định. Điều này tránh giấu hồ sơ hoặc kéo dài mãi mà không ai xét.

## 4. Suy mức chuẩn theo nhóm: dữ liệu thực tế cho thấy gì

Folder hiện có: Tiếng Anh → tiếng Anh trên trường / Tiếng Anh giao tiếp; Toán -TV; LIÊN KẾT. Toán 1–12 đang chung folder Toán -TV, chưa tách riêng cấp học trong danh mục.

Đề xuất nhóm xét riêng: Toán 1–5, Toán 6–9, Toán 10–12. Tham chiếu ID môn, không di chuyển môn đang được lịch/bảng lương dùng. Các môn Tiếng Việt, Ngữ văn, rèn chữ không tự coi là Toán tiểu học chỉ vì nằm chung folder.

Khảo sát sơ bộ bằng tên môn khớp duy nhất và giá đơn môn, loại giá lớp đông, lớp ghép và phạm vi ngoài đợt này: 49/60 người có ít nhất một nhóm có bằng chứng, khoảng 100 cặp người–nhóm. 21 nhóm chứa mức giá khác nhau; hai nhóm không có mức đa số duy nhất. Đây là số khảo sát ban đầu, không phải danh sách đã được duyệt; adapter hoàn chỉnh với alias/ID và provenance có thể thay đổi số lượng.

Giá quan sát được có nhiều mức ngoài 30–56, ví dụ 20.000, 24.000, 44.000, 46.000, 60.000 và cao hơn. Một số số lẻ như 66.666/66.667 cần đối chiếu nguồn trước khi coi là mức chuẩn. **Không có căn cứ kết luận chúng là lỗi; tuyệt đối không ép hoặc làm tròn về thang.**

Các vấn đề mapping thực tế:

- `Pre I1` và `PRE-I1` có hai ID riêng, dù bỏ khoảng trắng/dấu gạch sẽ ra cùng khóa. Chưa được dùng tên chuẩn hóa để chọn một trong hai.
- Có tên cũ `FFS01`, `Movers 1`, `Pre- I2`, khác tên trong danh mục. Chỉ làm alias sau xác nhận; không fuzzy match rồi ghi giá.
- Các dòng `Toán 3 + Toán 9`, `E2 + Nv9`, `E7+FFL` đi qua nhiều nhóm. Một giá của dòng ghép không cho biết giá riêng của từng môn.
- Các dòng `(+10 HS)`, `(+12 HS)` là lớp đông; tách khỏi mức chuẩn.
- Cấu hình tháng có thể chứa giá vừa sửa khác bản phiếu đã gửi; phải hiển thị hai nguồn thay vì chọn một nguồn để phủ nhận nguồn kia.

Quy trình gợi ý:

1. Lấy mức đã nhập của từng môn đúng nhân viên, đúng vai trò và kỳ; đọc riêng cấu hình đang dùng và giá đã chốt.
2. Liên kết ID hoặc alias duy nhất đã xác nhận; giá lớp ghép/ngoại lệ giữ riêng.
3. Gom theo nhóm xét. Nếu các giá đồng nhất, gợi ý giá chung; môn thiếu dữ liệu ghi “gợi ý theo nhóm”, không ghi “đã được trả mức này”.
4. Nếu có nhiều giá, liệt kê môn và mức, gợi ý mức phổ biến chỉ để hỗ trợ. Admin chọn giá nền và các ngoại lệ; không tự đưa mức đa số lên thay toàn bộ.
5. Gợi ý khoảng thời gian quan sát được. Chỉ nâng thành mốc xác nhận khi admin đồng ý hoặc có quyết định cũ đủ bằng chứng.
6. Lưu xác nhận lần đầu có người xác nhận, ngày, nguồn, phiên bản; không ghi lại `attendance_logs`, giá tháng cũ hoặc phiếu.

## 5. Mốc chuẩn nên gồm hai phần

**Mức giá chuẩn:** số tiền admin xác nhận cho nhóm, các môn áp dụng và ngoại lệ. Có thể suy gợi ý tốt từ bảng lương hiện hữu.

**Mốc thời gian xét:** ưu tiên ngày tăng gần nhất có xác nhận; nếu thiếu, admin chọn “mốc xét khởi tạo” và ghi nguồn. Không bắt buộc bịa một ngày tăng để hệ thống chạy. Chu kỳ tiếp theo từ lần tăng được duyệt sẽ có ngày hiệu lực chính xác.

Hồ sơ có thể lưu nháp khi thiếu mốc. Nhắc “cần bổ sung mốc” là một tác vụ admin, không biến thành “chưa đến hạn”. Một cá nhân có thể xác nhận xong nhóm Tiếng Anh trường trong khi nhóm giao tiếp còn nháp.

## 6. Kiến trúc mở đề xuất

```text
Nguồn cũ: nhân sự / môn / cấu hình tháng / phiếu đã chốt / công khi cần
                                |
                      Adapter chỉ đọc + provenance
                                |
                 Gợi ý nhóm, giá, mốc và độ đầy đủ
                                |
                     Admin xác nhận hồ sơ ban đầu
                                |
        Chính sách chung → quy định cá nhân → quy định nhóm
                                |
                  Bộ xét thuần + snapshot chứng cứ
                                |
        Hàng đợi nhắc đầu tháng / hồ sơ thiếu / hẹn lại
                                |
           Duyệt / hoãn / không tăng + lịch sử quyết định
                                |
             Lịch sử giá mới → đối soát → áp vào kỳ phù hợp
                                |
               Luồng tính / gửi / nhận lương hiện hành
```

Các thực thể cần phân biệt: policy có phiên bản; hồ sơ xét của nhân viên; nhóm xét và membership; chu kỳ/hồ sơ đánh giá; chứng cứ nguồn; quyết định; lịch sử đơn giá có hiệu lực; trạng thái áp dụng; trạng thái thông báo.

Thứ tự kế thừa cấu hình: nhóm xét của người → nhân viên → mặc định chung. Để trống là kế thừa; 0 là 0 nếu trường cho phép. Có màn “đang dùng quy tắc nào” để admin không phải nhớ mình đã ghi đè ở đâu.

Các trường cấu hình nên có giới hạn kiểm tra: chu kỳ nguyên tháng, ngưỡng giờ không âm, chế độ dùng giờ tổng/giờ nhóm, độ dài kỳ đánh giá, khoảng nhắc, hiệu lực policy, đối tượng áp dụng. Không xây trình nhập công thức hoặc chạy code tùy ý.

Chuyên cần/hiệu suất ban đầu gồm dữ liệu đọc được + ô admin đánh giá theo trạng thái đạt/cần xem lại/chưa đủ dữ liệu và ghi chú. Chưa có chính sách thì không tự đặt ngưỡng vắng/trễ thành điều kiện loại. Cấu trúc đủ để thêm tiêu chí ở phiên policy sau.

**Tách thông báo và quyền tiền:** tác vụ nhắc chỉ quản lý hồ sơ xét. Quyết định tăng và áp giá cần admin chính, điều kiện phiên bản, audit và chống thực hiện lặp. Nếu có worker sau này, không cho worker nhắc quyền sửa lương.

## 7. Tự động đúng lịch admin sử dụng

Ngày 1 mở danh sách phải thấy cả người đến hạn ngày 20 trong tháng đó; ngày 20 vẫn là ngày hạn thật. Hiển thị quá hạn, đến hạn trong tháng, thiếu dữ liệu, đã hoãn, đã xử lý. “Chưa đủ dữ liệu” là cờ có thể đi cùng “đến hạn”, không làm mất hồ sơ.

Một thông báo theo người × nhóm × chu kỳ. Ngày nào admin vào cũng không tạo một thông báo mới. Nếu đã hoãn, hiển thị ngày hẹn và lý do; không đổi ngày tăng gần nhất. Nếu nhiều nhóm của một người cùng đến hạn, có thể gom hiển thị nhưng giữ quyết định riêng.

Giai đoạn đầu: quét khi mở dashboard/trang xét, cộng nút tải lại và thời điểm cập nhật. Cách này phù hợp thói quen vào đầu tháng và chưa cần hạ tầng nền. Nếu yêu cầu nhắc khi app đóng, thêm worker theo lịch có timezone, chống trùng và theo dõi lỗi. Không dùng bộ hẹn giờ trình duyệt để hứa chức năng chạy nền.

Mỗi hồ sơ lưu kỳ dữ liệu được dùng. Ngày 1 của tháng 9 thường xem giờ các tháng đã kết thúc, không lấy giờ ngày 1–5 tháng 9 để so với một tháng đầy đủ. Thiếu kỳ nào phải chỉ rõ và cho admin bổ sung xác nhận độc lập.

## 8. Duyệt mức mới: điểm nối cần làm cẩn thận

Không thể chỉ update giá nhóm rồi coi xong: `class_rates` theo tháng và giá kế thừa tháng trước có thể ưu tiên hơn; nhiều đường report/modal/PDF dùng nguồn này. Cũng không thể ghi giá vào mọi tháng vì sẽ chạm kỳ cũ và ngoại lệ.

Đề xuất:

- Quyết định lưu append-only, có nhóm/môn, giá cũ/giá mới, ngoại lệ, kỳ hiệu lực, người duyệt và source revision.
- Đơn giá mới có phiên bản độc lập; mặc định áp đầu kỳ tiếp theo. Giữa tháng/hồi tố chỉ mở sau khi các đường tính phân bổ đúng theo ngày.
- Lớp đối soát hiển thị: giá tháng do admin nhập riêng, giá được kế thừa, giá từ quyết định mới và chỗ xung đột. Dữ liệu cũ thiếu nguồn gốc giữ nguyên chờ xác nhận.
- Lưu hồ sơ ban đầu không thay đổi giá. Duyệt phải xem trước các môn bị tác động. Áp giá không tự tính/gửi lại phiếu.
- Giữ trạng thái rõ: đã duyệt/chờ hiệu lực/đã áp dụng/lỗi cần xử lý. Ghi quyết định xong mà áp giá thất bại không được hiện thành công toàn bộ.
- Nếu có hai tab hoặc admin sửa giá trong màn cũ, kiểm tra revision và source fingerprint; yêu cầu tải lại thay vì ghi đè.
- Bản phiếu đã gửi/đã nhận giữ cơ chế hiện tại; cần sửa tiền thì dùng hiệu chỉnh có lịch sử.

Không chốt cách nối chỉ dựa một helper. P4 trong TODO yêu cầu kiểm thử cả màn báo cáo, modal tính lương, so tháng trước, phiếu nhân viên và các đường xuất.

## 9. Hướng giao diện và câu giải thích ngắn

Màn “Xét tăng lương” riêng, giữ sidebar và ngôn ngữ thiết kế app. Danh sách gọn bên trái, chi tiết nhân viên/nhóm bên phải; trên điện thoại chuyển một cột. Dùng tên trạng thái rõ, số liệu thẳng hàng, màu nhấn xanh hiện hữu; không thay giao diện chấm công.

Lần đầu chọn người → hiện folder/nhóm có bằng chứng → mở nguồn → xác nhận mức và mốc → lưu. Các nhóm chưa biết không cản nhóm đã đủ. Lần sau vào đầu tháng thấy danh sách cần xử lý, không nhập lại.

| Trường/hành động | Chú giải đề xuất |
|---|---|
| Mức hiện tại | “Gợi ý từ lương đã lưu. Kiểm tra các môn ngoại lệ trước khi xác nhận.” |
| Ngày tăng gần nhất | “Dùng để tính kỳ xét tiếp theo. Chưa biết ngày thì chọn mốc xét khởi tạo.” |
| Mốc xét khởi tạo | “Mốc bạn chọn để bắt đầu nhắc; không ghi thành một lần tăng lương.” |
| Chu kỳ riêng | “Để trống dùng quy định chung.” |
| Ngưỡng giờ | “Dưới mức này vẫn được nhắc; admin cân nhắc hẹn lại.” |
| Giờ admin xác nhận | “Bổ sung căn cứ xét, không sửa giờ chấm công.” |
| Nhóm áp dụng | “Mức chung cho các môn được chọn. Môn ngoại lệ giữ riêng.” |
| Mức mới | “Nhập số tiền mỗi giờ sau khi duyệt. Thang bên cạnh chỉ để tham khảo.” |
| Lưu mốc & bật nhắc | “Lưu hồ sơ xét, chưa thay đổi giá đang trả.” |
| Duyệt mức mới | “Xem các môn và kỳ áp dụng trước khi xác nhận.” |

Panel nguồn phải cho thấy tên người, môn/nhóm, đơn giá, kỳ, trạng thái phiếu và đường dẫn bảng lương gốc. “Chưa có giá” khác “giá 0”; “gợi ý” khác “admin đã xác nhận”.

## 10. Trạng thái cuối phiên nghiên cứu

Chưa có trang xét hoạt động, chưa lưu cấu hình 43 giờ vào database, chưa áp giá mới, chưa tạo notification production. Các thống kê và prototype chỉ phục vụ xác minh thiết kế. Test thuần của prototype đã chạy qua; không thay cho kiểm thử module sản phẩm hoặc E2E.

Người dùng đã giao triển khai theo hướng mở và yêu cầu không làm vội. Ưu tiên tiếp theo là bộ đọc đối chiếu mức giá và màn xác nhận mốc; không mở đầu bằng migration hoặc sửa thuật toán chấm công. Danh sách công việc chi tiết, thứ tự và điều kiện nghiệm thu nằm trong `TODO_XET_TANG_LUONG.md`.

## 11. Bàn giao thực thi 19/09/2026 — trước khi deploy

Đã triển khai trang `xet-tang-luong.html` với các module riêng policy, application, service, UI và notifications; Rules thêm collection settings/profiles/history của xét lương. Nghiệp vụ cũ tiếp tục dùng bộ tính lương hiện hữu. Đã kiểm tra thêm 5 tài liệu `salary_settings` legacy trong bản sao chỉ đọc; không yêu cầu nhân viên hoặc admin nhập lại toàn bộ giá cũ.

Các quyết định điều chỉnh khi viết code:

- Giá tương lai ghi vào đúng vai trò giáo viên của một tháng được chọn, trong cùng transaction với hồ sơ và audit. Không thay `salary_config`, cây môn hoặc `subjectRatePolicy.groupRates`.
- Materialize đầy đủ giá kế thừa gần nhất theo đúng hợp đồng 6 tháng của report. Nếu chỉ ghi nhóm tăng, các nhóm khác có thể mất nguồn kế thừa ở tháng sau — đây là lý do cần adapter riêng.
- Hai khóa `giao_vien`/`giao-vien` có thể cùng tồn tại trong dữ liệu thật. Lấy canonical như report, giữ khóa legacy và báo khác biệt; không từ chối toàn bộ lịch sử chỉ vì có hai khóa.
- Màn duyệt cho bỏ chọn ngoại lệ. Sau duyệt, nhóm xét chỉ còn môn nhận mức mới; giá/mốc nhóm không được đại diện giả cho môn bị loại. Những môn đó có thể tạo nhóm riêng. Hủy trả lại phạm vi cũ nếu không trùng nhóm khác.
- Hủy chỉ trước ngày hiệu lực và khi vai trò GV tháng đích còn nguyên, chưa có bản tính. Không đè giá admin vừa sửa, không xóa TT hoặc cả tài liệu tháng.
- Mọi ứng dụng giá dùng context xem trước riêng trong bộ nhớ, đọc lại/CAS nguồn trong transaction và actor từ auth; audit có thời gian server, revision và before/after. Không tin patch từ UI.
- Nguồn giờ là phiếu GV đã gửi/nhận, không tự quét attendance toàn bộ. Bình quân 3 tháng chỉ kết luận khi đủ kỳ. Admin có ô xác nhận bình quân giờ/tháng và kỳ kết thúc; giá trị cũ không được dùng mãi khi chuyển tháng.
- Chạy module benchmark sản phẩm trên bản đọc mới cho **48/61** GV/trợ giảng có dữ liệu tháng 08/2026: 43,207986 giờ, làm tròn gợi ý **43 giờ/tháng**. 13 người thiếu dữ liệu không là 0. Đây là thống kê ngày 19/09, không tự trở thành tiêu chuẩn bắt buộc hoặc con số cố định cho mọi tháng.
- Dashboard chỉ tải metadata khi mở; tải nguồn giá/giờ theo người được chọn, có cache và giới hạn concurrency. Trang chấm công không chờ các nguồn này.

Yêu cầu tự ra ca được xử lý riêng: đọc mới công/lịch khi cần, xác thực lịch trước khi ghi mốc ra, kiểm tra đúng phiên trong transaction, giữ phiên admin đã sửa và chặn PWA reload trong lúc tự ra. Tái sử dụng lịch 5 phút trong tab đang hoạt động nhưng không ghi theo cache cũ; không có phiên mở thì không tải lịch. Không có tác vụ nền bảo đảm tự ghi khi mọi trình duyệt đều đóng.

Kiểm chứng đã có ở thời điểm bàn giao này: unit policy/application/service/notifications; Rules emulator phần quyền và settings/profile/defer; các test auto-checkout/freshness/startup/PWA cập nhật chạy lại độc lập đều qua. Các luồng browser, toàn bộ regression/rules và production smoke phải cập nhật theo log cuối. **Chưa ghi deployment thành công tại thời điểm viết mục này.**

Nguồn rollback/backup nằm ở `release-checklist-20260919.md`: Vercel baseline đã xác minh; Firestore production Rules khớp HEAD và đã lưu nguồn; snapshot cấu hình/lương cục bộ 1,2 MB có checksum. Database không có PITR hoặc backup cloud đang bật. Bản cục bộ có phạm vi, không gồm attendance/schedules/revisions và không được gọi là backup toàn database.

Phần hoãn rõ ràng: dạy liên kết/tại nhà, worker khi app đóng, lịch nghỉ dài theo khoảng ngày, trình quản lý alias, tăng giữa tháng/hồi tố, resolver ledger cho mọi lịch sử, xuất bảng tổng hợp theo mẫu mới và tra revision xung đột theo từng hồ sơ. Xem TODO để tránh phiên sau triển khai thêm các phần này mà chưa đối chiếu scope.
