# TNCN tùy chọn và thao tác xét lương theo giáo viên — 06/10/2026

- TNCN bằng 10% thu nhập trước tạm ứng, từ kỳ 10/2026. Mặc định không khấu trừ. Admin chọn riêng theo nhân viên/tháng/phần lương. Snapshot lưu số thuế tính ra và số thực tế khấu trừ; phiếu, PDF và Excel đối chiếu với thực lĩnh.
- Danh sách xét lương gom mỗi giáo viên một dòng. Thiết lập chung đổi mốc/chu kỳ/ngày nhắc trong một lần lưu hồ sơ, giữ các giá khác nhau. Xét tăng gom các môn cùng giá thành một ô nhập nhưng vẫn giữ nhóm, hạn xét và lịch sử riêng.
- So sánh Git ngày 05/10 (`0bc40b4`) với thay đổi 00:09 ngày 06/10 (`3158b32`): bản 05/10 cũng tách theo nhóm môn; bản sau thêm MSNV và đổi thứ tự. Không có bằng chứng để khẳng định thao tác cụ thể mà người dùng nhớ là thao tác nào.

## Kiểm chứng

`npm run test:salary --prefix test-automation`; salary-review board/service/application; evaluation-service; session-link-preservation; attendance-regressions; payout-month; service-worker-shell; page-compatibility: PASS.

Chrome local: một dòng/giáo viên, thiết lập chung lưu một hồ sơ và giữ giá/mốc từng nhóm, nhập một mức cho nhiều nhóm cùng giá, không lẫn giáo viên, mở nhóm để xét riêng, lọc tên/môn và viewport 390px: PASS.

## Quang Huy — kiểm tra đọc dữ liệu

Tài khoản `huy04`, staff ID `nv_1772981307954`. Snapshot kiểm tra nằm ngoài thư mục deploy trong `.attendance-repairs/quang-huy-20261006-audit.json`.

- 03/10 và 04/10: công gốc và bằng chứng vào ca vẫn tồn tại; tái tính với bộ tính ngày 05/10 và hiện tại cho kết quả giống nhau.
- Kiểm tra thêm 03/08, 04/08, 29/08: công vẫn còn, gồm ca chấm bù 29/08 đã duyệt; bộ tính cũ/mới cho kết quả giống nhau.
- 03/09, 04/09, 29/09: chưa tìm được công tương ứng. 03/09 có lịch dạy, 04/09 có lịch tiếp tân, 29/09 chưa thấy lịch được phân công. Chưa xác định được tháng/phần dữ liệu người dùng báo mất; không tạo hoặc đổi công từ giả định về lịch.
- Firestore hiện không bật PITR, chỉ có lịch sử một giờ. Không thể đối chiếu trực tiếp trạng thái dữ liệu hôm qua bằng PITR. Không đổi cấu hình này trong tác vụ.
- Không sửa dữ liệu production, không gửi thông báo và không sửa Rules/Functions.

## Production

Đích đã xác minh: `ha-huy-dungs-projects/timekeeping-system`, project `prj_58GRPpalLQeeweIG1MYu3ji5K6ZH`, alias `https://timekeeping-system-tawny.vercel.app`.

Bản trước phát hành: `dpl_G6YGkMjSNRUUjTHEsk8JeBPofq7w`. Trạng thái triển khai và bằng chứng kiểm tra sau deploy được ghi trong `scratch/production-tax-grouped.json` và log triển khai; không đưa thư mục scratch lên production.
