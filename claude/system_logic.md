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
  - **8 Role hệ thống:** `admin` | `senior_assistant` | `assistant` | `staff` | `teaching_assistant` | `receptionist` | `receptionist_assistant` | `office_staff`
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
├── lich-van-phong.html     ← Lịch Nhân Viên Văn Phòng theo tuần (roster riêng)
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
| `receptionist-schedule.js` | Engine lịch vận hành dùng chung nhưng tách context: Tiếp Tân (`receptionist_schedules`) và Văn Phòng (`office_schedules`); branch tabs, week picker, shift config, cell editor, inheritance. |
| `analytics.js` | Thống kê: 6 chart types (Chart.js), multi-select staff comparison, month navigation. |
| `chart-service.js` | Data service cho charts: memory cache, batch fetch, compute functions. |
| `ui-service.js` | Toast notification + confirm dialog. Override `window.alert` toàn cục. |
| `ui-animations.js` | Count-up animation, stagger rows, card hover. |
| `archiver.js` | Scan/Export CSV/Delete dữ liệu cũ (batch 400 docs). |
| `migration-tool.js` | Migration từ localStorage lên Cloud (one-time tool). |

---

# 4. DATABASE — FIRESTORE COLLECTIONS (13 collections)

### 1. `users` — Thông tin nhân viên
- **Doc ID:** `nv_timestamp` (VD: `nv_1707000000000`)
- **Fields:** `id`, `username`, `password` (plaintext — chủ đích để admin reset), `name`, `role`, `salary_config` (`roles[]`: `{ id, name, rate, color, isDefault }`), `scheduleColor`, `createdAt`
- **Roles hợp lệ:** `admin` | `senior_assistant` | `assistant` | `staff` | `teaching_assistant` | `receptionist` | `receptionist_assistant` | `office_staff`

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
- **Fields:** `companyName`, `allowedIP` (comma-separated whitelist), `receptionistShifts` (global default shifts), `receptionistShifts_cs1/cs2/cs3` (per-branch override), `officeShifts_cs1/cs2/cs3` (ca văn phòng theo cơ sở)
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

### 8.1. `office_schedules` — Lịch nhân viên văn phòng theo tuần
- **Doc ID:** `branch__YYYY-MM-DD` (Monday của tuần), schema giống lịch tiếp tân nhưng roster hoàn toàn tách biệt.
- **Link chấm công:** session khớp lịch dùng `linkedOfficeShift`; không dùng `linkedReceptionistShift`.
- **Quyền:** mọi tài khoản đăng nhập được đọc; chỉ `admin`, `senior_assistant`, `assistant` được ghi.

### 9. `daily_notes` — Ghi chú ngày *(Firestore-synced, đã thay localStorage)*
- **Doc ID:** `staffId`
- **Fields:** `{ "YYYY-MM-DD": "nội dung ghi chú", ... }`

### 10. `salary_settings` — Cài đặt lương *(Firestore-synced, đã thay localStorage)*
- **Doc ID:** `staffId`
- **Fields:** `advance` (tạm ứng), `evaluation[]` (10 criteria amounts + notes)

### 11. `overtime_requests` — Yêu cầu tăng ca
- **Doc ID:** auto-generated
- **Fields:** `staffId`, `staffName`, `dateKey`, `sessionId`, `duration` ("HH:MM"), `minutes`, `status` (`pending`|`approved`|`rejected`), `createdAt`, `approvedBy`, `approvedAt`

### 12. `cancelled_shifts` — Ca bị hủy (tiếp tân / văn phòng)
- **Doc ID:** `YYYY-MM_staffId`
- **Fields:** `userId`, `month`, `shifts[]`; khóa văn phòng bắt buộc có namespace `office_branch_mondayKey_shiftKey_dayKey` để không đụng ca tiếp tân.

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

| Trang | admin | senior_asst | assistant | staff | receptionist | recep_asst | office_staff |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Tổng Quan | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Nhân Sự | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bảng Cá Nhân | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chấm Công | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Xếp/Lịch Làm | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Lịch Tiếp Tân | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Lịch Văn Phòng | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Tính Lương/Bảng Công | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hệ Thống | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bảo Trì / Thống Kê | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

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
office_schedules: Read — auth. Write — admin/senior_assistant/assistant. ✅
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

### 19/03/2026 — Hotfix: Sửa Flow Sớm 10p thành per-chip button
- Ẩn nút `+ Thưởng 10p` (selection mode) trong `bao-cao.html`
- Đổi UI duyệt thưởng sang per-chip button trên mỗi ca (trong `js/report.js`) để nộp đơn trực tiếp mà không cần selection mode

### 19/03/2026 — Fix: Bonus10 re-render + Admin multi-select duyệt
- Xác nhận `_cachedStaffId = null` trước `renderMonthReport` đã có → trang luôn re-fetch data mới sau khi duyệt → +10p cộng vào tổng giờ đúng
- Thêm checkbox cạnh nút `⭐ Duyệt` trên mỗi chip pending — admin tick nhiều chip rồi duyệt 1 lần
- Thêm nút `⭐ Duyệt đã chọn` trong `bao-cao.html`
- Thêm hàm `approveSelectedBonus10()` trong `js/report.js`

### 19/03/2026 — Fix: Bonus10 cho Ca Ngoài Lịch + UX nút Duyệt đã chọn
- Thêm logic bonus10 cho unmatched sessions (ca ngoài lịch) ở function calculateDailyChips
- Nâng cấp UX nút "Duyệt đã chọn" thành luồng 2 bước để rõ ràng hơn khi admin tick nhiều chip

### 19/03/2026 — Redesign Dashboard "Cần Xử Lý"
- Xóa hiển thị cảnh báo nhân viên vào ca chưa nhận lớp trong Dashboard "Cần Xử Lý" (hàm `loadUnregisteredAlerts`).
- Thêm hiển thị các yêu cầu chờ duyệt: Sớm 10p + Tăng ca với badge màu sắc phân biệt và action link.

### 20/03/2026 — Hotfix: isEditor Multi-role & report button logic
- Sửa lại `isEditor` trong `receptionist-schedule.js` để parse đúng `currentRole` mảng JSON thay vì string tĩnh.
- Tương tự trong `report.js`, sửa hiển thị các nút Duyệt Sớm 10p cho quyền `teaching_assistant` thành dùng mảng roles đúng chuẩn `parseRoles()`.
- Bổ sung hàm tiện ích `_cleanupBonus10ForStaff` vào `report.js` cho việc migrate / chuẩn hóa dữ liệu cũ.
- Kiểm tra CSS grid header bảng (`bao-cao.html`) đã đồng bộ `gap` theo như thiết kế.

### 20/03/2026 — Fix: Ẩn nút Sớm 10p trên chip-waiting
- Thay đổi điều kiện render nút Sớm 10p trong `report.js` để ẩn nút trên các ca chưa chọn chức vụ (`chip-waiting`), tránh việc nhân sự click nộp đơn khi ca chưa được tính lương.

### 20/03/2026 — Hotfix: Overtime approve buttons multi-role
- Cập nhật logic render nút duyệt Tăng Ca trong `report.js` (`renderMonthReport`) để sử dụng `isAdminRole` (hỗ trợ JSON multi-role array) thay vì phép so sánh chuỗi giản đơn. Lỗi này từng khiến admin không hiện nút duyệt tăng ca.

### 23/03/2026 — UI Fix: Thay thế native confirm bằng UIService
- **Vấn đề:** Popup duyệt/từ chối tăng ca trong trang báo cáo đang dùng hàm `confirm()` mặc định của trình duyệt, gây mất thẩm mỹ và không nhất quán với UI chung.
- **Fix:** Tìm kiếm và thay thế toàn bộ `confirm()` sang `await UIService.confirm()` bên trong `report.js`.
- **Kết quả:** Trải nghiệm admin được mượt mà hơn với modal custom CSS chuẩn chung của hệ thống.

### 23/03/2026 — Fix: Overtime support cho Unmatched/Admin-created Sessions
- **Vấn đề:** Các ca "Ca Ngoài Lịch" hoặc "Ca Thêm" (phần tử render màu cam/xanh) bị mất tích hợp làm ngoài giờ. Khi admin duyệt báo cáo OT, chip không hiển thị thời gian OT được cộng thêm như Ca Tiếp Tân hay Ca Giáo Viên thông thường.
- **Fix:** Update logic trong `evaluation-service.js` (phần 4. Handle Unmatched Sessions). Tích hợp logic quét ID phiên (`sessionKeyU`) với map OT của nhân viên trong ngày. Cộng giờ (`otMinutesU`) vào thuộc tính trả về `paidMinutes` của UI chip.
- **Kết quả:** Đồng bộ hoá tính năng OT lên 100% các loại hình ca làm việc trong hệ thống kể cả ca thủ công.

### 23/03/2026 — Fix: Từ chối tăng ca tại Dashboard & Chống duplicate
- **Vấn đề 1:** Dashboard chỉ có nút "Xem & Duyệt", admin muốn từ chối thì phải sang trang báo cáo tốn thời gian.
- **Vấn đề 2:** Có hiện tượng duplicate overtime request khi user nhấn nút nộp nhiều lần liên tục hoặc mạng lag.
- **Fix:**
  - `main.js`: Thêm nút "❌ Từ Chối" bên cạnh nút "Xem & Duyệt" ở khu vực hiển thị các cảnh báo tăng ca trên Dashboard. Viết hàm `rejectOvertimeFromDashboard()`.
  - `db-service.js`: Thêm check duplicate vào `createOvertimeRequest`, kiểm tra trùng lặp dựa trên combo (`staffId`, `dateKey`, `sessionId`, `status: pending`).
- **Kết quả:** Xử lý nhanh gọn yêu cầu ngay trang tổng quan và chặn spam/duplicate triệt để ở level DB Client.

### 23/03/2026 — Fix: Auto-refresh Dashboard alerts khi quay lại tab
- **Vấn đề:** Khi admin duyệt yêu cầu từ trang báo cáo và quay lại dashboard bằng cách chuyển tab (vẫn giữ nguyên trang dashboard đang mở), các "Cảnh báo cần xử lý" không tự reload ngay mà phải chờ setInterval 30s.
- **Fix:** Thêm event listener lắng nghe sự kiện `visibilitychange` của document trong `main.js`. Khi tab trở lại trạng thái `'visible'` và đang ở trang admin (có element id `unregistered-alerts-body`), sẽ ngay lập tức fetch lại data.
- **Kết quả:** Đồng bộ trải nghiệm khi duyệt nhiều tab cùng lúc, danh sách "Cần xử lý" luôn là thông tin real-time mỗi khi admin chuyển xem dashboard.

### 23/03/2026 — Fix: Load shiftConfig từ weekData doc để sửa cột giờ (Lần 2)
- **Vấn đề:** 1. Các fix trước chỉ sửa cho nhân viên bên trong `report.js` và `main.js`, nhưng cột label giờ CA (bên trái) khi xem trang `lich-tiep-tan.html` ở các tuần cũ bị dính thành config global ở thời điểm hiện tại.
- **Fix:** Update `loadAndRender()` của `receptionist-schedule.js` để áp dụng snapshot `_shiftConfig` (từ tuần document cũ) trực tiếp vào biến toàn cục `shiftConfig` và render lên UI khi xem tuần trong quá khứ.
- **Kết quả:** Label cột giờ bên trái hoàn toàn cách ly với cập nhật từ tuần khác. Tuần trước giữ ca của tuần trước, tuần mới sẽ fallback dùng ca mặc định branch.

### 23/03/2026 — Fix: Snapshot shiftConfig vào weekData doc
- **Vấn đề:** Các tuần cũ không có field `customStart` cho nhân sự, nên khi render lấy branch global config fallback, dẫn đến sai lệch giờ ca trong giao diện report bảng công nếu system config đổi. Các fix trước chỉ locked được `customStart` từ ngày sửa về sau, không cứu được các records cũ.
- **Fix:** Update logic fallback:
  - Khi lưu lịch tuần: `saveFullWeek()` thêm field `_shiftConfig` snapshot thẳng giờ ca (start/end) lúc đó của 3 ca.
  - Khi render bảng công `report.js` & `main.js` (auto-checkout): ưu tiên fallback về `_shiftConfig` snapshot của tuần đó trước khi lấy global config.
- **Kết quả:** Code bảo đảm logic lịch sử lưu giờ ca tuần đó chính xác hoàn toàn.

### 23/03/2026 — Fix: Snapshot shift times khi lưu lịch tiếp tân
- **Vấn đề:** `saveShiftConfigToFirestore()` ghi đè global config `settings/receptionistShifts_cs*` → các tuần cũ render chip sai giờ khi config thay đổi.
- **Fix:** Trong `saveFullWeek()` (`receptionist-schedule.js`), thêm bước 3b: snapshot `shiftConfig[shift].start/end` vào `customStart/customEnd` của tất cả nhân viên trong các ngày từ hôm nay trở đi — trước khi gọi `saveShiftConfigToFirestore()`.
- **Kết quả:** Tuần quá khứ đã có `customStart` locked từ lần lưu → không bị ảnh hưởng. Tuần hiện tại/tương lai snapshot giờ mới từ UI → giờ mới chỉ apply từ lần lưu này trở đi.

### 27/03/2026 — Fix chấm công tiếp tân
- Auto-checkout: fix multi-role check, 2 ca ngắt quãng độc lập, merge ca tiếp giáp
- Chip tương lai: hiện (ST) thay vì (V) cho ca chưa tới
- Debug log cho match session receptionist
- Popup admin thêm ca: thêm dropdown chọn Role

### 02/04/2026 — Fix: Đánh vắng sai cho buổi học/ca tiếp tân chưa diễn ra
- **Vấn đề:** Hệ thống hiển thị chip **(V) — Vắng** cho các buổi học và ca tiếp tân cố định (CĐ) xảy ra trong **tương lai** (ví dụ: T7 04/04 lúc 7:00 bị đánh vắng ngay từ T5 02/04).
- **Root cause:** `evaluation-service.js` dùng `new Date(\`${dateStr}T${cls.start}\`)` để so sánh với `now`. Cách tạo Date từ chuỗi ISO không có timezone specifier phụ thuộc vào trình duyệt — có thể bị parse theo UTC thay vì giờ địa phương (+07:00), dẫn đến `classDateTime < now` sai khi ca/lớp thực tế vẫn còn trong tương lai.
- **Fix:** Thay toàn bộ logic so sánh timestamp bằng **so sánh chuỗi ngày** (`dateStr > todayStr`) kết hợp so sánh giờ thủ công (`HH:MM`) — đảm bảo không phụ thuộc timezone. Áp dụng cho cả 2 nhánh: CASE B giáo viên (dòng ~244) và CASE B tiếp tân (dòng ~485).
- **File sửa:** `js/evaluation-service.js`

### 02/04/2026 — Fix: Admin chỉnh giờ ra vượt ca không được tính lương đúng
- **Vấn đề:** Khi nhân viên bị auto-checkout sớm (ví dụ 17:00) nhưng thực tế làm đến 18:30, admin chỉnh checkOut lên 18:30 nhưng hệ thống vẫn chỉ tính giờ đến 18:00 (giờ kết thúc ca theo lịch) — 30 phút cuối bị mất.
- **Root cause:** `evaluation-service.js` luôn tính `paidMinutes` dựa vào `schedEnd` (giờ kết thúc ca theo lịch), không dùng `actualEnd` (checkOut thực tế). Không có trường hợp ngoại lệ cho admin.
- **Fix:** Thêm `effectiveEnd = max(actualEnd, schedEnd)` — nếu admin chỉnh checkOut vượt qua lịch thì dùng giờ thực tế. Áp dụng cho cả 3 case (đúng giờ, vào sớm, vào trễ) của cả GV lẫn tiếp tân. Tooltip hiển thị thêm `| Ra muộn Xp (admin đã chỉnh)` để minh bạch.
- **File sửa:** `js/evaluation-service.js`

### 09/04/2026 — Fix chuỗi: timezone, chip tiếp tân, dedup, merge ca cố định
*(Các commit từ `84438b5` → `ad6f9f2` — ghi gộp vì đều là hotfix cùng luồng)*
- **fix(evaluation):** Dùng local time khi build `schedStart`/`schedEnd` — tránh UTC timezone bug
- **fix(main):** `autoCheckoutReceptionist` và `autoCheckoutTeacher` dùng local time thay vì `new Date()` UTC
- **fix(evaluation):** Match ca tiếp tân cố định khi `checkOut` là `null` (nhân viên quên ra ca)
- **fix(db-service):** Thêm cooldown 60s để chặn spam check-in
- **fix(evaluation+report):** Tính lương ca merged/cố định đúng theo rate từng user (không dùng rate chung)
- **fix(evaluation):** Clamp ca tiếp tân đúng cửa sổ lịch (không tính giờ thừa ngoài ca)
- **fix(db-service):** Dedup recent activity theo `userId+date`
- **fix(evaluation):** Chip label tiếp tân hiển thị giờ theo lịch (không phải giờ checkout thực tế) + xóa debug logs
- **Files sửa:** `js/evaluation-service.js`, `js/main.js`, `js/db-service.js`

### 07/08/2026 — Fix GV thứ 2 của lớp + Gửi lương 2 bên riêng + Xuất lương hàng loạt + Redesign Tường Trình

**1. Lớp xếp 2 GV — GV thứ hai không nhận dạng được lớp (nguyên nhân gốc)**
- Trang xếp lịch lưu đủ GV ở `gvList`/`gvThayTeList`, còn `gvId`/`gvThayTheId` **chỉ giữ người đầu tiên** (tương thích ngược — `schedule.js:929`).
- Commit `3bff87f` (31/07) đã chuyển các file JS sang helper chung nhưng **bỏ quên 2 file có script inline**:
  - `cham-bu.html:331` còn so `row.gvId===me` → **GV thứ 2 không thấy ca của mình ở Chấm Công Bù**, phải khai qua "Ca Ngoài Lịch" → Tường Trình hiện "Ngoài lịch / thiếu môn lớp". ĐÂY là lỗi khách báo.
  - `cham-bu.html:333` + `tuong-trinh.html:179` đọc sai tên trường `gvThayTheList` (đúng là **`gvThayTeList`**, trang xếp lịch ghi `fieldType='gvThayTe'` thiếu chữ "h") → GV thay thế thứ 2 bị xử lý sai.
- Sửa: cả 6 chỗ dùng chung `isAssignedToClass` / `isScheduledMainTeacher` / `isScheduledSubstitute` / `hasScheduledSubstitute` (`db-service.js:39-64`).
- Kèm 2 chỗ khác cùng cụm: `chart-service.js:108` (Thống kê đếm thiếu lớp do admin xếp), `timekeeping.js:258` (GV thay thế không thấy lớp ở Chấm Công).
- `shift-oversight.js:199` KHÔNG sửa — có GV thay thế thì lấy người thay là đúng chủ đích.

**2. Modal "Gửi Bảng Lương Hàng Loạt" (`report.js` + `bao-cao.html`)**
- **Lỗi kèm theo đã sửa** `report.js:8809`: vế `(window.unfilteredAllMonthChips||[]).some(...)` trong `isRecep` **không dùng biến `u`** — nó soi chip của người đang mở trên trang, nên chỉ cần đang xem 1 tiếp tân là toàn bộ giáo viên bị đổ sang cột Tiếp Tân. Đã bỏ vế đó, chỉ xét chức danh của chính người đó.
- 3 nút gửi: `submitBulkPublish('teachers' | 'receps' | 'all')`. Ghi cờ theo **bên được tick** (`targets`), không suy từ `currentPublished.role` như bản cũ (người 2 chức danh mà doc lưu `role:'giao-vien'` thì tick cột Tiếp Tân lại ghi cờ bên giáo viên → gửi sai bên).
- Modal **không đóng** sau khi gửi, vẽ lại qua `openBulkPublishModal({keepMessage:true})`.
- Mỗi cột chia 3 khu (`BULK_SECTIONS`): Cần gửi (draft) / Đã xử lý (published|received, bỏ checkbox) / Chưa tính lương.
- Bấm tên → `openStaffPayslipTab()` mở `bao-cao.html?staffId=..&date=YYYY-MM-01&roleView=tiep-tan|giao-vien` ở tab mới. `roleView` được `initReport` đọc (`report.js` ~dòng 145).

**3. Xuất file bảng lương hàng loạt — `js/salary-bulk-export.js` (MỚI)**
- Nút ở tab "Dashboard Nhận Lương & Thống Kê" + 2 select (phạm vi vai trò / trạng thái).
- **Không tính lại lương**: đọc bản chụp `salary_settings_monthly/{YYYY-MM}_{staffId}.published.details_gv|details_tt` và gọi **chính** `renderDetailedSalaryTable()` của `main.js` → file xuất khớp 100% bảng lương nhân viên đã nhận, tự đúng mẫu theo `details.role`.
- Gói thành 1 file `.zip` bằng ZIP writer thuần Vanilla (method STORE + CRC32) — **không thêm thư viện ngoài**. Tránh việc trình duyệt chặn tải hàng loạt file lẻ.
- Tên file: `Bang luong thang {M}-{YYYY} - {Tên} - {tên tài khoản}[ - {Vai trò}].html` (bỏ dấu, lọc ký tự Windows cấm; hậu tố vai trò chỉ thêm khi người đó có cả 2 bên).
- Báo cáo cuối liệt kê rõ ai bị bỏ qua và vì sao — không im lặng cắt bớt.

**4. Siết dữ liệu chấm bù (`db-service.js`)**
- Thêm `missingMakeupFields(r)` — **một định nghĩa duy nhất** về "đủ trường", dùng cho cả lúc nhân viên gửi và lúc quản lý duyệt.
- `createMakeupRequests` **throw** nếu thiếu trường (trước chỉ chặn ở UI).
- `cham-bu.html`: Môn/Lớp phải khớp danh mục Môn Học (gõ sai chính tả → Bảng Công không áp được đơn giá), có gợi ý tên gần đúng.
- Thêm `updateMakeupRequest()` cho quản lý **bổ sung thông tin** đơn cũ (ghi `completedBy`/`completedAt`). Rules hiện tại đã cho admin update — không cần deploy rules.
- `getMakeupRequestsByStatus` nâng trần 200 → 500 và trả `_truncated` để giao diện cảnh báo.

**5. Thiết kế lại trang Tường Trình (`tuong-trinh.html` — viết lại)**
- Bố cục 2 khung: danh sách gọn 1 dòng/yêu cầu + khung chi tiết (máy tính dính theo màn hình; điện thoại là bảng trượt từ dưới).
- **Sắp theo NGÀY CA cần xử lý** (cũ nhất trước), có vạch ngăn theo ngày + nhãn đỏ "tháng trước · sắp chốt lương". Có dropdown đổi thứ tự.
- Bộ lọc 8 chiều + 6 chip lọc nhanh kèm số lượng thật; lưu vào localStorage.
- Thiếu trường bắt buộc → **nút Duyệt bị khoá**, có nút "Bổ sung thông tin" điền ngay tại chỗ.
- Chọn tháng trả lương bằng **radio** (bỏ `prompt` gõ số 1/2/3/4 — chỗ dễ bấm sai nhất về tiền). Hộp Từ chối có 4 lý do bấm nhanh.
- Duyệt/từ chối nhiều mục bằng tick. "Duyệt nhanh" chỉ gom mục thoả **8 điều kiện**: có lịch + khớp đúng 1 dòng lịch + đúng người + chưa có công + không trùng đơn khác + đủ trường + diện tin tưởng + không kèm Sớm 10p/Tăng ca/ghi nhận vắng. Máy **không** tự duyệt sau lưng — vẫn cần quản lý bấm nút và chọn tháng trả.
- Bỏ hết `alert`/`confirm`/`prompt` gốc, dùng `UIService`.

**6. Sửa lỗi TIỀN phát hiện khi test — đoán "lỗi trung tâm" quá rộng**
- Lý do *"Quên mang điện thoại nên không chấm công được"* bị tính là **lỗi trung tâm** → trả tiền ngay trong tháng, trái quy định GĐ 06/08/2026. Nguyên nhân: `CF_THING` có chữ trần `mang` (trùng "mang theo") và `dien` (trùng "điện thoại"), còn `CF_ALONE` coi "không chấm công được" là tự đủ nghĩa — nhưng câu đó là **hệ quả**, đơn nào cũng viết vậy.
- Sửa: mặc định là "nhân viên quên"; chỉ đổi sang "lỗi trung tâm" khi nêu rõ sự cố thiết bị/hạ tầng trung tâm. Tách `CF_NET` cho sự cố mạng/điện và loại trừ "điện thoại". Đã test 20 tình huống thật, đúng cả 20.

**Files:** `cham-bu.html`, `tuong-trinh.html` (viết lại), `bao-cao.html`, `js/report.js`, `js/db-service.js`, `js/chart-service.js`, `js/timekeeping.js`, `js/salary-bulk-export.js` (mới), `service-worker.js`, `js/main.js` (chỉ APP_VERSION).
**Cache-bust:** `?v=20260807-multi-gv-bulk-v1`, `CACHE_NAME=tdt-chamcong-v105-multi-gv-bulk`, `APP_VERSION`, `EXPECTED` trong `bao-cao.html`.

### 07/08/2026 — Bảng lương xem trên điện thoại + ZIP chia thư mục theo vai trò

**Vấn đề:** mở bảng lương trên iPhone (cả trong app lẫn file xuất ra) thì **số tiền bị cắt mất**
("886,333" hiện thành "886,333…"), tiêu đề thẻ xanh xuống dòng thành hình tròn, phải cuộn ngang.
Nguyên nhân: `renderDetailedSalaryTable` là bảng 4 cột + ô "TIÊU CHÍ" `rowspan=10`, bề rộng tối thiểu
vượt 375px; container chỉ `overflow-x:auto` nên người xem phải cuộn mới thấy tiền.

**Cách sửa — sửa ở `renderDetailedSalaryTable` (`js/main.js`), một nguồn duy nhất**, nên cả trang
nhân viên (`nhan-vien.html`) lẫn file ZIP xuất ra đều đẹp:
- Gắn class ngữ nghĩa cho toàn bộ ô: `ps-k` (nhãn) · `ps-v` (tiền) · `ps-note` (ghi chú) ·
  `ps-spine` (ô TIÊU CHÍ rowspan) · `ps-crit` / `ps-critblock` · dòng `ps-row-total` /
  `ps-row-advance` / `ps-row-net`. **Kiểu inline trên từng ô giữ nguyên → bản máy tính không đổi.**
- Thêm `PAYSLIP_CARD_CSS` (hằng số ở đầu file, được nhúng vào chuỗi HTML trả về; thẻ `<style>` chèn
  qua `innerHTML` vẫn có hiệu lực — đã kiểm chứng).
- `tabular-nums` cho mọi số tiền (áp dụng cả máy tính) → cột tiền thẳng hàng.
- `@media (max-width:620px)`: bảng chuyển `display:block`, mỗi `tr` thành grid `1fr auto` — nhãn cột 1,
  tiền cột 2 cùng hàng, ghi chú xuống dòng dưới (dùng `order` vì thứ tự ô gốc là nhãn→ghi chú→tiền,
  để nguyên thì tiền rơi xuống dòng thứ ba). Ô TIÊU CHÍ xoay ngang thành dải tiêu đề nhóm.
  `<br>` trong ô đó đổi thành `<span class="ps-w">` + `::before{content:" "}` để chữ không dính liền.
- Ghi chú trống (chỉ có gạch ngang) bọc trong `NOTE_DASH` = `<span class="ps-dash">` và ẩn cả dòng
  trên điện thoại qua `:has()` trong `@supports selector(:has(*))` — 7 dòng "—" liên tiếp nhìn rối.
  Trình duyệt cũ không hiểu `:has()` thì vẫn hiện như trước, không lỗi.
- Form Tiếp Tân: 2 dòng tiêu chí không có ô nhãn riêng (nhãn nằm chung ô ghi chú) nên đã đổi class
  các ô đó thành `ps-k ps-critblock`, nếu không số tiền hiện **phía trên** nhãn.
- Đầu thẻ xanh: `psc-head` xếp dọc trên điện thoại, `psc-badges` cho `white-space:nowrap` để
  "Đã công bố" không bị bó thành hình tròn.
- Vỏ file xuất (`salary-bulk-export.js`): nền lệch xanh `#F5F8F6`, stack font hệ thống (offline được),
  khối thông tin đổi thành `<dl>` 2 cột (trước xếp dọc cao 167px đẩy bảng lương xuống quá xa → còn 83px),
  thêm `@media print` + hướng dẫn in trên điện thoại.

**ZIP chia thư mục** (`salary-bulk-export.js`): mỗi bên vai trò một thư mục — `Giao Vien/` và
`Tiep Tan/`. Khai thêm entry thư mục (tên kết thúc `/`, 0 byte) để thư mục hiện đúng ở mọi trình
giải nén. Hộp báo cáo cuối ghi rõ số file từng thư mục.

**Đã đo trên 375px:** không tràn ngang, **0 ô tiền bị cắt**, mọi số hiện đủ; bản 1280px kiểm lại vẫn
là bảng 4 cột với nhãn dọc như cũ.
**Cache-bust:** `?v=20260807-payslip-mobile-v1` (main.js + salary-bulk-export.js),
`CACHE_NAME=tdt-chamcong-v106-payslip-mobile`, `APP_VERSION`, `EXPECTED` trong `bao-cao.html`.

### 09/04/2026 — Feat: PDF theo vai trò (Tiếp Tân / Giáo Viên) + Nhắn gửi
- **Tính năng mới:**
  1. **Auto-detect `salary-role-filter`:** Khi admin chọn nhân viên từ dropdown, hệ thống tự đọc `user.roles[]` và set filter: chỉ tiếp tân → `tiep-tan`, chỉ giáo viên → `giao-vien`, đa role → `all` (admin chọn tay).
  2. **Form PDF riêng cho tiếp tân:** Khi filter = `tiep-tan`, xuất PDF theo layout tiếp tân với các dòng: Phí tư vấn, DT Tổng/CS2/CS3, Phát sinh (I+II), Tiêu chí Chuyên Cần + Trách Nhiệm, TỔNG LƯƠNG = baseSalary + extras + bonus.
  3. **Form PDF giáo viên:** Giữ nguyên layout cũ khi filter ≠ `tiep-tan`.
  4. **Shared header/footer:** Tách `sharedStyles`, `sharedHeader`, `sharedFooter` để tái sử dụng cả 2 form.
  5. **Nhắn gửi:** Input `#pdf-message` — nếu có text → hiển thị dòng "Nhắn gửi: ..." trong footer PDF.
  6. **Box nhập liệu tiếp tân:** `#pdf-tieptan-inputs` ẩn mặc định, chỉ hiện khi filter = `tiep-tan`. Gồm: Phí tư vấn, DT Tổng, DT CS2, DT CS3.
  7. **`togglePdfTieptanInputs()`:** Hàm global sync hiển thị box — được gọi từ `onchange` của `salary-role-filter` và từ `selectStaffFromDropdown`.
- **Files sửa:** `js/pdf-export.js` (rewrite), `js/report.js` (thêm auto-detect vào `selectStaffFromDropdown`), `bao-cao.html` (thêm HTML inputs + sửa onchange)

### 22/08/2026 — Role Nhân Viên Văn Phòng + sửa hiển thị giờ ca lẻ
- Thêm role hệ thống `office_staff` và trang riêng `lich-van-phong.html`.
- Tách tuyệt đối roster `office_schedules`, cấu hình `officeShifts_{branch}`, liên kết session
  `linkedOfficeShift`, và namespace hủy ca `office_...`; không migrate hoặc ghi đè lịch tiếp tân.
- Nhân viên văn phòng dùng luồng chấm công, nhắc ca, tự đóng ca, bảng công, chấm bù và tường trình
  giống luồng vận hành tiếp tân; tạm dùng cùng policy lương vận hành cho tới khi có policy riêng.
- Sửa nguyên tắc chip giờ: khi session admin/manual khớp đúng phân công thì hiển thị giờ lịch nhưng
  giữ nguyên timestamp thực tế; nếu không khớp thì tiếp tục hiển thị giờ thực tế kèm cảnh báo rõ ràng,
  không tự sửa dữ liệu lịch sử.
- PWA cache/version: `20260822-office-role-v1`, cache `tdt-chamcong-v134-office-role-20260822`.

### 27/08/2026 — Sửa false-negative vị trí trên máy mới + khôi phục công có kiểm soát
- Xác nhận luồng chấm công thực tế chỉ dùng tọa độ/radius của CS1–CS3; câu IP/Wifi tiếp tục là
  thông báo bắt buộc cho nhân viên. Vai trò và ngày tạo tài khoản không tham gia vào cổng vị trí.
- Bỏ việc tự xin vị trí khi vừa mở `cham-cong.html`. Trình duyệt chỉ xin quyền từ thao tác **VÀO CA**,
  tránh máy mới/PWA chặn hoặc bỏ qua prompt ngoài user gesture.
- Nếu điểm cache/coarse nằm ngoài cả 3 cơ sở, `db-service.js` xóa cache và lấy lại đúng một điểm mới
  với `maximumAge: 0`; vẫn giữ nguyên radius và chỉ cộng sai số tối đa 250m như policy cũ.
- Chuẩn hóa lỗi nội bộ bằng mã (`PERMISSION_DENIED`, `TIMEOUT`, `OUTSIDE_ALLOWED_RADIUS`, ...),
  nhưng UI chỉ nhận đúng câu IP/Wifi, không lưu tọa độ và không lộ GPS.
- `globalCheckIn` có single-flight, không còn race mutation Firestore với timeout giao diện; toast giống
  nhau đang hiện được gộp thành một thẻ để không xếp chồng khi người dùng thử lại.
- Khôi phục công theo lịch bằng CLI atomic, có `migration_backups` và rollback guard:
  Lê Thuý Hằng 24/08 (NV8 18:00–19:30 + NV9 19:30–21:00) và Trần Thị Triệu Vy 26/08
  (BTH 10:30–14:30). Mọi session có `linkedClassStart`, subject role và `dataRepairId`.
- Đã chạy toàn bộ regression suite, browser geolocation fixture và tính chip từ dữ liệu production:
  Hằng 180 phút (chip xanh 18:00–21:00), Triệu Vy 240 phút (chip xanh 10:30–14:30).
- PWA cache/version: `20260827-location-retry-v1`, cache `tdt-chamcong-v135-location-retry-20260827`.

### 27/08/2026 — Siết độ tin cậy cả VÀO CA và RA CA
- Audit production đối chiếu Firestore `users` với Firebase Authentication: 78 hồ sơ gồm 75 nhân viên
  và 3 admin; 75/75 nhân viên có tài khoản đăng nhập hoạt động, không disabled, không thiếu hoặc trùng
  username, và mọi role nhân viên hiện hữu đều đi qua quyền Chấm Công. Ruleset production cho phép mọi
  tài khoản đã xác thực đọc/ghi `attendance_logs`; cấu hình vị trí của CS1–CS3 đều hợp lệ.
- Phát hiện `globalCheckOut` vẫn bọc transaction Firestore trong timeout UI 10 giây. Nếu mạng chậm,
  transaction có thể ghi thành công sau khi UI báo lỗi, làm nhân viên bấm RA CA lại và hiểu sai trạng thái.
- Bỏ timeout không thể hủy ở RA CA, chờ đúng kết quả transaction và thêm single-flight
  `__attendanceCheckOutPending`, đồng bộ với bảo vệ đã có ở VÀO CA. Không thay đổi timestamp, lịch,
  attendance lịch sử hoặc policy GPS.
- Regression suite 19 nhóm, syntax check và browser fixture đều đạt; fixture ghi đúng một phiên vào ca,
  gộp cảnh báo trùng và không có console error.
- PWA cache/version: `20260827-attendance-reliable-v2`, cache
  `tdt-chamcong-v136-attendance-reliable-20260827`.

### 27/08/2026 — Sửa ca BTH của Trần Thị Triệu Vy ngày 22 và 27/08
- Ảnh phản ánh ngày 22/08 hiện ca lẻ. Dữ liệu thật cho thấy attendance đã đúng 10:30–14:30 nhưng
  `linkedClassStart='09:15'`, vì dòng lịch BTH riêng của Vy bị xếp nhầm 09:15–10:45. Dòng BTH
  10:30–14:00 của Nguyễn Thị Ngọc Giàu là một dòng độc lập và không được sửa.
- Sửa atomic có precondition: chỉ đổi dòng `schedules/cs1__2026-08-22 morning2[11]` của Vy thành
  10:30–14:30, đổi liên kết phiên công cũ sang 10:30, và thêm công 27/08 theo dòng lịch BTH
  10:30–14:30 đã tồn tại. Không thay đổi phiên/dòng lịch của người khác.
- Backup Firestore: `migration_backups/trieu-vy-bth-20260822-27-v1`, kèm bản sao local và lệnh
  rollback có safety gate. Verification so sánh với backup xác nhận 12 dòng lịch còn lại và toàn bộ
  thuộc tính phiên công cũ không mất dữ liệu.
- Kết quả tính chip production: 22/08 chip xanh `10:30–14:30 CS1 (BTH) +10p`, 250 phút (giữ nguyên
  thưởng sớm 10p có sẵn); 27/08 chip xanh `10:30–14:30 CS1 (BTH)`, 240 phút.
