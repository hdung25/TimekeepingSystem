> [!WARNING] LỆNH THỰC THI BẮT BUỘC DÀNH CHO AI CODER
> Bất cứ khi nào bạn được nhắc đến (mention) file này, bạn PHẢI tuân thủ 3 luật sau:
>
> 1. **PHẢN BIỆN (PUSHBACK):** Quét code đối chiếu yêu cầu. Nếu thấy mâu thuẫn hoặc thiếu dữ liệu, PHẢI DỪNG LẠI và cảnh báo.
> 2. **LẬP PLAN:** Nếu khả thi, lập Technical Plan (Chỉ rõ: tạo file nào, sửa dòng nào). TUYỆT ĐỐI KHÔNG CODE khi chưa được Duyệt.
> 3. **GHI NHỚ:** Cập nhật lại file này (Mục 10) sau khi code chạy thành công.

==================================================

# 1. TỔNG QUAN & QUY ƯỚC DỰ ÁN

- **Tên App:** Hệ Thống Chấm Công — Trung Tâm Ngoại Ngữ & Toán Tư Duy Trẻ (Version 2.0)
- **Firebase Project:** `timekeeping-69f3f` (Auth Domain: `timekeeping-69f3f.firebaseapp.com`)
- **Deploy:** Vercel — https://timekeeping-system-tawny.vercel.app
- **Tech Stack:** HTML5, CSS3, Vanilla JavaScript (ES6+), Firebase Authentication (Email/Password — Compat SDK v10.7.1), Cloud Firestore, Vercel Hosting, PWA (Service Worker + Manifest)
- **Code Convention:**
  - Multi-Page Application (MPA) — mỗi chức năng là 1 file HTML riêng
  - Client-Side Rendering — không có server truyền thống, Firebase là BaaS toàn bộ
  - Không dùng framework (100% Vanilla JS)
  - Firebase Auth dùng email ảo: `username@tuduytre.com` (lowercase)
  - **6 Role hệ thống:** `admin` | `senior_assistant` | `assistant` | `staff` | `receptionist` | `receptionist_assistant`
  - Document ID Convention: `users` → `nv_timestamp`, `attendance_logs` → `YYYY-MM-DD_userId`, `schedules` → `branch__YYYY-MM-DD` hoặc legacy `YYYY-MM-DD`
  - App Check: **DISABLED** (commented out trong `firebase-config.js`)

---

# 2. CẤU TRÚC THƯ MỤC

```
/ (Root)
├── index.html              ← Trang Login (public)
├── admin.html              ← Dashboard Admin (tabs: Tổng Quan, Bảo Trì, Thống Kê)
├── nhan-vien.html          ← Bảng Cá Nhân nhân viên
├── cham-cong.html          ← Chấm Công (vào/ra ca)
├── lich-lam.html           ← Xếp Lịch / Lịch Học
├── nhan-su.html            ← Quản lý Nhân Sự (admin-only)
├── bao-cao.html            ← Báo Cáo / Tính Lương / Bảng Công
├── he-thong.html           ← Cài đặt Hệ Thống (admin-only)
├── lich-tiep-tan.html      ← Lịch Tiếp Tân theo tuần
├── gioi-thieu.html         ← Giới Thiệu (public, không cần login)
├── firebase.json
├── firestore.rules
├── manifest.json
├── service-worker.js
├── system_logic.md         ← File này (source of truth)
├── WORKFLOW.md             ← Quy trình làm việc AI
│
├── /js  (19 file)
│   ├── firebase-config.js
│   ├── auth-guard.js
│   ├── auth-helper.js
│   ├── db-service.js
│   ├── main.js
│   ├── timekeeping.js
│   ├── schedule.js
│   ├── personnel.js
│   ├── report.js
│   ├── evaluation-service.js
│   ├── pdf-export.js
│   ├── receptionist-schedule.js
│   ├── analytics.js
│   ├── chart-service.js
│   ├── ui-service.js
│   ├── ui-animations.js
│   ├── archiver.js
│   └── migration-tool.js
│
├── /css
│   ├── style.css           ← Design system chính + responsive + dark mode
│   └── login.css           ← Trang đăng nhập
│
└── /images
    └── TUDUYTRE.jpg        ← Logo trung tâm
```

---

# 3. MÔ TẢ CHI TIẾT CÁC FILE JS

| File | Mô tả |
|---|---|
| `firebase-config.js` | Init Firebase App, `window.db`, `window.auth`. App Check disabled. |
| `auth-guard.js` | IIFE bảo vệ trang. Public: `index.html`, `gioi-thieu.html`. Admin-only: `he-thong.html`, `nhan-su.html`, `admin.html`. Cả `admin` lẫn `senior_assistant` được vào admin pages. |
| `auth-helper.js` | Helper tạo/sync/xóa Firebase Auth user. Dùng Secondary App (`SecondaryApp`). Có fallback password `123456`. |
| `db-service.js` | Tầng trung gian Firestore toàn bộ (~1764 dòng). Xem Mục 4 & 6. |
| `main.js` | Login (`handleLogin`), sidebar (`renderSidebar`), dashboard stats, unregistered alerts + overtime requests (auto-refresh 30s), staff bell notifications (🔔), staff personal charts, global auto-checkout (interval 60s). |
| `timekeeping.js` | Trang Chấm Công: `initTimekeeping`, `renderGlobalCheckIn`, `renderTodayClasses`, `checkAutoCheckout`, `fetchAndRenderHistory`, `registerClass`. |
| `schedule.js` | Quản lý Lịch Học: branch tabs CS1/CS2/CS3, week picker, day tabs, CRUD rows, `registerClass`, `saveScheduleManual`, schedule inheritance. |
| `personnel.js` | CRUD nhân viên + multi-role salary config (`configureSalary`) + staff color picker (`scheduleColor`). |
| `report.js` | Báo cáo & Tính Lương (~890 dòng): calendar grid, salary calculation UI, notes system (Firestore-synced), admin edit/manual modals, session role selection, overtime approval UI. |
| `evaluation-service.js` | Logic tính toán thuần (~250 dòng): `EVALUATION_CRITERIA` (10 tiêu chí), `calculateDailyChips()`, `removeVietnameseTones()`. |
| `pdf-export.js` | `exportSalaryPDF()` — custom PDF bảng lương chi tiết (~190 dòng). |
| `receptionist-schedule.js` | Lịch Tiếp Tân: branch tabs CS1/CS2/CS3, week picker, shift config, cell editor modal, `clearCurrentWeek()`, `toggleScheduleFixedShiftMode()`, inheritance banner. |
| `analytics.js` | Thống kê: 6 chart types (Chart.js), multi-select staff comparison, month navigation. |
| `chart-service.js` | Data service cho charts: memory cache, batch fetch, compute functions. |
| `ui-service.js` | Toast notification + confirm dialog. Override `window.alert` toàn cục. |
| `ui-animations.js` | Count-up animation, stagger rows, card hover. |
| `archiver.js` | Scan/Export CSV/Delete dữ liệu cũ (batch 400 docs). |
| `migration-tool.js` | Migration từ localStorage lên Cloud (one-time tool). |

---

# 4. DATABASE — FIRESTORE COLLECTIONS (12 collections)

### 1. `users` — Thông tin nhân viên
- **Doc ID:** `nv_timestamp` (VD: `nv_1707000000000`)
- **Fields:** `id`, `username`, `password` (plaintext — chủ đích để admin reset), `name`, `role`, `salary_config` (`roles[]`: `{ id, name, rate, color, isDefault }`), `scheduleColor`, `createdAt`
- **Roles hợp lệ:** `admin` | `senior_assistant` | `assistant` | `staff` | `receptionist` | `receptionist_assistant`

### 2. `user_roles` — Ánh xạ Auth UID → Role (dùng cho Firestore Rules)
- **Doc ID:** Firebase Auth UID
- **Fields:** `role`, `username`, `updatedAt`, `updatedByAdmin`
- Được sync tự động khi login và khi admin thay đổi role nhân viên

### 3. `attendance_logs` — Nhật ký chấm công
- **Doc ID:** `YYYY-MM-DD_userId`
- **Fields:** `date`, `userId`, `name`, `checkIn`, `checkOut`, `sessions[]`, `lastUpdated`
- **Session object:** `{ id (timestamp), start, checkIn, checkOut, type ('auto'|'manual'|'admin_add'), role, roleName, roleRate, bonus10 (bool), autoClosedReason }`
- `autoCloseStaleSession()` tự đóng session cũ lúc `23:59` khi render báo cáo (fire-and-forget)

### 4. `schedules` — Lịch học theo ngày (multi-branch)
- **Doc ID:** `branch__YYYY-MM-DD` hoặc legacy `YYYY-MM-DD` (cs1)
- **6 ca/ngày:** `morning1`, `morning2`, `afternoon1`, `afternoon2`, `evening1`, `evening2`
- **Mỗi ca:** array `[{ start, end, lop, phong, gv, note, registeredTeachers[], _branch }]`
- **`registeredTeachers[]`:** `[{ id, name, timestamp, branch }]`

### 5. `settings` — Cấu hình hệ thống
- **Doc ID:** `system`
- **Fields:** `companyName`, `allowedIP` (comma-separated whitelist), `receptionistShifts` (global default shifts), `receptionistShifts_cs1/cs2/cs3` (per-branch override)
- **Các doc phụ (trong cùng collection):** `schedule_manifest_cs1`, `schedule_manifest_cs2`, `schedule_manifest_cs3`, legacy `schedule_manifest`

### 6. `unregistered_alerts` — Cảnh báo check-in không có lớp
- **Doc ID:** `YYYY-MM-DD_userId` (overwrite an toàn bằng `set()`)
- **Fields:** `userId`, `userName`, `date`, `checkIn`, `resolved`, `resolvedBy`, `resolvedAt`, `createdAt`

### 7. `admin_notifications` — Thông báo Admin → Staff
- **Doc ID:** auto-generated
- **Fields:** `staffId`, `staffName`, `action` (`add_session`|`edit_session`|`delete_session`|`select_role`), `dateKey`, `details`, `adminName`, `read`, `readAt`, `createdAt`

### 8. `receptionist_schedules` — Lịch tiếp tân theo tuần
- **Doc ID:** `branch__YYYY-MM-DD` (Monday của tuần)
- **Structure:** `{ morning: { mon: [{id, name, color, customStart?, customEnd?, isFixedShift?}], ... }, afternoon: {...}, evening: {...}, _notes: { "morning_mon": "..." } }`

### 9. `daily_notes` — Ghi chú ngày *(Firestore-synced, đã thay localStorage)*
- **Doc ID:** `staffId`
- **Fields:** `{ "YYYY-MM-DD": "nội dung ghi chú", ... }`

### 10. `salary_settings` — Cài đặt lương *(Firestore-synced, đã thay localStorage)*
- **Doc ID:** `staffId`
- **Fields:** `advance` (tạm ứng), `evaluation[]` (10 criteria amounts + notes)

### 11. `overtime_requests` — Yêu cầu tăng ca
- **Doc ID:** auto-generated
- **Fields:** `staffId`, `staffName`, `dateKey`, `sessionId`, `duration` ("HH:MM"), `minutes`, `status` (`pending`|`approved`|`rejected`), `createdAt`, `approvedBy`, `approvedAt`

### 12. `cancelled_shifts` — Ca bị hủy (receptionist)
- **Doc ID:** `YYYY-MM_staffId`
- **Fields:** `userId`, `month`, `shifts[]` (array shiftKey: `branch_mondayKey_shiftKey_dayKey`)

> **⚠️ Dead code:** `fixed_shifts` collection có CRUD trong `db-service.js` nhưng chưa được gọi từ bất kỳ UI nào.

---

# 5. STATE MANAGEMENT

### localStorage (session hiện tại)
| Key | Giá trị |
|---|---|
| `currentUser` | Username |
| `currentRole` | Role (`admin`\|`senior_assistant`\|...) |
| `currentUserId` | `nv_timestamp` |
| `userFullName` | Tên đầy đủ |

> `salary_settings` và `daily_notes` **đã migrate lên Firestore** — không còn trong localStorage.

---

# 6. CÁC HÀM QUAN TRỌNG TRONG DB-SERVICE.JS

| Hàm | Mô tả |
|---|---|
| `loginUser(username, password)` | Auth + fetch user profile + sync user_roles |
| `getUsers()` | Lấy tất cả users, tự động generate shortName không trùng |
| `saveUser(user)` | Tạo/cập nhật user, sync user_roles nếu role thay đổi |
| `getSchedule(compositeKey)` | Lấy lịch, fallback sang inheritance nếu không có |
| `saveSchedule(compositeKey, data)` | Lưu lịch + cập nhật manifest |
| `registerClass(compositeKey, caType, rowMeta, user)` | Toggle nhận/bỏ lớp (Transaction) |
| `checkInPersonal(userId, userFullName)` | Check IP → Transaction tạo session mới |
| `checkOutPersonal(userId)` | Transaction đóng session hiện tại |
| `addManualSession(userId, dateKey, checkIn, checkOut)` | Admin thêm session thủ công |
| `addSession(userId, dateKey, sessionData)` | Admin thêm session (generic, type: admin_add) |
| `updateSession(userId, dateKey, sessionId, newData)` | Sửa giờ session |
| `deleteSession(userId, dateKey, sessionId)` | Xóa session |
| `updateSessionRole(userId, dateKey, sessionId, roleData)` | Chọn role cho session |
| `toggleSessionBonus10(userId, dateKey, sessionId)` | Toggle +10p thưởng thủ công |
| `autoCloseStaleSession(userId, dateKey, sessionId)` | Đóng session cũ lúc 23:59 |
| `getReceptionistSchedule(compositeKey)` | Lấy lịch tiếp tân tuần |
| `saveReceptionistSchedule(compositeKey, data)` | Lưu lịch tiếp tân tuần |
| `unassignReceptionist(compositeKey, shift, day, staffId)` | Bỏ xếp tiếp tân khỏi ca |
| `getReceptionistShiftConfig(branch)` | Lấy cấu hình giờ ca theo branch |
| `getDailyNotes(staffId)` | Lấy ghi chú ngày từ Firestore |
| `saveDailyNotes(staffId, notesObj)` | Lưu ghi chú ngày lên Firestore |
| `createOvertimeRequest(...)` | Tạo yêu cầu tăng ca |
| `getPendingOvertimeRequests()` | Admin lấy danh sách yêu cầu pending |
| `approveOvertimeRequest(requestId, adminName)` | Admin duyệt |
| `rejectOvertimeRequest(requestId, adminName)` | Admin từ chối |
| `cancelShift(monthStr, staffId, shiftKey)` | Admin hủy ca tiếp tân cụ thể |
| `getCancelledShifts(monthStr, staffId)` | Lấy danh sách ca đã hủy |

---

# 7. LUỒNG LOGIC CHÍNH (CORE FLOWS)

### Auth Flow
```
handleLogin() → DBService.loginUser()
→ firebase.auth().signInWithEmailAndPassword(username@tuduytre.com, password)
→ Query users WHERE username == input
→ Sync role → user_roles/{authUID}
→ localStorage: currentUser, currentRole, currentUserId, userFullName
→ Redirect: admin|senior_assistant → admin.html | others → nhan-vien.html
```

### Check-in/out Flow
```
VÀO CA: checkInPersonal()
→ Fetch IP → check whitelist settings/system.allowedIP
→ Transaction: push session { id: Date.now(), checkIn: now.toISOString(), type: 'auto' }
→ checkAndAlertUnregistered() → nếu chưa nhận lớp → tạo unregistered_alerts

RA CA: checkOutPersonal()
→ Transaction: tìm session không có checkOut → set checkOut = now.toISOString()

AUTO-CHECKOUT (global, mọi trang):
→ globalCheckAutoCheckout() — interval 60s sau 5s delay
```

### Schedule Inheritance
```
getSchedule(compositeKey)
→ Nếu doc tồn tại → trả về
→ Nếu không → tìm schedule_manifest_{branch}
→ Lấy pastDates cùng dayOfWeek → sort desc → lấy gần nhất
→ Sanitize registeredTeachers = [] → trả về template
```

### Chip Calculation (calculateDailyChips)
```
Input: dateStr, attendanceSessions, scheduleClasses (tất cả branch), receptionistShifts, cancelledShifts, overtimeMap

Xử lý từng lớp trong schedule:
→ Tìm session khớp (±60p trước giờ bắt đầu)
→ Tính paidMinutes: sớm/đúng/trễ/vắng/quên ra
→ Tạo chip với class CSS tương ứng
→ usedSessionIds để tránh double-count

Xử lý receptionist shifts:
→ Logic tương tự nhưng dùng shift config (start/end từ settings)
→ Quên ra ca → tính đủ giờ theo ca (khác GV: không cần chờ 90p)

Unmatched sessions → chip-orange "Ca Ngoài Lịch" hoặc "Ca Thêm"

Sort chips theo thời gian bắt đầu (regex match HH:MM)
```

**Chip CSS Classes:**
- `chip-green` = Checkout + Đã chọn Role
- `chip-blue` = Đang làm (chưa checkout)
- `chip-orange` = Trễ | Ca Ngoài Lịch | Quên ra ca
- `chip-gray` = Vắng
- `chip-waiting` = Chưa chọn Role
- `chip-future` = Ca tiếp tân sắp tới

### Overtime Flow
```
Staff: click chip → "Yêu cầu tăng ca" → createOvertimeRequest()
Admin dashboard: badge "⏱️ TĂNG CA" → link "Xem & Duyệt" → bao-cao.html?staffId=...
Chip hiển thị: ⏱️? (pending) | ⏱️+Xh (approved)
```

---

# 8. SIDEBAR NAVIGATION (Theo Role)

| Trang | admin | senior_asst | assistant | staff | receptionist | recep_asst |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Tổng Quan | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Nhân Sự | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bảng Cá Nhân | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Chấm Công | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Xếp/Lịch Làm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lịch Tiếp Tân | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Tính Lương/Bảng Công | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hệ Thống | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bảo Trì / Thống Kê | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

# 9. FIRESTORE SECURITY RULES (Trạng thái thực tế)

```
user_roles     : Read — auth. Write — own doc only, không tự escalate admin. ✅
users          : Read, Write — auth. ⚠️ LỎNG: staff sửa được user khác.
attendance_logs: Read, Write — auth. ⚠️ LỎNG: staff sửa được log người khác.
schedules      : Read — auth. Create/Delete — admin/assistant. Update — auth (cần cho nhận lớp).
settings       : Read — auth. Write — auth. ⚠️ LỎNG: tất cả user write được settings.
unregistered_alerts: Read/Delete — admin. Create/Update — auth. ✅
admin_notifications: Read, Write — auth.
receptionist_schedules: Read — auth. Write — auth. ⚠️ LỎNG.
daily_notes    : Read, Write — auth.
salary_settings: Read — auth. Write — admin only. ✅
overtime_requests: Read/Create — auth. Update/Delete — admin. ✅
(Default)      : Deny all. ✅
```

**Cần tightening (Next Steps):**
- `users.write` → chỉ admin/senior_assistant
- `settings.write` → chỉ admin/senior_assistant
- `receptionist_schedules.write` → chỉ admin/senior_assistant/assistant
- `attendance_logs.write` → staff chỉ được write doc của chính mình

---

# 10. KNOWN ISSUES & LƯU Ý KỸ THUẬT

1. **App Check disabled** — cần re-configure reCAPTCHA Enterprise key cho Vercel domain
2. **admin.html sidebar hardcode** — sidebar HTML tĩnh, không dùng `renderSidebar()`. Nếu thêm menu item phải sửa cả `main.js` lẫn `admin.html`
3. **auth-guard load order bất nhất** — `lich-tiep-tan.html` load `auth-guard.js` SAU `main.js`, ngược với các trang khác
4. **DBService.refs.attendance dead code** — định nghĩa `db.collection('attendance')` nhưng code thực tế luôn dùng `db.collection('attendance_logs')` trực tiếp
5. **fixed_shifts collection** — có CRUD trong db-service.js nhưng chưa được gọi từ UI (feature tương lai)
6. **Timezone inconsistency** — `getLocalDateKeyFromDate()` dùng nhất quán ở check-in/out, nhưng `getDashboardStats()` dùng cách tính khác. Nên chuẩn hóa

---

# 11. NHẬT KÝ TIẾN ĐỘ

*(AI cập nhật vào đây sau mỗi Task thành công)*

### 18/03/2026 — Audit & Rewrite Toàn Bộ system_logic.md
- **Thực hiện:** Claude Sonnet 4.6 — audit từ dump 11,455 dòng source code thực tế
- **Các sai lệch đã sửa so với phiên bản cũ:**
  - Roles: 4 → 6 (`senior_assistant`, `receptionist_assistant`)
  - Collections: 7 → 12 (`daily_notes`, `salary_settings`, `overtime_requests`, `cancelled_shifts`, dead code `fixed_shifts`)
  - `daily_notes` + `salary_settings` đã migrate từ localStorage lên Firestore
  - Overtime requests flow (tính năng mới hoàn toàn)
  - `autoCloseStaleSession()` (tính năng mới)
  - `isFixedShift` flag + `toggleScheduleFixedShiftMode()`
  - `cancelled_shifts` collection + flow hủy ca
  - `bonus10` manual toggle
  - Firestore Rules thực tế lỏng hơn doc cũ (đã ghi chú)
  - admin.html sidebar hardcode
  - auth-guard load order bất nhất trong lich-tiep-tan.html
- **Tiến độ dự án:** [██████████] ~90%

### 18/03/2026 — Fix merge ca tiếp tân tiếp giáp
- **Thực hiện:** sửa `evaluation-service.js` (thêm mergeAdjacentShifts) và `main.js` (autoCheckoutReceptionist extend shift end thay vì lấy earliest)

### 19/03/2026 — Thêm Bonus 10p Theo Yêu Cầu
- Thêm role `teaching_assistant` (display: "Trợ giảng/ GV TA") — sidebar giống staff
- Xóa logic tự động thưởng 10p khi đi sớm trong `evaluation-service.js`
- Thêm collection `bonus10_requests` với CRUD đầy đủ trong `db-service.js`
- Thêm Firestore rule cho `bonus10_requests`
- UI nút "⭐ Sớm 10p" trên chip trong `report.js` — staff submit, admin duyệt đơn lẻ hoặc duyệt tất cả
- Cập nhật `calculateDailyChips()` nhận `bonus10Map` param mới
- Tiến độ: [██████████] ~93%

### 19/03/2026 — Multi-role cho nhân viên
- users.roles (array) thay thế users.role (string) — backward compat giữ cả 2 field
- parseRoles() helper toàn cục trong main.js và auth-guard.js
- Sidebar gộp menu của tất cả roles
- Modal nhân sự: dropdown → checkboxes multi-select
- primaryRole = role ưu tiên cao nhất (dùng cho compat)

### 19/03/2026 — Searchable staff dropdown in bao-cao
- Replace separate input & select in `bao-cao.html` with a custom searchable dropdown wrapped logic in `staff-search-wrapper`.
- Update `populateStaffSelect` in `js/report.js` to render both `staff-dropdown-list` and the backward-compatible hidden `<select>`.
- Add global functions logic to toggle visibility and handle internal selection filter of custom dropdown `selectStaffFromDropdown()`.

### 19/03/2026 — Hotfix: remove switchRole + fix staff dropdown + fix bonus10 btn
- Xóa `switchRole()` và nút "Chế độ Trợ giảng" khỏi sidebar (`main.js`)
- Fix `populateStaffSelect()` dùng `parseRoles()` thay vì `JSON.parse` trực tiếp — admin giờ thấy dropdown nhân viên đúng
- Fix `btn-approve-all-bonus10` dùng `parseRoles` để check viewer role
