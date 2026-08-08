# Kế hoạch an toàn: đối soát và tự động hoá tính lương

Ngày cập nhật: 2026-08-09
Trạng thái: giai đoạn 1 đang triển khai, **chưa bật tự động tính/phát lương**.

## Mục tiêu và nguyên tắc bất biến

1. Cách tính lương hiện tại là nguồn sự thật. Mọi nhân sự mặc định ở chế độ
   `legacy`; cấu hình mới không được đổi đơn giá, công, bảng lương đã khoá hay
   bảng lương đã gửi.
2. Chế độ `shadow` chỉ tính thử để so sánh. Kết quả là bản nháp cần admin duyệt;
   không có quyền phát hành phiếu lương hoặc ghi đè dữ liệu cũ.
3. Mọi sửa giờ thủ công phải giữ liên kết ca/lớp cũ, trừ khi người sửa chọn rõ
   thay thế hoặc xoá liên kết. Mỗi lần sửa lưu lịch sử trước/sau.
4. Không di trú hay ghi hàng loạt dữ liệu cũ trong giai đoạn 1.

## Các lỗi được đưa vào phạm vi xử lý

### 1. Nguyễn Hoàng Thái: báo cáo 0 giờ nhưng bảng chi tiết còn 128 giờ

Nguyên nhân đã xác nhận ở tầng giao diện: báo cáo bất đồng bộ có thể để lại
`subject breakdown` của người/tháng trước khi URL chuyển sang nhân sự mới.
Đây là lỗi hiển thị/trạng thái, chưa có bằng chứng Firestore đã xoá công của
thầy Thái. Bản sửa xóa toàn bộ số liệu dẫn xuất trước khi tải, gắn mỗi lần render
với `staffId + month`, và bỏ kết quả trả về muộn của lần render cũ.

### 2. Trang Anh: ca thứ Ba sửa tay xong chỉ còn tính 2 giờ thay vì 8 giờ

Nguyên nhân kỹ thuật đã xác nhận: `DBService.updateSession` cũ xoá cả
`linkedClassStart` và `linkedReceptionistShift` ở mọi lần sửa. Khi liên kết bị
mất, tính lương có thể chỉ nhận phần giờ không bị đứt liên kết. Bản sửa giữ các
trường đó theo mặc định, chỉ xoá khi truyền `clearScheduleLinks: true` rõ ràng,
và lưu 20 lịch sử sửa gần nhất ngay trong session.

Để đối chiếu bản ghi cụ thể của Trang Anh vẫn cần ngày thứ Ba hoặc link báo cáo
đầy đủ; không suy đoán và không ghi sửa dữ liệu lịch sử khi chưa có bản ghi đó.

## Hiện trạng dữ liệu và các ràng buộc

| Nguồn | Vai trò hiện tại | Quy tắc giai đoạn 1 |
| --- | --- | --- |
| `users` + `salary_config` | Nhân sự và đơn giá cũ | Không thay đổi cấu trúc/công thức |
| `salary_settings`, `salary_settings_monthly` | Cấu hình lương theo kỳ hiện tại | Chỉ đọc khi đối soát; không ghi tự động |
| `subjects` | Nhóm môn, `allowEarly10` | Là nguồn cho quy tắc sớm 10 phút |
| `schedules` | Lịch/lớp được xếp | Không di trú, không thay lịch |
| `attendance_logs/{date}_{staffId}.sessions[]` | Công và liên kết ca | Chỉ sửa khi admin chủ động sửa công; có audit trước/sau |
| `staff_payroll_profiles/{staffId}` | Mới: giờ tích lũy trước web app và chế độ đối soát | Tách biệt hoàn toàn với đơn giá/bảng lương cũ |

Firebase CLI đã xác nhận project là `timekeeping-69f3f`, Firestore ở
`asia-southeast1`; hiện chưa có lịch backup/PITR. Vì vậy chưa được phép di trú,
bulk write hoặc bật tự động chạy lương. Việc bật backup/PITR có thể phát sinh chi
phí và phải có phê duyệt riêng trước khi thực hiện.

## Thiết kế lương tương lai (chưa bật)

```text
subjects.allowEarly10 + thâm niên/điều kiện nhân sự
                  │
schedules ──> attendance_logs đã duyệt ──> bộ tính thử theo tháng
                  │                              │
                  │                              ├─ legacy result (hiện hành)
                  │                              └─ proposed result (shadow)
                  │
staff_payroll_profiles: giờ trước web app ──> tổng giờ tích lũy
```

- Quy tắc “sớm 10 phút” không được nhân bản bằng tên môn. Nó tiếp tục dùng cờ
  `subjects.allowEarly10`: chỉ nhóm Tiếng Anh đã được cấu hình và nhân sự đủ điều
  kiện theo chế độ cũ mới nhận; Toán/Tiếng Việt không tự có 10 phút.
- Các môn đặc biệt (Kèm 1:1, Tin học...) sẽ là mức/nhóm đơn giá riêng trong
  policy version mới, nhưng trong giai đoạn 1 vẫn dùng `salary_config` cũ.
- Giờ tích lũy gồm `historicalMinutesBeforeApp` do admin nhập có ghi chú nguồn,
  cộng với giờ sau khi dùng app đã được duyệt. Không dùng công đang chờ duyệt,
  vắng, hoặc ca bị loại để tự đề xuất tăng lương.
- Điều kiện xét tăng lương sẽ là mẫu rỗng có version: tổng giờ, giờ dạy, giờ
  tiếp tân, vắng có phép/không phép, đi trễ, công bù, ghi chú ngoại lệ, và ngày
  hiệu lực. Chỉ admin điền và duyệt ở pha sau.

## Các pha triển khai

### P0 — khóa an toàn và hồi quy (đang làm)

- Sửa lỗi trạng thái báo cáo Nguyễn Hoàng Thái.
- Sửa mất liên kết sau khi admin sửa giờ và lưu audit cho Trang Anh.
- Bổ sung `ruleHD`: không báo cáo nào được ghi âm thầm vào công/lương/payslip;
  deploy luôn xác minh đúng tài khoản, team, project, alias.
- Regression bắt buộc: báo cáo theo nhân sự/tháng, sửa ca, early-10, chấm bù,
  tháng trả, và lớp trùng giờ.

### P1 — hồ sơ tích lũy, không chạm lương cũ (đang làm)

- Trong Cấu hình lương thêm khối “Giờ tích lũy & đối soát tự động”.
- Admin có thể nhập giờ trước thời điểm dùng app và ghi nguồn; có xác nhận trước
  khi lưu.
- Có công tắc `shadow`, nhưng bản hiện tại không tạo phiếu lương hay thay đổi
  bảng lương. `allowAutomaticDraft` được khoá `false`.

### P2 — trình đối soát chỉ đọc

- Tạo `payroll_shadow_runs/{staffId}_{month}_{policyVersion}` chứa snapshot đầu
  vào, kết quả legacy, kết quả đề xuất, chênh lệch, người chạy/duyệt và thời điểm.
- Hiển thị chênh lệch theo môn/ca, early-10, công bù, phạt/vắng; không có nút ghi
  đè cho đến khi dữ liệu đủ.
- Bổ sung trang danh sách đủ điều kiện tăng lương, bắt đầu bằng các trường tiêu
  chí rỗng để admin xác định quy tắc thực tế.

### P3 — duyệt có kiểm soát

- Mỗi tháng chạy shadow cho một nhóm thử nghiệm, so sánh với bảng lương cũ và
  ký duyệt chênh lệch bằng lý do.
- Chỉ sau ít nhất một chu kỳ khớp dữ liệu, admin mới có thể tạo *draft* lương.
  Draft không được gửi và có nút huỷ/khôi phục rõ ràng.

### P4 — chuyển đổi từng phần

- Bật theo từng nhân sự/nhóm, không bật toàn trung tâm.
- Trước mỗi đợt: backup có thể khôi phục, snapshot nguồn, kiểm thử hồi quy và
  cửa sổ rollback đã được xác nhận.
- Giữ `legacy` là phương án quay lui từng nhân sự; không xoá cấu hình cũ.

## Cổng deploy và rollback

1. Xác thực Vercel account/team `ha-huy-dungs-projects`, project
   `timekeeping-system`, và alias `timekeeping-system-tawny.vercel.app`.
2. Xác thực Firebase project bằng tham số tường minh `--project timekeeping-69f3f`.
3. Chạy toàn bộ regression và kiểm tra cú pháp trước deploy.
4. Deploy rules chỉ mở collection profile mới cho admin; không đổi rule các
   collection công/lương cũ.
5. Sau deploy, kiểm tra HTTP tại alias đúng và mở Cấu hình lương để xác nhận
   công tắc vẫn mặc định `legacy`.
6. Nếu lỗi, rollback deployment Vercel về deployment trước; không chạy script
   “sửa dữ liệu” tự động. Bản ghi session vẫn có `editHistory` để đối chiếu.
