# Tự ra ca theo lịch — bàn giao 19/09/2026

## Yêu cầu và phạm vi

Người dùng báo thỉnh thoảng ca chưa tự ra mặc dù chip công đúng. Đã sửa có giới hạn
ở `js/main.js` và `js/db-service.js`. Không sửa VÀO CA, cổng địa điểm, cách tính lương,
giá môn, lịch đã xếp hay dữ liệu nhân viên. Không ghi dữ liệu production, không migrate,
không deploy trong phần công việc của agent này. Agent chính thực hiện release chung.

Đã đọc `claude/WORKFLOW.md`, `claude/system_logic.md`, `.agents/AGENTS.md` (Rule HD).
User đã cho phép thực hiện, điều chỉnh plan, kiểm thử và deploy. Không cần một lần
duyệt plan khác theo mẫu workflow cũ.

## Kết quả phân tích

- Hook mở lại app/online/pageshow đã có từ bản trước. Hook bỏ cache chấm công nhưng
  lịch dạy, lịch tiếp tân/văn phòng, cấu hình và ca hủy có cache trong bộ nhớ không
  hết hạn. Tab mở lâu có thể dùng phân công/giờ tan cũ dù chip trên lần đọc khác đúng.
- Bộ gom ca trước đây nuốt lỗi một nguồn lịch thành `[]`. Người kiêm nhiệm có nguy
  cơ bị chốt theo phần lịch đọc được dù nguồn còn lại đang lỗi.
- Tính mốc tự ra và transaction ghi cách nhau một khoảng thời gian. Transaction
  cũ lấy ca mở mới nhất mà không xác nhận đây còn là ca đã tính mốc.
- Phiên chấm công chỉnh tay có `isAdminEdited`; tự ra ca phải tôn trọng cả ca đã
  đóng lẫn quyết định admin để mở. Phép tính chip vốn đã có bảo vệ này.
- Trình duyệt bị tắt/đóng băng không thực thi JavaScript; đây là giới hạn của cơ chế
  client hiện tại, không thể sửa hoàn toàn bằng một timer phía trình duyệt.

Đây là các đường lỗi xác nhận từ code + tái hiện bằng fixture. Chưa xác định một
log lỗi cụ thể của nhân viên là do duy nhất nguyên nhân nào; không khẳng định đã
đối chiếu sự cố thật của từng cá nhân.

## Thay đổi

1. Chỉ khi tài khoản hiện tại có ca mở, đọc đủ các nguồn liên quan từ server. Gom
   cả dạy, tiếp tân, văn phòng của ba cơ sở, giữ cách nối khúc nghỉ tối đa 20 phút,
   ca hủy, nghỉ trung tâm, thay giáo viên và ca qua đêm.
2. Cache riêng một snapshot lịch của người/ngày đang mở trong 5 phút. Interval vẫn
   60 giây, không quét tất cả nhân viên, không đọc lịch của người đang không có ca.
   Các lần đọc cơ sở vẫn song song. Cấu hình system chỉ đọc một lần/snapshot, dùng
   cùng kết quả cho lịch tiếp tân/văn phòng để tránh nhiều lần đọc cấu hình.
3. Trước khi ghi mốc đến hạn từ snapshot cũ, đọc lại toàn bộ nguồn server và tính lại.
   Admin kéo dài, rút ngắn, hủy hoặc khôi phục lịch sẽ được nhận ở lần đọc mới; mở lại
   app đọc mới ngay. Thiếu nguồn/đứt mạng thì giữ nguyên ca, không lấy lịch một phần.
4. Thêm tham số tùy chọn `source: 'server'` cho `getPersonalAttendance` và
   `getSystemSettings`; các caller cũ không truyền tham số giữ hành vi như trước.
5. Tự ra ca truyền `expectedSession` gồm ngày gốc, ID, giờ vào/start. Transaction
   xác nhận đúng ca, chưa đóng, chưa chỉnh tay và cùng phiên đăng nhập trước khi ghi.
   Nhân viên vừa vào ca khác hoặc admin vừa sửa thì hủy lượt tính cũ. Các trường giá,
   vai trò, link môn/ca, thưởng 10 phút, số học sinh và trường khác được giữ nguyên.
6. Ghi `autoClosedReason: 'scheduled_end'` cho ca tự ra mới. Đây khác với marker cũ
   `stale_session`; khối tính báo cáo không xem marker mới là yêu cầu sửa lại giờ ra.
   Luồng sửa giờ của admin hiện có sẽ xóa marker như trước.
7. Tái dùng cơ chế refresh credential và retry đúng một lần khi transaction bị
   `permission-denied`; không retry lỗi có thể đã commit và không đặt timeout giả
   quanh write. Lượt tự ra có cờ `__autoCheckoutPending`, chặn PWA reload giữa write.

## Bảo vệ dữ liệu / đường sửa sai

- Chỉ xử lý ca mở của chính tài khoản trên thiết bị, hôm nay hoặc hôm trước để giữ
  ca qua đêm. Không backfill chấm công cũ, không ghi khi mở báo cáo của người khác.
- Ca đã ra, ca vắng, ca không khớp lịch và ca có `isAdminEdited` được giữ nguyên.
- Ca đang làm chưa tới giờ, ca tiếp tân chồng lớp dạy và khoảng nghỉ buổi tối dài
  tiếp tục theo quy tắc đã có. Tự ra không nối ca sáng sang ca tối cách nhiều giờ.
- Admin vẫn sửa giờ sau tự ra theo luồng sửa hiện tại; lần mở lại app không đè giờ đó.
- Toàn bộ bảng công/phiếu đã gửi và cơ chế chọn giá không đổi. Chỉ ghi bổ sung giờ ra
  cho đúng ca đang mở sau đủ điều kiện, trong transaction.

## Kiểm thử

Đã chạy:

- `node --check js/main.js`, `node --check js/db-service.js`.
- `auto-checkout.test.js`: nối ca kiêm nhiệm, cách giờ xa, lớp nghỉ ngắn, bỏ ca đã
  kết thúc trước check-in, resume/single-flight, giao diện không deadlock.
- `auto-checkout-freshness.test.js` (mới): cache/read-count, mở lại lấy lịch mới,
  kéo dài/rút ngắn, nguồn lỗi và retry, nhận diện ca cũ, admin sửa, đổi tài khoản,
  ca qua đêm, giữ trường tài chính và link, strict read và cờ PWA.
- `app-update-write-safety.test.js`: thêm cờ tự ra ca vào kiểm tra ngăn reload.
- `attendance-overnight.test.js`; `startup-performance.test.js` trước khi trang
  xét tăng lương mới được agent khác thêm.
- Emulator `auto-checkout-rules.test.js` (mới): chạy DBService và resolver thật với
  Firestore Rules, đọc lịch/cấu hình/ca hủy bằng tài khoản staff, ghi đúng mốc 11:00
  khi mở app lúc 12:00, giữ giá/link/thưởng/sĩ số, giữ chỉnh sửa admin và từ chối ca
  đã thay đổi. Emulator demo-only, không dùng production.
- Full `npm test`: mọi kiểm tra nghiệp vụ/attendance/payroll đi qua; ở thời điểm
  chạy, dừng tại startup-performance vì trang mới đang dùng version asset khác
  bản cũ. Agent chính cần đồng bộ version rồi chạy toàn bộ suite lại trước deploy.

Agent chính cần thêm `auto-checkout-freshness.test.js` vào script `test`, thêm
`auto-checkout-rules.test.js` vào script `test:rules`, đồng bộ version HTML/SW/main,
chạy regression + browser smoke và kiểm tra alias sau release.

## Giới hạn cần nói đúng với người dùng / phiên sau

Ứng dụng đang mở sẽ kiểm tra mỗi phút; mở lại/online sẽ kiểm tra ngay. Nếu tắt hẳn
trình duyệt/PWA, dữ liệu chỉ được bổ sung khi app chạy lại trong phạm vi ngày đang
hỗ trợ. Chip vẫn có thể hiển thị công theo lịch mà raw session chưa có checkOut.
Không tự sửa những ca cũ nhiều ngày trong bản này. Muốn đảm bảo ghi đúng giờ khi
không thiết bị nào mở app cần một job backend có quyền hạn, idempotency, audit và
kiểm thử riêng; chưa thêm job vì đây là thay đổi hạ tầng/phạm vi khác.

Không tuyên bố mọi lỗi tự ra ca đã được loại trừ hoặc đã chạy thử ghi dữ liệu thật.
