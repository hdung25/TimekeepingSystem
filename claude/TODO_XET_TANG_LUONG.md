# TODO và bàn giao — xét tăng lương theo nhóm môn

Cập nhật: 19/09/2026. Người dùng yêu cầu phân tích kỹ, hệ thống mở, tận dụng giá admin đã nhập, tự nhắc admin và ghi lại từng phần cho phiên sau. Không coi các gợi ý ban đầu của người dùng là thiết kế đã tối ưu.

**Đã phát hành và kiểm chứng ngày 19/09/2026:** trang xét, nhắc admin, áp/hủy giá tháng tương lai và bản vá tự ra ca đã chạy trên `https://timekeeping-system-tawny.vercel.app`. Frontend commit `1976eb9`, deployment `dpl_9NesVxFVBur9vV8SShB2bpR7t4uh` (production, Ready); Rules cuối đã deploy và biên dịch không cảnh báo. Không ghi thử dữ liệu nghiệp vụ production. Đối chiếu sau deploy: 112 tài liệu lương tháng, 5 cấu hình lương cũ, 74 môn và phần hồ sơ 76 người đã lấy mẫu đều không đổi. Xem `release-checklist-20260919.md` và `HUONG_DAN_XET_TANG_LUONG.md`.

## Đọc trước khi tiếp tục

1. Đọc file này, nhất là các quyết định đã điều chỉnh và các lỗi cần tránh.
2. Đọc `nghien-cuu-moc-luong-20260919.md`: kết quả đọc Firestore thật, giới hạn suy luận, kiến trúc đề xuất và hướng giao diện.
3. Đọc `phan-tich-xet-tang-luong-20260919.md` để biết bản đồ mã nguồn và các luồng đang có. Đây là bản phân tích ban đầu, được bổ sung/đính chính bởi hai file mới.
4. Kiểm tra `git status` trước khi sửa; không đụng file incident ghi dưới đây. Đọc lại mã ở các điểm sắp sửa, không coi số dòng trong tài liệu là bất biến.
5. Không tự hỏi lại những điều người dùng đã xác nhận. Quyền triển khai đã được người dùng giao; chỉ hỏi nghiệp vụ thật sự thiếu nếu không thể xử lý bằng cấu hình hoặc mặc định được giải thích rõ.

## Yêu cầu đã xác nhận

- Chế độ cũ/mới dùng chung thang tham khảo `30-32-34-36-38-40-42-48-50-52-54-56`.
- Trung bình 3 tháng xét; bước 42 → 48 là 6 tháng theo hội thoại. Mỗi người/nhóm có thể cấu hình chu kỳ riêng.
- Hệ thống nhắc và tổng hợp chứng cứ; admin quyết định. Không tự tăng giá, không tự gửi phiếu lương.
- Admin tự nhập mức tăng/mức mới theo folder; mức ngoài thang được giữ, không ép về thang tham khảo.
- Tận dụng giá trong bảng tính lương và cấu hình hiện hữu. Môn chưa có dữ liệu có thể gợi ý theo nhóm nhưng phải đánh dấu suy luận.
- Admin có thể nhập/xác nhận hồ sơ: mốc tăng gần nhất, kỳ xét, phạm vi môn, giờ, chuyên cần/đánh giá, thiếu dữ liệu, mức hiện tại/đề xuất/ngoại lệ, quyết định, người duyệt, lý do, hiệu lực.
- Ưu tiên nhập/xác nhận lần đầu; lần sau tự nhắc từ hồ sơ đủ dữ liệu. Cấu hình chung có ghi đè theo từng người và nhóm.
- Admin thường vào đầu tháng, trước ngày 10: danh sách phải bao gồm cả hồ sơ sẽ đến hạn trong phần còn lại của tháng.
- Dạy liên kết/tại nhà chưa triển khai thêm trong đợt này. Không chỉnh GPS, quy trình ghi công hoặc loại công đó.
- Giao diện rõ, đẹp, gọn; giải thích ngắn ngay cạnh ô nhập. Không gây lỗi chấm công/lương hiện tại.

## Quyết định thiết kế sau nghiên cứu

| Mã | Quyết định | Lý do |
|---|---|---|
| D01 | Chọn mô hình cấu hình chung → ghi đè nhân viên → ghi đè nhóm xét | Đáp ứng các giáo viên có quy định riêng, không hardcode nhiều nhánh |
| D02 | Giá đã nhập là bằng chứng; ngày quan sát được giá không tự thành ngày tăng | Có dữ liệu giá nhưng lịch sử thời gian chưa đầy đủ |
| D03 | Nhóm xét có ID và danh sách môn riêng, tham chiếu folder thật | Toán chưa tách sẵn các cấp; tránh thay danh mục/lịch đang chạy |
| D04 | Mức 43 giờ/tháng là gợi ý tham khảo, chờ admin lưu cấu hình | Tính từ 48 phiếu GV tháng 8 đã gửi/nhận, trung bình 43,208h; không phải quy định cứng |
| D05 | Ít giờ vẫn hiện khi đến hạn; chỉ gợi ý hoãn thêm 1 tháng | Không âm thầm giấu người cần xét hoặc kéo dài lặp vô hạn |
| D06 | Quét đầu tháng hiển thị cả hạn trong tháng, ngày hạn chính xác vẫn giữ | Admin vào trước ngày 10, có người đến hạn ngày 20–30 |
| D07 | Lưu mốc khác với duyệt tăng và áp giá | Xác nhận hồ sơ không được làm thay đổi tiền lương |
| D08 | Lịch sử xét/tăng lưu bổ sung; dữ liệu nguồn cũ giữ nguyên | Dễ kiểm toán, bảo toàn mức nhập tay, không migration ép thang |
| D09 | Tính/nhắc có thể tự động; tác vụ nhắc không có quyền đổi giá | Tách quyền và tác động của từng chức năng |
| D10 | Đơn giá mới phải nối qua lớp đối soát rõ nguồn, không ghi âm thầm lúc đọc báo cáo | Giá nhóm mới có thể bị giá tháng kế thừa che; ghi trên render tạo rủi ro |
| D11 | Cấu hình mở có phạm vi, giới hạn và phiên bản; không nhận công thức JavaScript tùy ý | Tránh biến cấu hình thành hệ thống không thể kiểm thử |
| D12 | Duyệt giá ghi hẹp vào đúng vai trò GV của tháng tương lai, kèm audit nguyên tử | Dùng bộ tính hiện hành, không migration hoặc thay lịch sử động |
| D13 | Chọn một phần nhóm thì nhóm sau duyệt chỉ giữ các môn được tăng | Môn ngoại lệ giữ giá và được xét riêng, không bị gán mốc tăng giả |
| D14 | Hủy cần giá tháng đích còn nguyên và không tạo trùng phạm vi nhóm | Không đè dữ liệu admin chỉnh tiếp sau lần duyệt |

## P0 — đã khảo sát và bảo toàn nguồn

- [x] Đọc quy tắc dự án, mã công–lịch–lương–xuất–PWA, chạy baseline 64 file test ở phiên nghiên cứu.
- [x] Khảo sát 76 hồ sơ, 74 môn/nhóm, 112 tài liệu lương tháng; bổ sung đọc 5 tài liệu salary_settings legacy.
- [x] Tính lại benchmark bằng module sản phẩm trên bản đọc ngày 19/09: 48/61 GV/trợ giảng có phiếu tháng 8 hợp lệ; 43,208 giờ/người, gợi ý 43 giờ/tháng. 13 người thiếu phiếu không bị tính thành 0.
- [x] Xác minh backup thật: PITR tắt, không có lịch backup hoặc backup cloud trong region. Có bản sao cục bộ phạm vi cấu hình/lương, không phải backup toàn database.
- [x] Lưu nguồn Firestore Rules production và so với HEAD: trùng nội dung sau chuẩn hóa xuống dòng. Ghi ruleset và checksum ở release-checklist-20260919.md.
- [x] Xác minh baseline Vercel đúng project/scope/alias trước phát hành. Không migration hoặc ghi thử production.
- [ ] Khi có hồ sơ xung đột cần xử lý thực tế: đối chiếu revision cụ thể cùng admin; không quét revision mọi người lúc mở trang.

## P1 — đối chiếu giá và dữ liệu

- [x] Có module thuần salary-review-policy.js; test ngày, phân nhóm, bằng chứng, thiếu dữ liệu và đa vai trò.
- [x] Nguồn strict server đọc có phân trang/bounded concurrency; lỗi tải không trả giả giá 0 hoặc danh sách rỗng.
- [x] Ưu tiên ID, dùng tên chuẩn hóa khi duy nhất; tên mơ hồ không được suy/ghi âm thầm.
- [x] Phân biệt cấu hình tháng, phiếu đã gửi, cấu hình nhân sự/nhóm và salary_settings cũ; hiển thị mâu thuẫn/ngoại lệ.
- [x] Nhóm xét riêng Toán 1–5 / 6–9 / 10–12; English theo folder gần nhất; không di chuyển danh mục đang dùng.
- [x] Giữ giá ngoài thang, giá 0, môn chưa có giá; lớp ghép/lớp đông là bằng chứng riêng, không làm giá chuẩn.
- [x] Không suy ngày tăng từ ngày tạo/sent hoặc lần đầu quan sát thấy giá.
- [x] Giờ và snapshot GV tách khỏi TT/VP; dùng lifecycle thật; thiếu kỳ không thành 0 giờ.
- [ ] Trình sửa alias có admin xác nhận chưa mở trong UI. Module có điểm nhận alias; tên cũ chưa rõ tiếp tục giữ nguyên và đối chiếu thủ công.
- [ ] Không có trình tra giá từng ca/giờ thực tế cho mọi người trong màn xét. Bằng chứng hiện từ phiếu/cấu hình đã lưu, liên kết bảng công để kiểm tra ca.

## P2 — hồ sơ cá nhân và quy định

- [x] Collection riêng salary_review_settings và salary_review_profiles; không gộp vào users.salary_config.
- [x] Quy định nhóm → cá nhân → chung; để trống là kế thừa, ngưỡng 0 là tắt cảnh báo ít giờ.
- [x] Lưu nháp theo nhóm; xác nhận mức/mốc để bật nhắc; mốc bắt đầu xét khác ngày tăng thật.
- [x] Mỗi nhóm có môn áp dụng, mức hiện tại, chu kỳ, ngưỡng giờ, hẹn lại, ghi chú và nhận xét.
- [x] Giờ admin xác nhận có kỳ và nguồn, không ghi attendance; chỉ kỳ đã kết thúc, hết hiệu lực cảnh báo khi chuyển kỳ.
- [x] Có bật/tắt nhắc từng nhóm và loại nhân sự inactive theo dữ liệu hiện có.
- [x] Transaction theo revision, actor auth, audit có server timestamp; stale tab bị từ chối.
- [x] Rules chỉ primary admin; parent write bắt buộc kèm audit revision, không sửa/xóa history.
- [ ] Nghỉ dài ngày/ngừng xét theo khoảng ngày có lịch sử riêng chưa triển khai. Hiện dùng bật/tắt nhóm và ghi chú; không tự suy nghỉ việc từ 0 giờ.

## P3 — nhắc và đánh giá

- [x] Chu kỳ chuẩn 3 tháng; mức 42.000 có mốc mặc định 6 tháng; riêng nhân viên/nhóm có thể ghi đè.
- [x] Quá hạn/đến hạn trong tháng/thiếu mốc/hẹn lại được phân biệt; admin đầu tháng thấy cả hạn ngày 20–30.
- [x] Ít giờ chỉ cảnh báo, không tự loại hoặc tự hoãn. Admin có “Hẹn xét lại…” và “Chưa tăng…”.
- [x] Giờ xét là tổng giờ dạy từ 3 tháng đã kết thúc; chưa phải giờ từng folder. Hiển thị phạm vi rõ.
- [x] Ngưỡng benchmark là gợi ý, admin lưu mới dùng; tính lại không âm thầm thay quy định.
- [x] Dashboard chỉ đọc metadata hồ sơ/quy định, không ghi notification hoặc scan công/lương. Không tạo bản ghi trùng mỗi lần mở.
- [x] Bảng nhắc khi mở dashboard/trang xét, trang xét có nút tải lại; lịch sử quyết định riêng từng nhóm.
- [ ] Chưa có worker/notification khi app đóng; không hứa chạy nền. Nếu mở sau này phải có timezone, lease/idempotency/retry và quyền chỉ nhắc.
- [ ] Chưa đóng băng toàn bộ chứng cứ thành hồ sơ chu kỳ tự sinh; audit lưu nguồn lúc quyết định. Thay quy định có audit, lần xem sau dùng quy định mới.
- [ ] Dashboard chưa có lọc người nghỉ việc mới từ users: chỉ đọc hồ sơ để giữ tải nhẹ. Tắt nhắc nhóm khi nhân sự ngừng làm; trang xét lọc hồ sơ nhân sự theo trạng thái hiện có.

## P4 — áp giá có đối soát, phạm vi đã triển khai

- [x] Lưu mốc, hẹn/chưa tăng và duyệt giá là các thao tác riêng; chỉ hẹn không sửa ngày tăng.
- [x] Admin nhập mức mới, tháng áp dụng và chọn từng môn; mặc định loại các giá riêng/mơ hồ cần kiểm tra.
- [x] Preview môn/giá trước–sau + toàn bộ giá giữ lại; giữ alias/lớp ghép/lớp đông/môn ngoài phạm vi.
- [x] Chỉ từ đầu tháng tương lai; tháng có bản tính GV kể cả nháp, đã gửi/nhận hoặc hiệu chỉnh đều bị chặn.
- [x] Quyết định và giá tháng đích ghi cùng transaction. Không có “duyệt xong nhưng giá chưa ghi” hoặc gửi phiếu tự động.
- [x] Materialize đầy đủ giá kế thừa gần nhất (tối đa 6 tháng), không chỉ ghi vài môn rồi làm mất giá nhóm khác ở kỳ sau.
- [x] CAS hồ sơ/quy định/user salary_config/defaults/tháng đích/lịch sử/catalog; giá nguồn đổi phải tải lại. Actor và audit bất biến.
- [x] Giữ khóa canonical/legacy theo report, giữ TT/VP, tạm ứng/thưởng và published; không sửa users.salary_config hoặc groupRates.
- [x] Nếu chọn một phần nhóm, phạm vi nhóm sau duyệt chỉ còn môn đã chọn. Môn bỏ chọn giữ giá cũ và có thể tạo nhóm ngoại lệ riêng.
- [x] Hủy trước hiệu lực: trả đúng vai trò GV trước duyệt, giữ phần khác. Không hủy nếu vai trò GV đã sửa/tính lương hoặc phục hồi sẽ tạo môn trùng nhóm.
- [x] Giá/bậc/nhóm hiện tại có audit; ngày hiệu lực và snapshot môn cố định, không suy lại theo cây folder mỗi lần đọc.
- [ ] Tăng giữa tháng/hồi tố, chia dòng giá theo ngày, tự điều chỉnh phiếu đã gửi và migration lịch sử cũ chưa mở.
- [ ] Theo dõi giá bị sửa sau khi đã áp chưa có cảnh báo nền. CAS lúc duyệt/hủy bảo vệ dữ liệu; đối chiếu nguồn khi mở hồ sơ.
- [ ] Không có resolver ledger mới cho mọi ca lịch sử. Dùng adapter hẹp vào cấu hình tháng hiện hữu; tên môn đổi về sau vẫn cần kiểm tra theo cơ chế legacy.

## P5 — giao diện và hiệu năng

- [x] Trang xet-tang-luong.html, CSS riêng, Vanilla JS, danh sách người + hồ sơ nhóm, form và nguồn giá có nhãn/đơn vị.
- [x] Sidebar primary admin, dashboard nhắc, liên kết đến Nhân sự và bảng công/lương đúng người.
- [x] Tìm kiếm/lọc chạy trong bộ nhớ; lịch sử 6 tháng chỉ tải theo người được chọn; concurrency tối đa 4 và cache có scope.
- [x] Busy/inert, single-flight ghi, giữ form khi lỗi, beforeunload và cờ PWA __payrollWritePending.
- [x] Mã chấm công không phải chờ nguồn xét lương; không thêm polling lương vào trang nhân viên.
- [x] Bản vá tự ra ca: bỏ cache roster cũ khi cần, đọc server tại mốc đóng, kiểm tra đúng phiên trong transaction, giữ ca admin sửa, bảo vệ PWA.
- [x] Tự ra ca không tải lịch nếu không có phiên mở; tái dùng snapshot lịch 5 phút, kiểm tra mới trước ghi; 3 cơ sở đọc song song.
- [x] Browser desktop/mobile 390px không tràn ngang, không lỗi JS; PWA/version đồng bộ, hash 14 tệp production khớp local. Bằng chứng trong release note.

## P6 — kiểm chứng và phát hành

- [x] Unit policy/application/service/notifications được thêm vào npm test; fixtures ẩn danh, không đưa dữ liệu thật vào tests.
- [x] Unit transaction mới qua: áp/hủy, stale nguồn 8 loại, retry, double action, pending group, partial scope và bảo toàn lương cũ.
- [x] Rules emulator qua settings/profile/defer/preview/apply/retry/cancel và quyền/audit; Rules cũ 33/33, attendance, financial-concurrency, auto-checkout đều qua. Lỗi phí tư vấn legacy có kiểm thử chặn thay đổi ngoài phạm vi.
- [x] Rà độc lập và chạy lại auto-checkout.test.js, auto-checkout-freshness.test.js, startup-performance.test.js, app-update-write-safety.test.js: PASS.
- [x] Syntax application/service và git diff --check qua; cảnh báo CRLF không phải lỗi cú pháp.
- [x] npm test: 69 file qua. Các suite Rules, payroll UI, staff browser 8 vai trò và salary-review UI đều qua; dùng Auth/Firestore emulator, không dùng dữ liệu thật để thử ghi.
- [x] E2E mới: lưu mốc → nhắc → hẹn/duyệt → report đọc đúng kỳ/giá → hủy, giữ công/phiếu cũ; desktop/mobile và audit tên người duyệt/cấu hình xét.
- [x] Deploy Rules và Vercel đúng alias. HTTP/hash 14 tệp khớp, Chrome mobile login và trang xét khi chưa đăng nhập hoạt động, không phát sinh ghi dữ liệu trong smoke.
- [x] Ghi commit/deployment/test/giới hạn và đối chiếu dữ liệu production vào TODO, release checklist, hướng dẫn, system_logic.

## Việc chủ động để đợt sau

- Dạy liên kết/tại nhà: chưa đổi GPS hoặc quy trình xác nhận công; chưa triển khai bảng công theo đối tác.
- Worker nhắc khi app đóng; trình alias; trạng thái nghỉ dài theo ngày; giữa tháng/hồi tố; đối chiếu revision mâu thuẫn từng hồ sơ.
- Bảng trả lương tổng hợp/XLSX theo mẫu mới chưa triển khai trong đợt xét này; các đường in/PDF/ZIP hiện hữu giữ nguyên.
- Chỉ tiếp tục những phần này khi có yêu cầu/phạm vi phù hợp; không “tiện thể” chuyển folder/migration hoặc áp giá hàng loạt.


## Những điều không được làm tắt

1. Thấy giá xuất hiện từ tháng 8 rồi ghi ngày tăng là 01/08 mà không phân biệt quan sát/khởi tạo/xác nhận.
2. Lấy trung bình 43 làm điều kiện loại tăng tự động hoặc tự giãn vô hạn.
3. Tháng thiếu phiếu = 0 giờ; hoặc tính giờ TT vào giờ GV.
4. Gộp Toán 1 và Toán 9 chỉ vì cùng folder; suy hai giá từ một dòng ghép Toán 3 + Toán 9.
5. Chuẩn hóa `Pre I1`/`PRE-I1` thành một ID khi catalog hiện có hai ID riêng.
6. Lấy giá lớp đông, giá đặc biệt hoặc giá tổng hợp làm giá chuẩn của mọi môn.
7. Mở báo cáo rồi ghi backfill đơn giá; ghi cấu hình từ object cũ trong tab admin.
8. Viết công thức mới khác nhau cho report, modal, phiếu, PDF và ZIP.
9. Cho mọi vai trò quản lý quyền duyệt tiền vì cùng vào được trang admin.
10. Đưa prototype trong scratch vào production mà chưa làm P1–P6.

## Nhật ký và tệp cục bộ

- Baseline source: commit `6223ad7`. File `claude/incident-analysis-20260908.md` đã untracked từ trước, không sửa.
- Lần đầu chỉ phân tích mã + 64 file test. Sau khi người dùng yêu cầu tự kiểm tra giá, đã đọc dữ liệu thật qua Firestore REST.
- Script read-only ở `scratch/inspect-salary-review.cjs`: dùng gcloud access token hiện có trong bộ nhớ, không in token. GET list có pagination, projection; không có thao tác ghi Firestore.
- `scratch/salary-review-readonly.json`: dữ liệu tài chính đã lọc trường, chỉ cục bộ, nằm trong thư mục bị Git ignore. Không commit/upload/đưa vào fixture trình duyệt công khai.
- `scratch/salary-review-summary.json`: số liệu khảo sát ban đầu, gồm cả draft, KHÔNG dùng làm benchmark chốt.
- `scratch/salary-review-benchmark.json`: benchmark tháng 8 đã lọc đúng trạng thái GV published/received qua hàm lifecycle hiện có.
- `scratch/analyze-salary-review.cjs`: tính lại số liệu từ bản đọc cục bộ, dùng lifecycle của code hiện tại; chạy `node scratch/analyze-salary-review.cjs`, không truy cập mạng và không ghi database. Ngày khảo sát được cố định 19/09/2026; khi khảo sát kỳ mới phải đổi phạm vi và ghi một bản kết quả mới, không trình bày số cũ như số mới.
- `scratch/salary-review-policy.prototype.cjs`: prototype thử suy luận; đã chuyển khỏi `js/`. Không trang nào nạp. Còn hạn chế về nguồn/alias/lifecycle, không phải code sản phẩm.
- `scratch/salary-review-research.test.cjs`: chạy bằng `node scratch/salary-review-research.test.cjs`, không network/Firestore writes; chỉ kiểm chứng giả thuyết hẹp.
- **Bước tiếp theo:** admin dùng trang mới xác nhận mốc cho từng người/nhóm và lưu ngưỡng tham khảo khi đồng ý. Phần mở rộng chờ nằm ở “Việc chủ động để đợt sau”; không chạy prototype hoặc migration để khởi tạo hồ sơ thật. Không tự tăng/áp giá cho nhân viên.
