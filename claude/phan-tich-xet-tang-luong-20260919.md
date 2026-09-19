# Phân tích cập nhật xét tăng lương, bảng công theo môn và bảng trả lương

> Bổ sung sau trao đổi: đã khảo sát nguồn giá thật và chỉnh hướng thiết kế.
> Đọc `nghien-cuu-moc-luong-20260919.md` cùng `TODO_XET_TANG_LUONG.md` để tiếp tục.
> Mục “chưa truy vấn production” dưới đây mô tả lượt phân tích ban đầu;
> lượt nghiên cứu tiếp theo đã đọc dữ liệu chỉ đọc, chưa ghi/deploy.

Ngày: 19/09/2026. Phạm vi: phân tích mã nguồn hiện tại, ảnh và hội thoại người dùng cung cấp; chưa triển khai tính năng.

**Kết luận:** Dự án có thể mở rộng trên nền tảng hiện có. Cần xây quy trình nhắc xét → admin đánh giá → admin duyệt → áp dụng đơn giá có lịch sử. Chưa nên nối chức năng này trực tiếp vào thao tác ghi cấu hình lương hiện tại. Hai việc quan trọng nhất là bảo toàn mức admin đã nhập và giữ đúng đơn giá của từng giai đoạn.

**Xác nhận mới nhất từ người dùng:** Chế độ cũ và mới dùng chung thang `30 → 32 → 34 → 36 → 38 → 40 → 42 → 48 → 50 → 52 → 54 → 56`. Không cần chuẩn bị hai thang tăng lương riêng. Việc dùng chung thang không mặc nhiên thay thế chính sách chuyên cần, thưởng/phạt hiện tại.

## 1. Mức độ xác minh và giới hạn

- Đọc trực tiếp các phần chấm công, lịch, nhân sự, môn học, tính lương, chuyên cần, duyệt/gửi/nhận lương, xuất phiếu, Firestore Rules và PWA.
- Mã nguồn được kiểm tra tại commit `6223ad7` — `fix: keep payslip sent/received status in sync across pages`.
- Chạy `npm test` trong `source/test-automation`: 64 file kiểm thử thuộc `pretest` + `test` chạy hết, mã thoát 0. Các thông báo lỗi mất mạng/yêu cầu cũ trong đầu ra thuộc tình huống mô phỏng được kiểm thử.
- Chạy thêm ví dụ bộ giải đơn giá bằng dữ liệu giả trong bộ nhớ để kiểm tra việc thay mốc hiệu lực và giữ ngoại lệ môn.
- Không truy vấn dữ liệu nhân viên trên production, không ghi Firestore, không chạy migration/repair, không deploy. Chỉ tạo tài liệu này; không sửa mã ứng dụng.
- Chưa chạy bộ kiểm thử trình duyệt đầy đủ hoặc Firestore Emulator/Rules trong phiên này. Không coi kết quả kiểm thử mã nguồn là bảo đảm mọi dữ liệu thực tế đã đúng hoặc không thể phát sinh lỗi.
- File `claude/incident-analysis-20260908.md` đã ở trạng thái chưa theo dõi Git trước khi bắt đầu; giữ nguyên.
- Tài liệu hệ thống cũ có một số mô tả không còn khớp mã hiện tại, chẳng hạn số vai trò và cách xử lý phiên cũ khi xem báo cáo. Các kết luận dưới đây ưu tiên mã thực tế.

## 2. Hiểu đúng yêu cầu, tách khỏi bản phác thảo trong ảnh

Ảnh là mô tả ý tưởng trước đây: tự xác định lương theo nhóm môn và điều kiện nhân viên, nhập bù giờ trước khi có app, tự xét tăng lương, admin có thể chỉnh. Yêu cầu hiện tại đã làm rõ: **tự phát hiện người đến hạn/đủ dữ kiện để xét, thông báo cho admin; không tự tăng lương**.

Có bốn nghiệp vụ riêng:

1. **Chấm công:** ghi nhận đã làm ca nào, thời gian nào, môn nào, trạng thái nào.
2. **Tính lương kỳ:** lấy công hợp lệ × đơn giá áp dụng, cộng/trừ các khoản theo kỳ.
3. **Xét tăng đơn giá:** căn cứ thời gian từ lần tăng gần nhất, giờ làm và đánh giá để admin quyết định.
4. **Đối soát/trả lương:** chốt số tiền, gửi phiếu, theo dõi xác nhận và xuất file.

Không lấy câu “giải quyết việc tăng lương, có thể tự động” trong đoạn chat làm quyền tự thay đổi lương. Không lấy giả định trong ảnh về tiêu chí số giờ làm, tác phong làm ngưỡng chính thức khi chưa được xác nhận.

Các điểm đã có căn cứ:

| Nội dung | Cách hiểu cho thiết kế |
|---|---|
| Lương/giờ admin đã nhập | Giữ làm dữ liệu nền, không yêu cầu nhập lại và không đồng loạt chuẩn hóa |
| Thang lương chung | 30, 32, 34, 36, 38, 40, 42, 48, 50, 52, 54, 56 |
| Xét thông thường | Hội thoại nói 3–4 tháng, trung bình 3 tháng; ít giờ/hiệu suất thấp có thể kéo dài |
| Bước 42 → 48 | Hội thoại nêu 6 tháng; đưa vào chính sách xét chung theo xác nhận hai chế độ cùng quy luật tăng |
| Đến kỳ xét | Được đưa vào danh sách admin xem xét, không đồng nghĩa được tăng |
| Mức tăng | Admin chốt mức và ngày hiệu lực |
| Bảng công theo môn | Đặc biệt cần phân biệt môn liên kết và dạy tại nhà |
| File trả lương | Cần có bảng phục vụ trả lương; mẫu và định dạng chưa được cung cấp |

Đơn vị của thang trong hội thoại chỉ viết 30–56. Khả năng là nghìn đồng/giờ, nhưng cần xác nhận trước khi lưu policy chính thức; cơ sở dữ liệu nên tiếp tục dùng đồng/giờ nguyên, thời lượng dùng phút.

## 3. Những gì hệ thống hiện tại đã có

| Phần | Hiện trạng từ mã nguồn | Việc còn thiếu cho yêu cầu này |
|---|---|---|
| Nhân sự | `users.salary_config`, phân loại `teachingMode`, vai trò đơn/kiêm nhiệm | Mốc xét, lần tăng gần nhất, bậc theo phạm vi áp dụng, lịch sử quyết định tăng |
| Môn học | Cây nhóm cha/con bằng `parentId`, `isGroup`, `subjectFamily`, cờ `allowEarly10` | Xác nhận nhóm nào thực sự dùng chung một bậc; phân loại nghiệp vụ liên kết/tại nhà rõ ràng |
| Giá nhóm môn | `SubjectRatePolicy`: ngoại lệ môn cụ thể, nhóm gần nhất, nhóm cha và fallback | Chuỗi phiên bản giá qua nhiều lần tăng; hiển thị nguồn giá và xung đột với giá tháng |
| Giờ trước app | `staff_payroll_profiles.historicalMinutesBeforeApp`, ghi chú, người/thời điểm nhập | Mốc chốt số giờ, phạm vi giờ, đối soát trùng, lịch sử điều chỉnh và nối vào quy trình xét |
| Tính công | Ghép lịch và session để tạo các dòng công, xử lý sớm/trễ/vắng/bù/chuyển ca/lớp trùng giờ | Tập dữ liệu xét tăng riêng, xác định giờ nào được tính và trạng thái nào còn thiếu chứng cứ |
| Chuyên cần | Có bộ tính riêng theo `teachingMode`; thưởng tổng giờ chế độ cũ và điều chỉnh admin | Tiêu chí xét tăng lương; không được tự suy ra từ tiền thưởng/phạt |
| Báo cáo lương | Cấu hình theo tháng, giá lớp, phân bổ giờ theo môn, tạm ứng, thưởng/phạt, ghi đè của admin | Nguồn dữ liệu chung cho bảng công theo môn và bảng trả lương tổng hợp |
| Phiếu lương | Nháp, gửi, xác nhận theo từng phần GV/TT; thu hồi và hiệu chỉnh có lịch sử | Nếu cần quản lý chuyển tiền thực tế, phải có trạng thái riêng, không đồng nhất với “đã gửi” |
| Xuất file | Phiếu riêng, in/PDF, xuất ZIP gồm HTML phiếu từng người từ bản đã lưu | Chưa thấy luồng Excel tổng hợp theo môn/đối tác phục vụ yêu cầu mới |
| Tự động hóa | Có hàm tạo dữ liệu đối soát và hồ sơ legacy/shadow | Chưa thấy bộ nhắc xét tăng, hàng đợi duyệt, policy thang lương hoặc tác vụ lịch chạy tự động |

`payroll-automation.js` hiện là nền tảng tính toán thuần. Có hàm cộng giờ lịch sử và tạo kết quả đối soát, nhưng tìm kiếm mã chưa thấy các hàm này được nối thành quy trình xét tăng hoạt động. Công tắc đối soát không đồng nghĩa đã có hệ thống tự chạy lương/tăng lương.

## 4. Các điểm kỹ thuật cần giải quyết trước khi tăng lương

### 4.1. “Mức lương hiện tại” nằm ở nhiều nguồn

Trong luồng tính phần dạy học đã đọc, cần đối chiếu các lớp dữ liệu:

- Quyết định đơn giá riêng trên phân bổ công của admin.
- `salary_settings_monthly` chứa `class_rates` của nhân viên/tháng/vai trò; một số giá có thể được kế thừa từ tháng trước.
- `users.salary_config.class_rates`, `roles[]` và `subjectRatePolicy.groupRates`.
- `roleRate` lưu trên session, dùng làm giá lịch sử/fallback ở các nhánh tương ứng.
- Giá lớp đông đã duyệt: là đơn giá thay thế cho phân bổ đó, không cộng thêm một lần giờ.
- Phiếu đã lưu/gửi: đọc bản chụp đã lưu, không tự tính lại theo cấu hình mới.

Trong `getResolvedTeachingRate`, khi chính sách nhóm tắt/chưa hiệu lực/không xác định được môn, giá fallback trên công được giữ. Khi chính sách nhóm có hiệu lực, ngoại lệ môn cụ thể vẫn ưu tiên. Trong phần tạo lương, giá admin và giá lớp theo tháng được xét trước giá nhóm.

**Hệ quả:** sửa giá nhóm thành 36 không bảo đảm mọi môn chuyển thành 36; một môn có ngoại lệ 34 hoặc giá tháng 34 vẫn có thể dùng 34. Đây có thể chính là quyết định hợp lệ của admin. Không được xóa những mức này chỉ để ép chúng theo thang.

Màn duyệt cần cho thấy: mức đang trả, nguồn mức đó, mức đề xuất, môn/tháng nào thực sự đổi và ngoại lệ nào còn giữ. Giá tự kế thừa và giá admin nhập tay cần phân biệt nguồn gốc cho dữ liệu mới. Với dữ liệu cũ không đủ dấu vết, coi là cần đối soát, không đoán để ghi đè.

### 4.2. Một mốc hiệu lực không đủ lưu nhiều lần tăng

Hiện `subjectRatePolicy` chứa một `effectiveFrom` cùng tập `groupRates`, và màn lưu nhân sự ghi cấu hình hiện tại. Chưa thấy lịch sử phiên bản đơn giá theo từng đợt có thể tra cứu lại.

Ví dụ kiểm tra bằng dữ liệu giả, chỉ gọi bộ giải giá trong bộ nhớ:

1. Nhóm Tiếng Anh có giá 40.000 từ 01/09, giá fallback của ca là 30.000 → ca 10/09 được giải ra 40.000.
2. Thay cấu hình bằng 42.000 từ 15/10 → giải lại ca 10/09 chỉ còn cấu hình mới chưa hiệu lực, trả về fallback 30.000.
3. Môn có ngoại lệ 34.000 → sau ngày 15/10 vẫn trả 34.000, dù nhóm lên 42.000.

Đây là khả năng ở bộ giải đơn giá, **không phải xác nhận bảng lương thật đã sai**; giá theo tháng hoặc bản chụp phiếu đã gửi có thể giữ nguyên kết quả thực tế. Tuy vậy, dữ liệu giả chứng minh không thể dùng cách thay một object giá nhóm làm toàn bộ cơ chế tăng lương có lịch sử.

Cần lưu các phiên bản giá có ngày hiệu lực, chỉ áp dụng phiên bản mới sau quyết định duyệt. Nếu tăng giữa tháng, phải tách dòng cùng môn theo giai đoạn/đơn giá; không hiển thị một mức duy nhất cho tổng giờ có nhiều đơn giá. Việc duyệt hôm nay, ngày hiệu lực và kỳ lương áp dụng là ba thông tin khác nhau.

### 4.3. Thư mục hiển thị đang tham gia quyết định giá

Giá nhóm được tra theo cây `subjects` hiện tại. Chuyển môn sang nhóm khác có thể thay đổi cách giải giá khi tính lại, dù thao tác trông giống sắp xếp thư mục.

Nên tách khái niệm nhóm hiển thị và nhóm trả lương, hoặc lưu quan hệ nhóm trả lương có phiên bản/ngày hiệu lực. Giữ ID môn ổn định, không xóa/tạo lại môn để đổi nhóm. Một thư mục không đủ để biểu diễn vừa môn học, vừa hình thức dạy, vừa đối tác.

### 4.4. Giờ trả lương khác giờ tích lũy xét tăng

`TeacherAttendancePolicy.sourceFromChips` cộng `paidMinutes` để tính chuyên cần. Đây là căn cứ hiện hữu của khoản lương hằng tháng, chưa mặc nhiên phù hợp cho tăng bậc.

Cần phân biệt:

- Phút hiện diện thực tế.
- Phút dạy được công nhận.
- Phút trả lương, có thể chứa sớm 10 phút hoặc chỉnh sửa riêng.
- Phút tích lũy được phép dùng để xét tăng.
- Tổng giờ từ khi vào làm và số giờ trong chu kỳ kể từ lần tăng gần nhất.

Ví dụ 500 giờ trước app giúp xác nhận thâm niên nhưng không đủ kết luận nhân viên làm bao nhiêu giờ trong ba tháng gần đây. Hồ sơ giờ lịch sử hiện chưa có mốc chốt và phân bố thời gian có cấu trúc. Không cộng 500 giờ đó vào mọi kỳ xét; không cộng trùng với ca đã được nhập bù trong app.

### 4.5. Dạy liên kết/tại nhà còn thiếu ngữ nghĩa và cách ghi nhận

`report.js` và `pdf-export.js` hiện có nhận dạng một số nhóm bằng tên chứa “liên kết”, “tại nhà”, “kèm 1:1”. Đây là nền hiển thị/tổng hợp, chưa phải hồ sơ đầy đủ về đối tác hoặc địa điểm.

`checkInPersonal` hiện qua bước kiểm tra GPS theo địa điểm cấu hình. Chưa thấy lựa chọn nghiệp vụ dạy ngoài cơ sở với quyền ghi nhận riêng trong đường này. Vì vậy cần xác nhận: giáo viên tự chấm tại địa điểm được duyệt, gửi yêu cầu xác nhận công, hay admin nhập công theo bảng đối tác? Không bỏ kiểm tra địa điểm chung để giải quyết một loại lớp đặc biệt.

Một ca nên phân biệt được: môn, nhóm đơn giá, hình thức dạy, lớp, đơn vị liên kết nếu có, cơ sở quản lý và địa điểm thực hiện. Không cần thu thập thêm thông tin cá nhân học sinh nếu đối soát chỉ cần mã lớp/địa điểm.

### 4.6. Ghi và duyệt phải chống ghi đè do nhiều tab

`saveUser` hiện dùng batch merge toàn bộ dữ liệu hồ sơ được gửi lên, chưa phải giao dịch duyệt tăng với điều kiện phiên bản. `merge` không tự giải quyết việc hai tab cùng sửa một trường/mảng lương từ dữ liệu cũ.

Luồng mới phải đọc lại dữ liệu liên quan, kiểm tra phiên bản của hồ sơ xét và đơn giá, rồi ghi quyết định cùng phiên bản lương trong giao dịch. Duyệt hai lần phải chỉ áp dụng một lần. Nếu admin vừa sửa giá trong tab khác, yêu cầu đối soát lại, không âm thầm ghi đè.

## 5. Logic đề xuất cho nhắc xét và admin duyệt

```text
Hồ sơ nhân sự + mốc tăng gần nhất + policy áp dụng
                  + công hợp lệ + đánh giá/ngoại lệ
                                 ↓
           Chưa đến hạn / Đến hạn / Thiếu dữ liệu
                                 ↓
           Danh sách admin xét, kèm lý do và bằng chứng
                                 ↓
         Duyệt / Hoãn và hẹn lại / Không tăng và ghi lý do
                                 ↓
      Nếu duyệt: tạo phiên bản đơn giá có ngày hiệu lực
                                 ↓
       Kỳ lương lấy đúng phiên bản theo ngày công
                                 ↓
        Admin vẫn chốt và gửi bảng lương theo luồng hiện tại
```

**Đến hạn xét:** đề xuất nhắc từ mốc 3 tháng thông thường; bước 42 → 48 theo mốc 6 tháng trong hội thoại. Mốc 4 tháng cần được định nghĩa là lịch xét cố định hay kết quả hoãn. Không tự biến 3–4 tháng thành một con số duy nhất mà không ghi rõ giả định.

**Đủ điều kiện đề xuất:** các tiêu chí bắt buộc đã có đủ dữ liệu và đạt ngưỡng được trung tâm xác nhận. Nếu chưa có ngưỡng hiệu suất/giờ/chuyên cần, có thể nhắc “đến hạn xét, cần admin đánh giá”; không gắn nhãn “đủ điều kiện tăng” thiếu căn cứ.

**Kết quả đánh giá từng tiêu chí:** đạt, không đạt, thiếu dữ liệu, không áp dụng. Thiếu ngày tăng gần nhất, mất lượt tải công hoặc chưa phân loại ca phải hiện rõ; không đổi lỗi tải thành 0 giờ/không vi phạm.

**Chu kỳ:** lưu riêng ngày tăng hiệu lực gần nhất, ngày xét gần nhất và ngày hẹn xét lại. Hoãn/không tăng không tự đổi ngày tăng gần nhất. Cách xác định mốc chu kỳ kế tiếp sau duyệt cần được chốt; đề xuất lấy ngày hiệu lực của quyết định tăng.

**Phạm vi bậc:** cần chốt bậc theo nhân viên hay theo nhân viên × nhóm môn. Nếu một người có Tiếng Anh 34 và Toán 38, không thể dùng duy nhất một trường “bậc hiện tại” mà chưa xác định quan hệ của hai mức này.

**Ngoại lệ:** mức đang nhập nằm ngoài thang, nhân viên đang ở 56, nghỉ dài ngày, chuyển chế độ, chưa từng tăng, thiếu lịch sử phải có trạng thái riêng. Không làm tròn xuống thang; không tự bù nhiều bậc vì lâu chưa xét. Nhảy bậc hoặc mức đặc biệt chỉ thực hiện nếu trung tâm cho phép và admin xác nhận rõ.

**Thông báo:** mỗi nhân viên/phạm vi/chu kỳ chỉ có một hồ sơ đang mở; lần quét sau cập nhật chứng cứ thay vì tạo thông báo trùng. Hoãn phải có lịch nhắc lại. Hiển thị lần kiểm tra gần nhất và trạng thái dữ liệu.

**Cách chạy:** giai đoạn đầu có thể quét khi admin mở trang hoặc bấm kiểm tra; phải ghi rõ giới hạn là chưa chạy khi không ai mở app. Nếu cần nhắc đúng hạn cả khi app đóng, cần tác vụ nền đáng tin cậy và quyền hạn riêng. Tác vụ này chỉ tạo/cập nhật hồ sơ nhắc, không có quyền áp dụng giá hay phát hành phiếu.

**Quyền:** mã hiện tại phân biệt admin chính và `senior_assistant`; tiền lương được bảo vệ bằng `isPrimaryAdmin()`, ngoại trừ một số thao tác hẹp đã có. Không dùng điều kiện “được vào trang quản lý” thay cho quyền duyệt tăng. Mặc định thiết kế quyền duyệt cho admin chính, mở quyền xem/thẩm định cho người khác chỉ theo phân công rõ ràng.

## 6. Những phần bạn và chị Diễm cần chuẩn bị

Không cần nhập lại toàn bộ lương đang có. Phần lập trình cần trích đọc và đối chiếu các mức hiện hữu; chị Diễm xác nhận những trường thiếu hoặc mâu thuẫn.

| Hồ sơ/thông tin | Nội dung cụ thể cần chốt | Ai chuẩn bị chính |
|---|---|---|
| Quy tắc thang chung | Xác nhận đơn vị đồng/giờ; đối tượng áp dụng GV/trợ giảng/nhóm khác; không cần cung cấp lại hai thang cũ/mới | Bạn + chị Diễm |
| Chu kỳ xét | Mốc 3 tháng là bắt đầu xét hay ngày phải quyết định; khi nào 4 tháng; hoãn bao lâu; tính tháng lịch hay tháng làm đủ | Chị Diễm |
| Điều kiện định lượng | Giờ tối thiểu mỗi tháng hoặc cả chu kỳ; cách xử lý tháng nghỉ; loại giờ được tính; có thật sự cần ngưỡng tổng giờ cả quá trình không | Chị Diễm |
| Hiệu suất và tác phong | Ai đánh giá; tiêu chí/thang điểm; cần bao nhiêu điểm; bắt buộc hay tham khảo; có chứng cứ nào | Chị Diễm |
| Chuyên cần cho tăng bậc | Đi trễ bao nhiêu lần/phút; VP/VĐX/VKP; quên chấm, ca chờ duyệt, đổi ca, trung tâm nghỉ xử lý thế nào | Chị Diễm |
| Mốc từng nhân viên | Ngày vào làm được xác nhận, ngày tăng hiệu lực gần nhất, phạm vi tăng; chưa tăng thì lấy mốc nào | Chị Diễm xác nhận trên danh sách trích từ hệ thống |
| Giờ trước app | Số giờ đã chốt đến ngày nào, thuộc loại công nào, nguồn bằng chứng; có trùng công nhập bù không | Chị Diễm |
| Nhóm hưởng chung giá | Tiếng Anh trường/giao tiếp, Toán–Tiếng Việt, FFF/FFS…; môn ngoại lệ; tăng một nhóm có kéo theo nhóm khác không | Chị Diễm + bạn |
| Lương đang nhập | Chỗ nào là mức cố định, chỗ nào là ngoại lệ theo tháng, lớp đông, ca đặc biệt; dữ liệu không rõ nguồn cần giữ lại để xác nhận | Lập trình trích đọc, chị Diễm duyệt |
| Hiệu lực và ngoại lệ | Từ ngày duyệt, đầu tháng sau hay được hồi tố; được nhảy bậc không; mức ngoài thang; xử lý sau bậc 56 | Bạn + chị Diễm |
| Liên kết/dạy tại nhà | Danh sách lớp/đối tác/mã địa điểm, người xác nhận công, giờ/buổi, di chuyển/hủy buổi nếu có, kỳ chốt đối tác | Chị Diễm |
| Mẫu đầu ra | Một bảng công theo môn và một bảng trả lương đã che dữ liệu nhạy cảm; cột, thứ tự, mẫu tổng, Excel/PDF/CSV | Chị Diễm |
| Nghiệm thu | Các hồ sơ đại diện với kết quả mong đợi, gồm trước/sau tăng và môn đặc biệt | Bạn + chị Diễm + lập trình |

Mức tối thiểu để làm **nhắc đến hạn**: đối tượng áp dụng, phạm vi bậc, mốc tăng gần nhất, chu kỳ xét và người duyệt. Có thể triển khai lớp nhắc này trước khi có toàn bộ tiêu chí định lượng, nhưng phải ghi là “cần đánh giá”.

Mức tối thiểu để làm **đề xuất đủ điều kiện**: thêm quy tắc giờ/chuyên cần/hiệu suất và dữ liệu đủ tin cậy. Mức tối thiểu để làm **duyệt áp dụng giá**: thêm lịch sử giá, quy tắc hiệu lực, thứ tự ưu tiên ngoại lệ và kiểm thử bảo toàn kỳ cũ.

## 7. Bảng công và bảng trả lương nên thiết kế thế nào

**Bảng công chi tiết:** kỳ → nhân viên → môn/nhóm → lớp/hình thức dạy/đối tác. Mỗi dòng có ngày, cơ sở quản lý, giờ lịch, giờ thực tế, số phút tính lương, số phút xét tăng nếu khác, trạng thái duyệt và liên kết về ca gốc. Phân biệt ca thiếu dữ liệu với ca vắng đã xác nhận.

**Bảng công tổng hợp theo môn:** gom từ các dòng chi tiết đã xác nhận, cho phép lọc riêng liên kết/tại nhà. Một giáo viên dạy hai nhóm phải hiện cả hai nhóm; giờ lớp đông và lớp trùng giờ không được nhân đôi. Cột tổng phải nói rõ là giờ toàn kỳ hay giờ của bộ lọc.

**Bảng trả lương:** một dòng mỗi nhân viên ở bảng tổng, có thể kèm các sheet chi tiết theo vai trò/môn. Các cột đề xuất: mã nhân viên, tên, kỳ công, kỳ chi trả nếu khác, lương theo nhóm môn, lương vận hành, thưởng, phụ cấp, khấu trừ, tạm ứng, thực nhận và phiên bản phiếu. Thông tin ngân hàng chỉ bổ sung nếu có nhu cầu trả qua ngân hàng và nguồn dữ liệu được xác nhận.

**Tách rõ đầu ra:** công chi tiết có thể thay đổi theo sửa công; phiếu/bảng trả lương đã chốt phải lấy từ bản chụp được duyệt. Sửa giá hôm nay không được âm thầm sửa file của kỳ đã gửi. File đối soát đang tính phải ghi rõ chưa chốt. Nếu cần file để gửi đối tác, mẫu đó có thể khác phiếu lương nội bộ.

**Các tổng bắt buộc khớp:** chi tiết → tổng môn → tổng vai trò → tổng nhân viên → tổng bảng chi trả; số người được đưa vào file và người bị thiếu/chưa chốt phải được báo rõ. Chốt cách làm tròn theo dòng hay tổng kỳ; không tính lại công thức riêng trong từng nơi xuất file.

Trường hợp cùng môn có 10 giờ × 34.000 và 8 giờ × 36.000 trong một tháng cần hai dòng giá hoặc hiển thị rõ số tiền từng giai đoạn, thay vì một cột đơn giá 34.000 cho cả 18 giờ.

“Đã gửi phiếu” và “nhân viên đã xác nhận” đang là trạng thái ứng dụng hiện có. Nếu chị Diễm cần danh sách đã chuyển khoản thực tế, bổ sung nghiệp vụ đối soát chi trả rõ ràng, không suy luận từ trạng thái đã gửi.

## 8. Các trang và thành phần liên quan

| Trang/thành phần | Thay đổi dự kiến và điều cần kiểm tra |
|---|---|
| `nhan-su.html`, `personnel.js` | Thêm mốc xét/lịch sử tăng; tiếp tục hiển thị mức admin đang nhập; liên kết đến hồ sơ xét và báo cáo đúng nhân viên |
| `mon-hoc.html`, `mon-hoc.js` | Quản lý nhóm trả lương và loại hình dạy rõ ràng; xem tác động khi chuyển nhóm; giữ ID và lịch sử |
| `admin.html`, `main.js` | Danh sách đến hạn/hoãn/thiếu dữ liệu, số thông báo không trùng; mở đúng hồ sơ |
| Trang xét tăng riêng (đề xuất `xet-tang-luong.html`) | Bộ lọc, chứng cứ, so sánh giá trước/sau, duyệt/hoãn/không tăng, lịch sử |
| `bao-cao.html`, `report.js` | Nguồn giá có ngày hiệu lực; phân bổ theo môn; liên kết công/lịch; đối soát bản nháp và bản đã gửi |
| `payroll-review.js` | Giữ đối chiếu đúng tháng/nhân viên, chống dữ liệu nguồn đổi khi đang duyệt; tiếp tục luồng hiệu chỉnh phiếu |
| `lich-lam.html`, `schedule.js` | Kiểm tra ID môn, ca, hình thức dạy, người nhận/chuyển lớp; deep link phải đúng ngày/cơ sở |
| `cham-cong.html`, `timekeeping.js` | Nguồn công đầu vào; ca bình thường tiếp tục luồng hiện tại. Chỉ thay khi phạm vi dạy ngoài cơ sở đã được xác định |
| `cham-bu.html`, duyệt tăng ca, quan sát ca | Các trạng thái chờ/đã duyệt phải phản ánh đúng vào chứng cứ xét; thay đổi công làm hồ sơ xét cần cập nhật |
| Lịch tiếp tân/văn phòng, họp | Đối soát người kiêm nhiệm và phạm vi giờ/đánh giá; không vô tình áp thang giáo viên cho công khác |
| `nhan-vien.html`, phần phiếu trong `main.js` | Xem đúng bản đã gửi và mức có hiệu lực; không lộ hồ sơ đánh giá nội bộ; trạng thái gửi/nhận tiếp tục đồng bộ |
| `pdf-export.js`, `salary-bulk-export.js` | Dùng chung dữ liệu đã chốt; giữ đầu ra cũ, bổ sung bảng tổng hợp khi mẫu được chốt |
| `db-service.js`, `firestore.rules`, indexes | API hẹp, transaction duyệt, bảo vệ quyền đọc/ghi và chống duyệt lặp; chỉ thêm indexes theo truy vấn thực tế |
| `service-worker.js`, thẻ script các trang | Phiên bản đồng bộ; không ép tải lại giữa lúc vào/ra ca hoặc lưu lương |

Thiết kế lại giao diện nên tập trung vào danh sách xét và màn đối soát. Tách việc làm mới giao diện chấm công khỏi đợt thay đổi logic lương để dễ xác định nguyên nhân nếu có sai khác.

## 9. Mô hình dữ liệu bổ sung đề xuất

Tên dưới đây là phương án thiết kế, chưa tồn tại dưới dạng tính năng được triển khai trong phiên này:

- `salary_review_policies/{version}`: thang chung, đối tượng/phạm vi, chu kỳ từng bước, tiêu chí, ngày áp dụng, người xác nhận policy.
- `staff_salary_review_profiles/{staffId}`: liên kết phạm vi/bậc hiện tại, mốc xác nhận, kỳ hẹn lại; có thể tận dụng hồ sơ tích lũy hiện hữu qua tham chiếu, không chép giờ lịch sử sang nhiều nơi.
- `salary_reviews/{reviewId}`: nhân viên, phạm vi, chu kỳ, phiên bản policy, trạng thái, kết quả từng tiêu chí, bản chụp chứng cứ, mốc cập nhật dữ liệu nguồn, admin quyết định và lý do.
- `staff_rate_versions/{versionId}`: đơn giá theo phạm vi, thời điểm hiệu lực, quyết định nguồn, phiên bản trước, người duyệt. Tra cứu theo ngày công; bản đã áp dụng chỉ bị thay thế bằng quyết định mới có audit.

Cần khóa nghiệp vụ ổn định theo nhân viên + phạm vi + chu kỳ để không tạo hai hồ sơ đang xét. Phiên bản tiêu chí được ghi trong hồ sơ, không dùng policy mới để âm thầm diễn giải lại quyết định cũ.

Không lưu lại toàn bộ nhật ký chấm công vào một document xét. Lưu số liệu tổng, mã nguồn/chứng cứ cần thiết và phân trang chi tiết. Luồng xét nhiều tháng cần kế hoạch đọc dữ liệu theo khoảng, tránh tải toàn lịch sử mọi nhân viên khi mở dashboard.

Nguồn xét phải có dấu hiệu đầy đủ và phiên bản/mốc dữ liệu. Trước khi admin duyệt, xác minh dữ liệu liên quan chưa đổi. Nếu nguồn cũ hoặc đang chờ xác nhận, chuyển sang cần đối soát; không giữ nhãn “đủ điều kiện” từ lần quét trước.

## 10. Thứ tự triển khai để hạn chế ảnh hưởng hoạt động

1. **Chốt nghiệp vụ và lập bảng đối chiếu:** trích đọc giá hiện tại, mức theo tháng, các ngoại lệ; xác nhận danh sách mẫu. Kiểm tra khả năng sao lưu và phục hồi dữ liệu trước khi có thay đổi ghi. Tài liệu tháng 8 ghi nhận khi đó chưa có backup/PITR; phiên này chưa xác minh trạng thái hiện nay.
2. **Thêm hồ sơ và màn nhắc chỉ đọc:** nhắc đến hạn, thiếu dữ liệu, hẹn lại; giữ toàn bộ đơn giá hiện hành. Triển khai được giá trị sử dụng trước, chưa đưa quyền ghi giá vào tác vụ nhắc.
3. **Đánh giá thử trên bản dữ liệu cô lập:** đối chiếu công/tiêu chí/giá đề xuất với trường hợp chị Diễm xác nhận; mọi chênh lệch có nguồn giải thích.
4. **Thêm lịch sử đơn giá và duyệt có giao dịch:** thử trên nhóm nhỏ; xác nhận kỳ trước không đổi, mức nhập tay không mất, ngày hiệu lực đúng. Quyết định tăng không tự gửi lương.
5. **Bảng công theo môn và bảng trả lương:** chốt mẫu, dùng chung nguồn với báo cáo, kiểm tra tổng và các luồng liên kết; có thể làm phần bảng chỉ đọc song song về mặt kế hoạch sau khi thống nhất mẫu.
6. **Mở rộng theo từng nhóm:** có công tắc dừng tính năng mới và quay lại bản ứng dụng trước nếu cần. Rollback code không tự hoàn tác dữ liệu đã được duyệt; phần dữ liệu cần quyết định đảo/hiệu chỉnh có audit, không xóa mù các bản ghi mới.

Không dùng trạng thái hiện tại trong trình duyệt admin làm nguồn ghi duyệt cuối cùng. Không mở trang báo cáo rồi âm thầm ghi lại mức lương. Không tạo migration để ép mọi mức hiện hữu vào thang.

## 11. Các tình huống nghiệm thu bắt buộc

| Nhóm | Tình huống cần chứng minh |
|---|---|
| Chấm công | Vào/ra ca trên điện thoại, mất mạng, phiên đăng nhập cũ, qua ngày, tự đóng; cập nhật PWA không cắt ngang thao tác |
| Công/lịch | Sửa giờ vẫn giữ liên kết; dạy thay/chuyển ca có hạn; ca hủy/trung tâm nghỉ; bù đang chờ và đã duyệt; lớp trùng giờ |
| Mức đã nhập | Giá nhân sự, môn riêng, nhóm, theo tháng, lớp đông và quyết định riêng của admin còn nguyên; 0, trống và thiếu dữ liệu có ý nghĩa rõ |
| Thang chung | Cũ/mới cùng thang; 40 → 42 và 42 → 48; ở 56; ngoài thang; thiếu mốc tăng; quá hạn không tự nhảy nhiều bậc |
| Đánh giá | Đúng ranh giới ngày/tháng; ít giờ; nghỉ dài; tiêu chí thiếu khác không đạt; giờ lịch sử không trùng; không cộng thưởng 10 phút vào thâm niên nếu chưa được cho phép |
| Duyệt | Hai admin/hai tab, nhấn hai lần, retry sau mất kết nối, giá/công đổi sau khi xem; chỉ ghi một quyết định hợp lệ |
| Hiệu lực | Tăng đầu tháng/giữa tháng/tương lai; truy lại tháng trước sau ít nhất hai lần tăng; cùng môn nhiều đơn giá |
| Phân quyền | Nhân viên không đọc hồ sơ đánh giá của người khác; senior không tự duyệt tăng; quyền server khớp UI |
| Bảng lương | Người kiêm nhiệm GV/TT/VP, đúng kỳ trả, một phần đã gửi/đã nhận; tăng lương không đổi bản đã chốt; hiệu chỉnh theo luồng có lịch sử |
| Xuất file | Tổng theo môn/nhân viên khớp bản đã lưu; file báo rõ người bị thiếu; giá giữa tháng hiển thị đúng; đổi tên/chuyển nhóm môn không sửa kết quả cũ |
| Liên kết trang | Mở từ thông báo → đúng nhân viên → đúng kỳ → ca/lịch đúng ngày/cơ sở; quay lại giữ bộ lọc; dữ liệu tải muộn không lẫn người |
| Khả năng phục hồi | Dừng tính năng nhắc không ảnh hưởng chấm công; rollback ứng dụng và khôi phục/hiệu chỉnh dữ liệu được thử độc lập |

Kết quả 64 file kiểm thử hiện tại là đường cơ sở tốt để so sánh. Các tình huống tăng lương mới ở trên cần kiểm thử bổ sung khi triển khai; nhiều tình huống chưa được bộ cũ bao phủ.

## 12. Điểm đối chiếu mã nguồn

Các số dòng thuộc bản nguồn được đọc trong phiên phân tích:

| Tệp | Điểm đáng chú ý |
|---|---|
| `js/personnel.js:795`, `:954`, `:1015` | Mở/lưu giá đang có; lưu hồ sơ giờ trước app riêng |
| `js/subject-rate-policy.js:31`, `:100` | Một mốc hiệu lực; thứ tự ưu tiên ngoại lệ và nhóm |
| `js/report.js:3138`, `:5118` | Phân bổ giờ lớp đông; bộ giải giá theo ca/môn |
| `js/report.js:4294` | Kế thừa giá tháng trước vào bản đọc để tính lương |
| `js/report.js:10035`, `:10118` | Tổng hợp môn/hình thức bằng tên; giá admin/tháng trước bộ giải nhóm |
| `js/teacher-attendance-policy.js:1` | Chính sách chuyên cần/thưởng tổng giờ hiện có, tách khỏi tăng bậc |
| `js/payroll-automation.js:55`, `:71` | Hàm tổng giờ và tạo dữ liệu đối soát, chưa phải quy trình tăng lương |
| `js/db-service.js:1860`, `:3651`, `:7287` | Lưu hồ sơ theo batch; cửa vào chấm công; hồ sơ giờ lịch sử |
| `js/db-service.js:7472`, `:7533`, `:7637` | Lưu nháp, gửi hiệu chỉnh, gửi từng phần phiếu |
| `js/salary-bulk-export.js:1`, `:231` | Xuất phiếu đã lưu thành ZIP/HTML, không phải bảng Excel tổng hợp mới |
| `js/payroll-review.js:20` | Liên kết đối chiếu với lịch theo ngày/cơ sở/nhân viên |
| `firestore.rules:15`, `:694`, `:1127`, `:1137` | Phân biệt admin chính, quyền hồ sơ/lương/thông tin tích lũy |

**Thông tin cần chốt tiếp trước thiết kế triển khai:** đơn vị và phạm vi thang chung; mốc 3 hay 4 tháng và ngoại lệ 6 tháng; ngày tăng gần nhất của từng người; bậc theo người hay nhóm môn; giờ/chuyên cần/hiệu suất dùng để xét; ngày hiệu lực; quy trình dạy ngoài cơ sở; mẫu bảng công và bảng trả lương. Đây là các đầu vào chưa được xác nhận, không phải yêu cầu nhập lại lương hiện có.
