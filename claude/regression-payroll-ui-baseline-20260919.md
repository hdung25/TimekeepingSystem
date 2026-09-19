# Đối chiếu lỗi kiểm thử popup công — 19/09/2026

Trong hồi quy `payroll-ui-flow.test.js`, helper `scheduled-overtime-ui.cjs` dừng ở kiểm tra mode ban đầu: thực tế `actual`, assertion cũ chờ `schedule`.

Đây là assertion bị cũ, không phải thay đổi tính công trong đợt xét lương:

- Helper được thêm/sửa lần cuối tại `41c6a78` (“preserve scheduled pay when editing overtime”).
- Sau đó commit `a78c1f9` ngày 10/09/2026 (“preserve first admin payroll override choice”) chủ động đổi mode mặc định của phiên chưa có override từ `schedule` sang `actual`. Mục đích là giữ quyết định +10 mà admin vừa chọn trong lần lưu đầu. Mode đã lưu vẫn được ưu tiên; `schedule` là lựa chọn quay lại lịch.
- `js/admin-payroll-override-ui.js`, `js/report.js` và bộ evaluator không có thay đổi so với HEAD tại thời điểm kiểm tra.
- Đã chạy chính harness và helper cũ bằng browser/emulator cục bộ, HTTP server chỉ phục vụ nội dung `git show HEAD:<file>` và Rules từ HEAD. Kết quả lặp lại đúng lỗi `actual` / `schedule` tại dòng 42. Mã nguồn đang sửa không bị reset. Bằng chứng nằm trong `scratch/payroll-ui-head-baseline.json` (chỉ fixture cục bộ, không đưa lên production).

Sửa duy nhất ở helper: assertion mặc định thành `actual` và thêm giải thích hợp đồng hiện hành. Giữ nguyên các kiểm tra chọn `schedule`, 90 phút lịch + 15 phút OT thành 105 phút, hoàn OT về 90 phút, giữ giây giờ chấm, fingerprint và chống popup cũ ghi đè sửa công mới.

Không sửa mã tính công/lương để làm vừa assertion cũ. Agent phụ trách trình duyệt chạy lại toàn bộ payroll UI sau chỉnh test; kết quả cuối được ghi trong bàn giao release chung.

## Lỗi dữ liệu cũ khi quản lý cấp cao lưu phí tư vấn

Sau khi vượt qua assertion cũ, cùng luồng kiểm thử dừng ở bước lưu phí tư vấn của quản lý cấp cao. Đã chạy lại toàn bộ bằng mã nguồn và Rules từ HEAD trên cổng emulator riêng; lỗi `permission-denied` lặp lại. Bản đang sửa cũng lỗi giống vậy, nên đây là lỗi tương thích dữ liệu đã tồn tại.

Nguyên nhân: một số dữ liệu cũ lưu `tiep_tan.evaluation` thành một object `{id: 1, amount: ..., note: ...}`. `DBService.saveConsultationFee` đã chuyển object này thành mảng một dòng trong lần lưu rõ ràng của người dùng. Nhưng Firestore Rules gọi `removeAll` trực tiếp trên object cũ, khiến thao tác hợp lệ bị chặn.

Sửa hẹp ở `isConsultationFeeEvaluationEdit`: nếu dữ liệu trước là object có `id`, bọc nó thành danh sách một phần tử để đối chiếu. Dữ liệu sau bắt buộc vẫn là danh sách. Giữ nguyên kiểm tra quyền quản lý cấp cao, actor, tháng, mã nhân viên, số tiền, thời gian server, cờ chờ tính lại và toàn bộ giới hạn chỉ sửa số tiền phí tư vấn. Không quét/chuyển đổi dữ liệu cũ hàng loạt; đọc báo cáo không ghi dữ liệu.

Kiểm thử emulator bổ sung cho cả khóa `tiep_tan` và `tiep-tan`: lưu thành công object cũ, giữ note và metadata, sửa về 0, thêm phí tư vấn vào object tiêu chí khác nhưng giữ nguyên tiêu chí đó. Đồng thời chặn đổi id/note/metadata, bỏ metadata, thêm dòng thưởng khác, thay tiêu chí khác, sửa tạm ứng và thay bảng lương đã công bố. Trường hợp mảng chuẩn và các quy tắc cũ tiếp tục được kiểm tra trong cùng bộ hồi quy.
