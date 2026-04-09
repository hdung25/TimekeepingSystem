# WORKFLOW.md — Quy Trình Làm Việc AI Cho Dự Án TimekeepingSystem

> **File này dành cho AI Coder (Antigravity hoặc bất kỳ AI nào được giao task trong dự án này).**
> Đọc kỹ toàn bộ file này TRƯỚC KHI làm bất cứ điều gì.

---

## 1. BỐI CẢNH DỰ ÁN

Đây là hệ thống chấm công cho Trung Tâm Ngoại Ngữ & Toán Tư Duy Trẻ.

- **Source of truth kỹ thuật:** `system_logic.md` (luôn đọc file này trước)
- **Tech Stack:** Vanilla JS + Firebase + Vercel (không có BE truyền thống)
- **Không dùng framework** — tuyệt đối không tự ý thêm React/Vue/npm packages

---

## 2. MÔ HÌNH LÀM VIỆC 3 BÊN

```
[OWNER - hdung25]
    ↕ giao task / review
[CLAUDE - Phân tích & thiết kế giải pháp]
    ↕ đưa plan đã được duyệt
[ANTIGRAVITY - Thực thi code]
    ↕ commit code
[OWNER - test thực tế]
```

**Nguyên tắc quan trọng:**
- **Claude** phân tích vấn đề, phát hiện rủi ro, đưa ra Technical Plan
- **Antigravity** CHỈ thực thi theo plan đã được Owner duyệt — không tự sáng tạo ngoài scope
- **Owner** là người duyệt plan và test cuối cùng — quyết định cuối thuộc về Owner

---

## 3. QUY TRÌNH CHO MỖI TASK

### Bước 1 — Khi nhận task từ Owner
1. Đọc `system_logic.md` để nắm context
2. Đọc kỹ các file liên quan đến task (không đọc hết codebase nếu không cần)
3. **KHÔNG CODE NGAY** — dù task có vẻ đơn giản

### Bước 2 — Lập Technical Plan
Trả lời Owner theo format sau:

```
## 📋 Technical Plan: [Tên Task]

### Hiểu vấn đề
[Mô tả ngắn bạn hiểu task là gì]

### Phát hiện rủi ro / Mâu thuẫn
[Liệt kê nếu có — hoặc ghi "Không có rủi ro phát hiện"]

### Giải pháp đề xuất
[Mô tả approach]

### Các thay đổi cụ thể
- Sửa `js/ten-file.js` dòng X: [mô tả]
- Thêm vào `ten-file.html` tại [vị trí]: [mô tả]
- Tạo mới file: [tên file]

### Không thay đổi
[Liệt kê những file/feature KHÔNG bị ảnh hưởng]

### Test checklist
- [ ] [điều kiện test 1]
- [ ] [điều kiện test 2]
```

### Bước 3 — Chờ duyệt
**TUYỆT ĐỐI KHÔNG CODE** cho đến khi Owner (hoặc Claude) confirm plan.

### Bước 4 — Thực thi
- Code đúng theo plan đã duyệt
- Nếu phát hiện vấn đề mới trong lúc code → **DỪNG LẠI** và báo cáo ngay
- Không tự mở rộng scope ("tiện thể sửa luôn X")

### Bước 5 — Cập nhật `system_logic.md`
Sau khi code xong và Owner confirm chạy OK:
- Cập nhật Mục 11 (Nhật Ký Tiến Độ) trong `system_logic.md`
- Nếu có thay đổi collection/role/flow mới → cập nhật section tương ứng

---

## 4. QUY TẮC BẤT BIẾN (KHÔNG BAO GIỜ VI PHẠM)

| ❌ KHÔNG | ✅ NÊN |
|---|---|
| Tự thêm npm packages / framework | Dùng Vanilla JS thuần |
| Sửa file ngoài scope plan | Chỉ sửa đúng file đã liệt kê trong plan |
| Xóa code cũ mà không hỏi | Hỏi Owner trước khi xóa |
| Thay đổi Firestore Rules mà không hỏi | Đề xuất trong plan, chờ duyệt |
| Commit thẳng lên main khi chưa test | Test local trước |
| Bịa thông tin khi không chắc | Nói "Tôi không chắc, cần kiểm tra" |
| Tự ý đổi tên function/variable quan trọng | Giữ nguyên naming convention |
| Bỏ qua `system_logic.md` | Luôn đọc trước khi làm |

---

## 5. XỬ LÝ CÁC TÌNH HUỐNG ĐẶC BIỆT

### Khi task mâu thuẫn với code hiện tại
→ **DỪNG LẠI** — báo cáo mâu thuẫn cho Owner, đưa ra 2-3 option để Owner chọn

### Khi không chắc một function/flow hoạt động như thế nào
→ Đọc code thực tế (không đoán), nếu vẫn không chắc → hỏi Owner

### Khi phát hiện bug ngoài scope task
→ Ghi chú lại, báo cáo cho Owner sau khi hoàn thành task hiện tại — không tự sửa

### Khi Owner yêu cầu thay đổi plan giữa chừng
→ Dừng lại, lập plan mới, chờ confirm lại

### Khi có lỗi runtime sau khi deploy
→ Báo cáo ngay với log lỗi cụ thể, đề xuất rollback nếu cần

---

## 6. CONVENTIONS CODE

### Naming
- Functions: camelCase (`calculateDailyChips`, `renderSidebar`)
- CSS classes: kebab-case (`chip-green`, `glass-panel`)
- Firestore doc IDs: snake_case hoặc `__` separator (`cs1__2026-03-18`)
- File JS: kebab-case (`db-service.js`, `evaluation-service.js`)

### Firebase
- Luôn dùng `db.runTransaction()` cho các thao tác read-then-write
- Dùng `getLocalDateKeyFromDate(new Date())` thay vì `new Date().toISOString().split('T')[0]` (timezone bug)
- Không hardcode collection name — dùng `db.collection('tên_collection')`

### UI
- Toast notification: `UIService.toast(message, 'success'|'error'|'warning'|'info')`
- Confirm dialog: `await UIService.confirm(message)` → trả về `true/false`
- Không dùng `window.alert()` hay `window.confirm()` trực tiếp (đã bị override bởi UIService)

### Roles
Luôn check đủ 6 roles khi viết điều kiện:
```javascript
// ✅ Đúng
if (['admin', 'senior_assistant'].includes(role)) { ... }

// ❌ Sai (thiếu senior_assistant)
if (role === 'admin') { ... }
```

---

## 7. THÔNG TIN KỸ THUẬT NHANH

| Thông tin | Giá trị |
|---|---|
| Firebase Project | `timekeeping-69f3f` |
| Email format Auth | `{username}@tuduytre.com` |
| Deploy URL | https://timekeeping-system-tawny.vercel.app |
| Firebase SDK | Compat v10.7.1 |
| Branch naming | `cs1`, `cs2`, `cs3` |
| Schedule doc format | `cs1__YYYY-MM-DD` |
| Attendance doc format | `YYYY-MM-DD_nv_timestamp` |

---

## 8. CHECKLIST TRƯỚC KHI COMMIT

- [ ] Đã đọc `system_logic.md`
- [ ] Plan đã được Owner duyệt
- [ ] Chỉ sửa đúng file trong plan
- [ ] Không có console.error mới không được xử lý
- [ ] Test trên ít nhất 2 role (admin + 1 role khác)
- [ ] Không hardcode credential hay API key
- [ ] Nếu thay đổi Firestore Rules → đã deploy rules mới
- [ ] Đã cập nhật `system_logic.md` Mục 11

---

*File này được tạo ngày 18/03/2026. Reviewed & còn đúng ngày 09/04/2026.*

> **Lưu ý:** Số role hệ thống là **7**: `admin` | `senior_assistant` | `assistant` | `teaching_assistant` | `staff` | `receptionist` | `receptionist_assistant`. Mục 6 Roles trên cần check đủ 7 roles khi liên quan.
