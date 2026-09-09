# Kiểm tra và cải thiện công, lương, xếp lịch — 08/09/2026

## Phạm vi và nguyên tắc

Rà luồng Admin và quản lý cấp cao: lịch → chip công → phút/trễ/vắng → đơn giá → bản tính → gửi → xác nhận nhận/chi → file xuất. Làm theo `.agents/AGENTS.md` (RuleHD).

Không chạy sửa hàng loạt, không tạo chấm công thật, không đổi lịch/lương thật của nhân viên để thử. Các bài kiểm tra có ghi dữ liệu chạy trên Firebase Emulator `demo-timekeeping`, không phải production.

## Những điểm đã xử lý

| Vấn đề | Xử lý |
|---|---|
| Admin tính lại phần lương đã gửi nhưng bản tính bị khóa, không có luồng hiệu chỉnh hoàn chỉnh | Lưu bản tính hiệu chỉnh riêng trong `revisionDrafts`, giữ nguyên bản nhân viên đang xem. Admin đối chiếu số cũ–mới, nhập lý do và gửi hiệu chỉnh. Ghi lịch sử bất biến, yêu cầu xác nhận lại đúng phần được sửa. |
| Đổi tháng ở dashboard có thể vẫn giữ danh sách tháng cũ | Tải lại đúng tháng, bỏ listener tháng cũ, kiểm tra thế hệ tải và gắn tháng vào dữ liệu trước khi cho xác nhận chi. Có trạng thái lỗi và nút tải lại. |
| Ghi nhầm nhân viên/tháng khi đổi lựa chọn trong lúc lưu | Khóa thao tác trong thời gian ghi, chống bấm trùng, chặn đổi nhân viên/tháng/nhóm vai trò. Mở danh sách gửi cũng được kiểm tra tháng và lượt tải. |
| Tab khác sửa cấu hình lương | So sánh cấu hình đã đọc trong transaction; không ghi đè cấu hình mới bằng bản cũ. |
| Lưu doanh thu lỗi nhưng vẫn báo thành công | Lưu cấu hình lương và doanh thu trong cùng transaction; từ chối doanh thu không hợp lệ trước khi ghi. |
| Hệ số bằng 0 bị thay bằng giá trị mặc định | Giữ nguyên giá trị 0 hợp lệ trong modal lương tiếp tân. |
| Dashboard đa vai trò dùng tổng cũ dù phần nháp khác đã đổi | Cộng từ các thành phần khi đủ dữ liệu, giữ đúng phân chia đã chi/chưa chi, không sửa bản gửi chỉ để sửa hiển thị. |
| Admin có thể xác nhận chi một số tiền vừa thay đổi ở phiên khác | Gắn xác nhận vào nội dung bảng lương đã xem; bản cũ bị từ chối và yêu cầu tải lại. |
| Khó kiểm tra lịch khi đang tính lương | Thêm khu đối chiếu toàn tháng, số phút từng chip, nút về ngày cần sửa, liên kết lịch dạy/tiếp tân/văn phòng đúng ngày và cơ sở. Trong modal lương có liên kết mở công/lịch ở tab riêng. |
| File cá nhân và file gửi có thể dùng hai cách tính | File in từ màn hình lương đọc lại bản đã lưu trên máy chủ và dùng chung bộ dựng bảng chi tiết với màn hình nhân viên và xuất hàng loạt. Thay đổi chưa lưu không được âm thầm đưa vào file. |
| Thay lịch ở tab khác làm bản tính cũ còn có thể dùng hoặc mất nội dung đang nhập | Đánh dấu dữ liệu nguồn đã đổi, giữ ô đang nhập và yêu cầu tải lại trước khi tính/gửi. Không polling liên tục. |
| Thêm lớp vào lịch kế thừa có thể làm mất các lớp còn lại | Lưu đầy đủ bản kế thừa; transaction kiểm tra phiên bản lịch nguồn trước khi tạo lịch ngày. |
| Sửa/xóa lớp theo chỉ số hàng cũ | Đối chiếu mã ca, thông tin ca và trường đang sửa; từ chối nếu lớp đã bị thay đổi. |
| Mở lại ca cuối cùng không xóa được trạng thái đóng do merge | Ghi cập nhật đúng ngày; giữ trạng thái/ngày và cấu hình khác. Khi mở trạng thái nghỉ cả buổi/ngày, xác nhận rõ phạm vi dùng chung. |
| Bảng hoặc popup cũ xuất hiện khi đổi tuần/cơ sở | Chặn kết quả tải cũ; vô hiệu bảng trong lúc tải/lưu và có nút thử lại. |
| Nút lưu báo thành công khi thực tế chưa lưu | Phân biệt tự lưu, đang lưu và lỗi. Sao chép tuần cố định tuần/cơ sở nguồn, báo rõ số ngày đã sao chép nếu gặp lỗi. |
| PWA nhận bản cập nhật trong lúc Admin đang ghi dữ liệu | Cờ bảo vệ cập nhật nhận biết thêm lưu bảng lương và mọi thao tác sửa/xếp lịch. Không tự tải lại, kể cả khi bấm nút cập nhật trong lúc còn ghi; tải lại được sau khi hoàn tất. |

## Những quy tắc được giữ nguyên

- Quản lý cấp cao được đối chiếu/duyệt công theo quyền đang có. Không tự nâng lên quyền sửa đơn giá, ghi cấu hình hoặc gửi lương của Admin.
- Lịch văn phòng và tiếp tân vẫn là hai nguồn dữ liệu riêng.
- Admin vẫn dùng trình sửa chip hiện có với lịch sử quyết định; không đổi phút/đơn giá hàng loạt và không tự áp lại chính sách mới vào lương cũ.
- Bản lương đã gửi/đã nhận không tự đổi khi mở báo cáo hoặc sửa công. Thay đổi phải qua lưu bản tính và gửi hiệu chỉnh rõ ràng.
- Liên kết lịch mở đúng ngày/cơ sở; trang lịch dạy ghi rõ đang xem toàn bộ cơ sở, **không giả vờ đã lọc theo nhân viên**. Danh sách đối chiếu trên bảng công là của đúng nhân viên đã chọn.

## Kiểm thử

Kết quả kiểm thử: **PASS** cả 4 nhóm dưới đây, kiểm tra cú pháp JavaScript và `git diff --check`. Lượt trình duyệt đa vai trò kết thúc khoảng 07:29 ngày 08/09/2026 (UTC+7); bản bổ sung bảo vệ PWA tiếp tục chạy lại hồi quy và luồng lương sau đó.

- `npm test`: 54 script hồi quy và 3 script pretest; gồm tính phút/giờ, trễ/vắng, qua đêm, +10 phút, đơn giá, sửa chip, quyền, đồng thời và tương thích trang/PWA. Bài PWA kiểm tra 6 cờ đang ghi, giữ ô chưa lưu, tải lại một lần khi trang sạch và hai thao tác xếp lịch cùng đang ghi.
- Bổ sung 20 tình huống hành vi trình xếp lịch.
- `npm run test:rules`: bộ Security Rules hiện có, thao tác DBService thật trên emulator; bổ sung hiệu chỉnh, lịch sử không sửa/xóa được, đa vai trò, xác nhận cũ, doanh thu nguyên tử, cấu hình và lịch mẫu thay đổi giữa hai lần đọc/ghi.
- `npm run test:payroll-ui`: lưu/tính/gửi, đơn giá tháng cũ, lọc không làm thiếu công cả tháng, PDF/HTML cùng nguồn, nhân viên xác nhận và cập nhật live; bổ sung Admin tính lại bản đã nhận, gửi hiệu chỉnh, chặn đổi nhân viên/tháng khi lưu, quản lý cấp cao, mở lịch đúng ngày/cơ sở, dashboard đổi tháng và từ chối xác nhận chi trên bản cũ.
- `npm run test:browser`: các tài khoản thử nghiệm đại diện 8 nhóm vai trò; đăng nhập, vào/ra ca, trang công/lịch, sửa công Admin, đóng/mở lớp và tải lại danh sách nhân sự.

Bằng chứng cục bộ (không tải lên web production): `scratch/payroll-release-browser.log`, `scratch/payroll-release-regression.log`, `scratch/payroll-release-ui.log`, `scratch/payroll-ui-audit-v153.json`, `scratch/payroll-audit-review-panel.png`, `scratch/payroll-audit-senior-review.png`. Tệp audit có tên v153 là tên kế thừa của công cụ; nội dung được tạo lại bằng mã hiện tại ngày 08/09/2026.

## Cách dùng sau cập nhật

1. Chọn nhân viên và tháng tại **Tính Lương & Duyệt Công**. Khu **Đối chiếu công & lịch** mở lịch đúng ngày/cơ sở ở tab riêng; **Xem/sửa công** đưa về ngày trên bảng công để sửa chip bằng trình hiện có.
2. Chỉnh cấu hình hoặc công, bấm **Lưu & Tính**. Phần chưa gửi vẫn theo quy trình gửi hiện có; phần đã gửi/đã nhận tạo **bản hiệu chỉnh chưa gửi**, không thay bản nhân viên đang xem.
3. Kiểm tra tiền cũ–mới, chọn **Đối chiếu & gửi hiệu chỉnh**, nhập lý do. Lịch sử lưu bản trước/sau; nhân viên xác nhận lại đúng phần thay đổi. Các phần lương khác đã nhận không bị hủy xác nhận.
4. **Xem/in bản đã lưu** đọc máy chủ và dùng chung mẫu chi tiết bảng lương. Với bản đang hiệu chỉnh, bản in vẫn là bản đang gửi cho đến khi Admin gửi hiệu chỉnh thành công.
5. Nếu lịch đổi ở tab khác, tải lại trước khi lưu/gửi. Nếu có báo xung đột, đối chiếu lại dữ liệu mới; không ép ghi đè. Quản lý cấp cao giữ quyền duyệt/đối chiếu công hiện có, không được tự nâng quyền sửa/gửi lương.

## Phát hành

- Phiên bản: `20260908-payroll-review-v2`.
- Cache PWA: `tdt-chamcong-v159-payroll-review-20260908`.
- Dự án Vercel: `ha-huy-dungs-projects/timekeeping-system`, ID `prj_58GRPpalLQeeweIG1MYu3ji5K6ZH`.
- Firebase: `timekeeping-69f3f`. Rules mới chỉ thêm quyền Admin tạo/đọc lịch sử hiệu chỉnh; không mở quyền tài chính cho nhân viên.
- Production: `https://timekeeping-system-tawny.vercel.app`.
- Firebase Rules đã phát hành thành công vào khoảng 07:29 (UTC+7), đúng dự án.
- Bản v1 / commit `f5fefad` đã lên production (`dpl_ChJUveDZ287NdjT9UMZgDcpnRZLi`). Khi kiểm tra cache, PWA tải lại trang đăng nhập sạch theo thiết kế; công cụ kiểm tra được điều chỉnh chờ hết lượt tải lại. Rà tiếp cơ chế cập nhật đã bổ sung cờ bảo vệ cho thao tác lưu lương và sửa lịch ở v2.
- Deploy cuối: **READY / production**, lúc **07:34 ngày 08/09/2026 (UTC+7)**.
- Commit mã phát hành: `f7e9e8a` (đã push `origin/main`; sau push Git không còn ahead/behind). Commit tính năng chính: `f5fefad`.
- Deployment ID: `dpl_9gWm2UaHmibze5haaCHaCDjx3zRN`.
- URL bản deploy: `https://timekeeping-system-fjppv7e3a-ha-huy-dungs-projects.vercel.app`; `vercel inspect` xác nhận alias **`https://timekeeping-system-tawny.vercel.app`** trỏ đúng bản này. Dự án static, framework Other; CLI hoàn tất khoảng 11 giây.
- Sau deploy, `production-readonly-smoke.cjs`: **PASS**. HTTP 200 và SHA-256 của 9 tệp JS/Service Worker khớp chính xác mã cục bộ đã test; HTML bảng công có script đối chiếu mới và header không cache cứng.
- Chrome mobile 430×932: trang đăng nhập hiển thị, chiều rộng trang = 430, không tràn ngang; Service Worker active, cache v159 chứa 52 tài nguyên; không có uncaught JavaScript error trong lượt kiểm tra, không phát sinh yêu cầu ghi Firestore.
- Bằng chứng: `scratch/production-payroll-review.json` và `scratch/production-payroll-review.png` (không tải lên production).
- Vercel error-log scan cho đúng deployment: `No logs found`. Đây là giới hạn quan sát của lượt quét, **không** phải bằng chứng mọi điện thoại đều không lỗi. Không thiết lập thêm monitoring/notification định kỳ hoặc dịch vụ trả phí.

Phương án quay lại mã trước thay đổi nếu cần: deployment `dpl_G8vT6qqL4yTco8LLPrAXbNQQP1TX` / commit `8d64932`. Chưa thực hiện rollback. Không có migration hoặc chỉnh dữ liệu nhân viên thật trong đợt này; Rules thêm lịch sử hiệu chỉnh tương thích với mã cũ. Nếu đã gửi hiệu chỉnh sau phát hành thì cần đối chiếu lịch sử riêng, không tự xóa bản ghi khi rollback giao diện.

## Giới hạn kiểm chứng

Kiểm thử nghiệp vụ ghi dữ liệu chạy trên emulator với trình duyệt Chrome. Kiểm tra production là đọc trang/tài nguyên và trạng thái deploy, không bấm tạo công hoặc gửi lương thử cho nhân viên thật. Chưa kiểm chứng từng điện thoại/iOS/Wifi thực tế; không thể cam kết tuyệt đối không có lỗi trong mọi tình huống hoặc mọi dữ liệu lịch sử.

Phạm vi rà soát tập trung các nguồn và nơi sử dụng công–lịch–lương nêu trên, không phải chứng nhận từng dòng của toàn bộ mã nguồn hay toàn bộ dữ liệu nhân sự lịch sử.
