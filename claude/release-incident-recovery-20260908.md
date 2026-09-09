# Kết quả xử lý lỗi chấm công — 08/09/2026

## Cập nhật production — 08/09/2026, sau xác thực

**Bản sửa code chung đã deploy; các trạng thái “chưa deploy” phía dưới là nhật ký trước phát hành, không còn là trạng thái hiện tại. Các mục dữ liệu/nghiệp vụ chưa hoàn tất vẫn giữ nguyên.**

- Commit đã push lên `origin/main`: `a635ddb`.
- Firebase CLI biên dịch và phát hành Rules thành công vào `timekeeping-69f3f`.
- Vercel: đúng team `ha-huy-dungs-projects`, project `timekeeping-system`, deployment `dpl_GxVrowoXPjmBemmhHGLdStVH2GSF`, target **production**, trạng thái **Ready**.
- Alias đã kiểm tra bằng `vercel inspect`: https://timekeeping-system-tawny.vercel.app.
- Kiểm tra HTTP sau deploy: service worker, bốn trang chấm công/bảng công/nhân sự/lịch làm và sáu module JS thay đổi đều trả 200, nội dung khớp local sau chuẩn hóa CRLF/LF (11 file).
- Browser Chrome headless trên website thật: trang đăng nhập tải được đúng tiêu đề, trường tài khoản/mật khẩu và nút đăng nhập, không có lỗi JavaScript chưa xử lý trong lượt kiểm tra.
- Quét log Vercel của deployment mới với mức error, khoảng 1 giờ: không tìm thấy log. Đây không chứng minh không có lỗi client/Firestore; chưa cấu hình thêm monitoring/drains trong đợt này.
- Chưa kiểm thử thao tác ghi bằng tài khoản thật sau deploy; không tạo công giả hoặc sửa lịch sử để test. Kiểm thử đầy đủ Vào/Ra/+10/đóng-mở lớp trước phát hành là trên emulator.
- Dữ liệu attendance, thưởng, cấu hình môn và payslip production không bị hiệu chỉnh trong đợt phát hành này. Chỉ Rules và frontend được phát hành.
- Deployment tốt trước phát hành: `dpl_8YaZWHuagMxv2cPbtN37MyUhrZUZ` (đã xác minh thuộc đúng alias trước deploy).

## Trạng thái bàn giao

- Đã sửa code dùng chung, không ràng buộc tên hoặc ID của Quỳnh, Sang, Nhàn hay Thủy.
- Chưa deploy, chưa push (push có thể kích hoạt production), chưa sửa dữ liệu production.
- Vercel CLI trả `Not authorized`; xác minh scope trả `The specified scope does not exist`. Theo RuleHD, dừng phát hành cho đến khi đăng nhập tương tác và xác minh lại đúng team/project. Không tạo project mới hoặc đổi sang personal scope.
- Phiên bản dự kiến: `20260908-incident-recovery-v1`; service worker: `tdt-chamcong-v156-incident-recovery-20260908`.

## Thay đổi đã thực hiện

### 1. Yêu cầu +10 phút

- Firestore Rules cho phép nhân viên đọc đúng đường dẫn bằng chứng check-in chưa tồn tại của chính họ. Không mở quyền đọc của người khác hoặc quyền tạo bằng chứng quá khứ.
- Phân biệt rõ thiếu hồ sơ, chấm công, môn và bằng chứng giờ vào máy chủ. Trường hợp thiếu bằng chứng không còn dùng chung thông báo thiếu dữ liệu khó hiểu; hướng dẫn quản lý đối chiếu, không tự chế bằng chứng hoặc tự cấp thưởng.
- Bỏ giới hạn lấy 400 yêu cầu lịch sử trước khi kiểm tra trùng: dùng luồng đọc phân trang theo nhân sự/tháng hiện có, rồi transaction đọc lại các request liên quan.
- Thông báo điều kiện giờ vào hiển thị cả giây/mili giây. Ví dụ ca 18:00: vào 17:50:00 đủ 10 phút; 17:50:47 không đủ. Không thay đổi phép tính hoặc làm tròn để cấp thưởng.
- Giữ các sửa trước đây về lịch kế thừa, alias môn duy nhất và tự nhận môn từ lịch; không lặp lại migration cũ.

### 2. Vào/Ra ca và phiên đăng nhập

- Màn hình chờ xác thực và đối chiếu tài khoản–nhân sự trước khi bật thao tác.
- Bỏ kết quả render cũ khi đổi tài khoản hoặc có lần render mới hơn, tránh hiện nút từ hồ sơ cũ.
- Giữ cơ chế chống bấm trùng của từng thao tác; không thay đổi GPS, quyền chấm công, công lịch sử hoặc tự tạo giờ ra.

### 3. Danh sách nhân sự

- Cache có thời hạn 60 giây khi được gọi, không thêm polling liên tục.
- Lỗi tải không bị lưu thành danh sách rỗng; lỗi được trả lại cho màn hình và cache lỗi bị loại bỏ để lần sau thử lại.
- Đọc mới từ máy chủ, kiểm tra UID trước/sau đọc; nút Làm mới danh sách đồng thời làm mới ngữ cảnh quyền.
- Khi làm mới thất bại, giữ danh sách đang hiển thị và báo lỗi; không xóa hoặc tạo lại tài khoản.

### 4. Lớp nghỉ sau giờ bắt đầu

- Quản lý có thể đóng/mở lại từng lớp đúng ngày kể cả sau giờ bắt đầu; không mở lại chức năng xóa lớp quá khứ.
- Bắt buộc nhập lý do; lưu lịch sử trước/sau, người thao tác, thời gian. Thời gian trong lịch sử là thời gian client, trong khi phiên bản cập nhật document vẫn sử dụng cơ chế server timestamp hiện có.
- Đọc lại lịch và kiểm tra định danh/trạng thái trước khi ghi. Với lịch kế thừa, kiểm tra phiên bản nguồn trước khi lưu riêng theo ngày.
- Trong transaction, đối chiếu công của roster được xác định cho ca. Nếu có công làm việc hoặc phiên chưa phân định rõ, từ chối đóng lớp để tránh ảnh hưởng giờ làm.
- Giữ phân công, ghi chú, các lớp khác và dữ liệu công. Không kế thừa trạng thái nghỉ/lịch sử đóng lớp sang tuần sau.
- Nhận lớp đọc lại lịch trong transaction; chặn đăng ký mới nếu lớp đã đóng hoặc đã đổi.
- Giới hạn: kiểm tra đồng thời đã kiểm chứng với lịch và công của roster được đọc; không coi đây là bảo đảm tuyệt đối cho mọi nguồn ghi ngoài ứng dụng hoặc đăng ký riêng phát sinh sau bước lấy roster.

### 5. Cache/PWA

- Đồng bộ query version của sáu module thay đổi trên 17 trang HTML và danh sách cache service worker.
- Không tự reload khi đang lưu công, bảng lương hoặc đang xác nhận đóng/mở lớp.

## Kiểm chứng

- `npm test`: đạt toàn bộ bộ hồi quy hiện có và bài mới về cache, giờ chính xác, đóng/mở lớp, xung đột công trên bản cuối (exit 0).
- `npm run test:rules`: đạt 32/32 tình huống Rules; integration gọi DBService thật trên emulator, gồm thiếu proof, proof hợp lệ tạo đúng một request khi gửi lại, đăng ký lớp đã đóng, Vào/Ra ca, giao dịch đồng thời và chống ghi giả.
- `npm run test:browser`: chạy lại trên bản cuối đạt đầy đủ 8 nhóm tài khoản/36 lượt trang (exit 0), không có lỗi JavaScript chưa xử lý; kiểm tra Vào/Ra ca, bảng công, quản lý lương, đóng/mở lớp quá khứ và làm mới danh sách.
- Browser dùng Firebase SDK cài sẵn và chặn dịch vụ production; CDN tùy chọn không được tải. Đây là kiểm chứng chức năng trong môi trường cô lập, không phải xác nhận giao diện/CDN hay tài khoản thật trên production.
- Kiểm tra cú pháp module thay đổi và `git diff --check` đạt. Cảnh báo LF/CRLF không phải lỗi nội dung.
- Không chạy bài `test:payroll-ui` riêng trong đợt này; không tuyên bố đã kiểm thử mọi luồng UI lương.

## Những dữ liệu chưa tự ý thay đổi

- TV3: thông tin điều tra cho thấy chính sách đang bật +10. Chưa có quy định/ngày hiệu lực để tắt hoặc thu hồi lịch sử; không quy lỗi Admin chỉ từ nhãn Đã duyệt.
- Nhân sự mới không hiện: chưa xác định tên người mới; sửa cơ chế tải chung, không xóa hồ sơ trùng tên Thủy.
- E5 trong ảnh: chưa xác định chắc chủ bảng công/tháng và nguồn công. Không đồng nhất mọi lỗi với lỗi quyền của Quỳnh.
- Nhàn: không tạo công buổi sáng 05/09 chỉ từ ảnh báo lỗi, không dùng công buổi chiều để suy ra giờ vào buổi sáng.
- Lớp Toán ngày 31: chưa áp dụng đóng ca cụ thể khi chưa xác nhận đúng người/ngày/lớp nghỉ.
- Sang: không chạy lại phục hồi +10 đã ghi nhận trước đây; không cộng MC thêm lần nữa khi tổng giờ có thể đã bao gồm ca này. MC không đủ +10 không đồng nghĩa MC không được tính giờ làm.
- Không sửa thưởng hàng loạt, mức phụ cấp 10 HS, khóa tháng hoặc snapshot lương đã gửi.

## Cổng deploy và rollback

1. Xác thực Vercel CLI; kiểm tra lại team `ha-huy-dungs-projects`, project `timekeeping-system`, ID `prj_58GRPpalLQeeweIG1MYu3ji5K6ZH`.
2. Xác minh alias `https://timekeeping-system-tawny.vercel.app` thuộc đúng project; nếu không khớp thì dừng.
3. Xác nhận test cuối đạt; stage riêng các thay đổi của đợt sửa, không đưa file điều tra chưa tracked của người dùng vào commit.
4. Deploy Rules với Firebase project chỉ định `timekeeping-69f3f`; phát hành frontend đúng team/project theo workflow hiện có.
5. Kiểm tra trạng thái deployment Ready và HTML/service-worker tại alias chính có version mới; sau đó mới xác nhận hoàn tất production.
6. Mốc code trước sửa: `7df171b243fa8f9ae7029b39a883e9c49dcee4be`. Nếu cần rollback, tạo revert có kiểm soát hoặc chọn deployment tốt đã xác minh; không reset cứng/xóa worktree. Đánh giá Rules tương thích trước khi rollback riêng frontend/Rules.
7. Đợt này không có migration dữ liệu. Nếu sau phát hành quản lý ghi nhận lớp nghỉ sai, dùng mở lại chính ca đó với lý do, giữ lịch sử; không xóa công hay phục hồi toàn tháng hàng loạt.

## Xác nhận cuối

Kiểm tra local cuối đã đạt. Chưa xác nhận production. Cần hoàn thành xác thực Vercel để tiếp tục phát hành an toàn.

## Đối chiếu lại toàn bộ kế hoạch người dùng gửi

Nguồn đối chiếu bổ sung: file đính kèm `01b0f094-9a50-44aa-90b9-7e3cbae15984/pasted-text.txt`. Không coi các mục chưa có kết quả là đã hoàn tất.

| Nhóm yêu cầu | Đã có / đã kiểm chứng | Còn phải hoàn tất |
|---|---|---|
| 1. Căn cứ và định danh | Giữ phân biệt người xem/người được xem, lịch nguồn/lịch ngày, công hiện tại/lịch sử | Xác nhận chủ ảnh E5, người mới không hiện, đúng hai ca lớp nghỉ |
| 2. +10 chung | Logic nguồn lịch/alias/tự nhận môn đã có từ bản trước; bổ sung lỗi riêng, quyền đọc proof thiếu, phân trang, giờ chính xác; Rules/integration đạt | Nghiệm thu quyền nhân viên trên production sau deploy; dữ liệu legacy thiếu proof cần quản lý đối chiếu qua luồng duyệt hiện có |
| 3. Vào ca | Auth-ready, UID/render guard; tên chuẩn, chống bấm trùng và retry quyền hiện có được giữ/test | Chưa bổ sung chẩn đoán đầy đủ từng bước auth/token/profile/transaction (hiện chỉ có chẩn đoán vị trí); chưa có đối chiếu riêng nguyên nhân phiên Nhàn 15:37 còn open; chưa chứng minh bằng thiết bị thật việc để nền rồi quay lại |
| 4. Lớp nghỉ báo trễ | Thao tác riêng từng lớp, lý do/audit, kiểm tra xung đột, giữ dữ liệu, không kế thừa; đóng/mở qua browser đạt | Hiện chặn đóng nếu có công thay vì có màn hình đối chiếu ảnh hưởng tiền; chưa có trường thời điểm phụ huynh báo nghỉ riêng; chưa hiệu chỉnh hai ca Toán hoặc xác nhận snapshot lương của đúng ca |
| 5. TV | Báo cáo cũ xác nhận TV1/TV2/TV3 bật; không thu hồi hoặc kích hoạt phạt tháng bằng suy đoán | Cần quyết định chính sách/ngày hiệu lực và danh sách khoản hiệu chỉnh; chưa triển khai công cụ thu hồi riêng do lỗi cấu hình không phạt cả tháng |
| 6. Danh bạ | Cache retry/TTL, nút refresh, lỗi không giả thành danh sách trống; browser đạt | Chưa nghiệm thu đúng màn hình/tài khoản Thủy với người mới cụ thể; chưa rà toàn bộ bộ chọn người trùng tên để xác nhận đều có username/ID |
| 7. Sang/MC | Không nhân đôi công, không đổi chính sách MC vì không được +10; giữ dữ liệu thật | Chưa có bảng từng ca đầy đủ về phút, thưởng, 10 HS, phạt và tiền so với payslip; chưa đủ cơ sở xác nhận MC ngày 14 thiếu hay đã tính đủ |
| 8. Deploy/nghiệm thu | Local regression/Rules/browser đạt | Vercel chưa xác thực; chưa deploy Rules/frontend; chưa smoke test chức năng trên production |

Kiểm tra HTTP trực tiếp alias production ở lần rà này: trả 200, service worker vẫn là `tdt-chamcong-v155-quynh-autosubject-20260906`, không chứa phiên bản incident recovery. `vercel whoami` vẫn trả `Not authorized`. Đây là bằng chứng bản sửa hiện chưa lên production, không phải nghiệm thu sau deploy.

Điều kiện đóng việc: xử lý hoặc ghi nhận rõ quyết định cho từng mục còn lại; deploy đúng project/alias; kiểm tra phiên bản và luồng quyền thật sau deploy. Không sử dụng test emulator để thay thế bằng chứng dữ liệu thực tế hoặc tuyên bố mọi chức năng không thể lỗi.
