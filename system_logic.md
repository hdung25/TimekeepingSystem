> [!WARNING] LỆNH THỰC THI BẮT BUỘC DÀNH CHO AI CODER
> Bất cứ khi nào bạn được nhắc đến (mention) file này, bạn PHẢI tuân thủ 3 luật sau:
> 1. PHẢN BIỆN (PUSHBACK): Quét code đối chiếu yêu cầu. Nếu thấy mâu thuẫn hoặc thiếu dữ liệu, PHẢI DỪNG LẠI và cảnh báo.
> 2. LẬP PLAN: Nếu khả thi, lập Technical Plan (Chỉ rõ: tạo file nào, sửa dòng nào). TUYỆT ĐỐI KHÔNG CODE khi chưa được Duyệt.
> 3. GHI NHỚ: Cập nhật lại file này (Mục 5 và 6) sau khi code chạy thành công.

==================================================

# 1. TỔNG QUAN & QUY ƯỚC DỰ ÁN
- **Tên App:** Hệ Thống Chấm Công — Trung Tâm Ngoại Ngữ & Toán Tư Duy Trẻ (Version 2.0)
- **Firebase Project:** `timekeeping-69f3f` (Auth Domain: `timekeeping-69f3f.firebaseapp.com`)
- **Tech Stack:** HTML5, CSS3, Vanilla JavaScript (ES6+), Firebase Authentication (Email/Password — Compat SDK), Cloud Firestore, Vercel Hosting, PWA (Service Worker + Manifest)
- **Code Convention:**
  - Multi-Page Application (MPA) — mỗi chức năng là 1 file HTML riêng
  - Client-Side Rendering — không có server truyền thống, dùng Firebase làm BaaS
  - Không dùng framework (100% Vanilla JS)
  - File JS chia theo module chức năng (`db-service.js`, `timekeeping.js`, `report.js`...)
  - Firebase Auth dùng email ảo: `username@tuduytre.com` (trong `auth-helper.js`)
  - 4 Role hệ thống: `admin` | `assistant` | `staff` | `receptionist`
  - Document ID Convention: users → `nv_timestamp`, attendance_logs → `YYYY-MM-DD_userId`, schedules → `YYYY-MM-DD` hoặc `branch__YYYY-MM-DD`
  - App Check: **DISABLED** (commented out trong `firebase-config.js` — cần re-configure reCAPTCHA key)

# 2. CẤU TRÚC THƯ MỤC CHÍNH
- `/` (Root): Các file HTML cho từng trang + cấu hình
  - **Trang Login:** `index.html`
  - **Trang Admin:** `admin.html` (Dashboard + Tabs: Bảo Trì, Thống Kê)
  - **Trang Staff:** `nhan-vien.html` (Bảng Cá Nhân + Charts)
  - **Chức năng:** `cham-cong.html`, `lich-lam.html`, `nhan-su.html`, `bao-cao.html`, `he-thong.html`, `lich-tiep-tan.html`
  - **Public:** `gioi-thieu.html` (trang giới thiệu, không cần login)
  - **Config:** `firebase.json`, `firestore.rules`, `manifest.json`, `service-worker.js`
- `/js`: 19 file JavaScript:
  - `firebase-config.js` — Cấu hình Firebase + App Check (disabled). Init `window.db`, `window.auth`
  - `auth-guard.js` — IIFE bảo vệ trang (check `localStorage`). Public pages: `index.html`, `gioi-thieu.html`. Admin-only pages: `he-thong.html`, `nhan-su.html`, `admin.html`. Non-admin bị redirect → `nhan-vien.html`
  - `auth-helper.js` — Helper tạo/sửa/xóa Firebase Auth user. Dùng Secondary App (`SecondaryApp`) để không ảnh hưởng Admin session
  - `db-service.js` — Tầng trung gian Firestore (~1080 dòng). Quản lý: users, attendance, schedules, settings, alerts, notifications, receptionist schedules
  - `main.js` — Logic chính (~920 dòng): login (`handleLogin`), sidebar (`renderSidebar`), dashboard stats, unregistered alerts (auto-refresh 30s), staff notifications (bell icon), staff personal charts, global check-in/out, mobile nav
  - `timekeeping.js` — Trang Chấm Công: `initTimekeeping`, `renderGlobalCheckIn`, `renderTodayClasses`, `checkAutoCheckout`, `fetchAndRenderHistory`, `registerClass`
  - `schedule.js` — Quản lý Lịch Học: branch tabs (CS1/CS2), week picker, day tabs, CRUD rows, `registerClass`, `saveScheduleManual`, schedule inheritance
  - `personnel.js` — CRUD nhân viên + multi-role salary config (`configureSalary`) + staff color picker
  - `report.js` — Báo cáo & Tính Lương (~890 dòng): calendar grid render, salary calculation UI (với DOM), notes system, admin edit/manual modals, session role selection
  - `evaluation-service.js` — Logic tính toán thuần túy (~250 dòng): `EVALUATION_CRITERIA` (10 tiêu chí), `calculateDailyChips()` (merge schedule + attendance → chips), `removeVietnameseTones()` (tách từ `report.js`)
  - `pdf-export.js` — Xuất PDF bảng lương (~190 dòng): `exportSalaryPDF()` — Custom PDF generation với bảng lương chi tiết (tách từ `report.js`)
  - `receptionist-schedule.js` — Lịch Tiếp Tân: branch tabs, week picker, shift config, cell editor modal
  - `analytics.js` — Thống kê: Punctuality, Late Trend, Staff Comparison, Weekly Hours, Role Distribution, Summary Stats (dùng Chart.js)
  - `chart-service.js` — Data service cho charts: memory cache, batch fetch (`_getAllMonthAttendance`, `_getAllMonthSchedules`), compute functions
  - `ui-service.js` — Toast notification + confirm dialog
  - `ui-animations.js` — Hiệu ứng count-up, stagger, hover
  - `archiver.js` — Scan/Export CSV/Delete dữ liệu cũ (400 docs/batch)
  - `migration-tool.js` — Migration từ localStorage lên Cloud (one-time)
- `/css`: `style.css` (design system chính + responsive + dark mode variables) + `login.css` (trang đăng nhập)
- `/images`: `TUDUYTRE.jpg` (logo trung tâm)
- `/text`: Tài liệu nội bộ (mô tả dự án, accounts, kế hoạch...)

# 3. DATABASE & STATE MANAGEMENT

### Firestore Collections (7 collections — xác nhận từ `firestore.rules`)

1. **`users`** — Thông tin nhân viên
   - Doc ID = `nv_timestamp` (VD: `nv_1707000000000`)
   - Fields: `id`, `username`, `password` (plaintext — có chủ đích để admin reset), `name`, `role` (`admin` | `assistant` | `staff` | `receptionist`), `salary_config` (object: `roles[]` mỗi role có `id`, `name`, `rate`, `color`, `isDefault`), `createdAt`

2. **`user_roles`** — Ánh xạ Auth UID → Role (Firestore Rules dùng để verify quyền server-side)
   - Doc ID = Firebase Auth UID
   - Fields: `role`, `username`, `updatedAt`
   - Security: User tự sync role khi login, NHƯNG không thể tự escalate lên `admin` (Rules v4 block)

3. **`attendance_logs`** — Nhật ký chấm công (multi-session/ngày)
   - Doc ID = `YYYY-MM-DD_userId`
   - Fields: `date`, `userId`, `name`, `checkIn`, `checkOut`, `ip`, `sessions[]` (mỗi session: `id` (timestamp), `start`, `checkIn`, `checkOut`, `type`: `auto` | `manual`), `lastUpdated`
   - Lưu ý: `type: 'manual'` cho session Admin tạo thủ công (KHÔNG phải `admin_add`)

4. **`schedules`** — Lịch học theo ngày (hỗ trợ multi-branch)
   - Doc ID = `YYYY-MM-DD` hoặc `branch__YYYY-MM-DD` (VD: `cs2__2026-02-21`)
   - 6 ca/ngày: `morning1`, `morning2`, `afternoon1`, `afternoon2`, `evening1`, `evening2`
   - Mỗi ca = array chứa: `{ start, end, lop, phong, gv, note, registeredTeachers[] }`
   - `registeredTeachers[]` = `[{ id: userId, name: userName }]`
   - Branch system: `_parseBranchKey(compositeKey)` tách `branch` và `dateKey`. Default branch = `cs1`

5. **`settings`** — Cấu hình hệ thống
   - Doc ID = `system` (KHÔNG phải `main`)
   - Fields: `companyName`, `allowedIP` (comma-separated whitelist)
   - Thêm: `settings/schedule_manifest_${branch}` — Manifest lưu template lịch mẫu cho mỗi branch (dùng cho schedule inheritance)

6. **`unregistered_alerts`** — Cảnh báo nhân viên chấm công mà chưa nhận lớp
   - Doc ID = auto-generated
   - Fields: `userId`, `userName`, `date`, `checkIn`, `resolved`, `resolvedBy`, `resolvedAt`, `createdAt`
   - Logic: Khi staff check-in, `checkAndAlertUnregistered()` kiểm tra nếu user chưa register bất kỳ lớp nào → tạo alert. Admin xem trên Dashboard → bấm "Đã Xử Lý" để resolve

7. **`receptionist_schedules`** — Lịch làm việc riêng cho tiếp tân
   - Doc ID = week identifier
   - Managed by `receptionist-schedule.js`

8. **`admin_notifications`** — Thông báo Admin → Staff
   - Doc ID = auto-generated
   - Fields: `staffId`, `staffName`, `action` (`add_session` | `edit_session` | `delete_session` | `select_role`), `dateKey`, `details`, `adminName`, `read`, `createdAt`
   - Staff nhận thông báo qua floating bell icon (🔔) → popup → "Đã đọc tất cả"

### State (localStorage — Client-side)
- `currentUser` — Username đang đăng nhập
- `currentRole` — Role hiện tại (`admin` | `assistant` | `staff` | `receptionist`)
- `currentUserId` — ID nhân viên (`nv_timestamp`)
- `userFullName` — Tên đầy đủ
- `salary_settings` — JSON lưu bảng lương + evaluation data per staff (report.js)
- `daily_notes` — JSON lưu ghi chú ngày per staff (report.js)

# 4. LUỒNG LOGIC CHÍNH (CORE FLOWS)

### Auth Flow
User nhập username + password → `main.js: handleLogin()` → `DBService.loginUser()` query Firestore `users` WHERE `username == input` → verify password (plaintext compare) → `firebase.auth().signInWithEmailAndPassword(username@tuduytre.com, password)` → Sync role vào `user_roles/{authUID}` → Lưu localStorage (`currentUser`, `currentRole`, `currentUserId`, `userFullName`) → Redirect: `admin` → `admin.html`, tất cả role khác → `nhan-vien.html`.

**Auth Guard** (`auth-guard.js`): IIFE chạy ngay khi load → check `localStorage.currentUser`. Nếu chưa đăng nhập + không phải public page → redirect `index.html`. Nếu non-admin truy cập admin page → alert + redirect `nhan-vien.html`.

**Admin Switch Role**: Admin có nút "Chế độ Nhân viên" trong sidebar → `switchRole()` → toggle `currentRole` giữa `admin` ↔ `staff` → redirect tương ứng.

### Check-in/out Flow (Chấm Công)
Staff mở `cham-cong.html` → `initTimekeeping()` → `renderGlobalCheckIn()` hiện nút VÀO CA/RA CA.

**Vào Ca:** `globalCheckIn()` → `DBService.checkInPersonal(userId, userName)` → Fetch IP từ `api.ipify.org` → Check IP whitelist từ `settings/system` → Firestore Transaction: tạo/update doc `attendance_logs/{date}_{userId}` → push session mới với `checkIn = now.toISOString()`, `type: 'auto'` → Sau đó `checkAndAlertUnregistered()` kiểm tra nếu user chưa nhận lớp nào → tạo `unregistered_alerts`.

**Ra Ca:** `globalCheckOut()` → `DBService.checkOutPersonal(userId)` → Transaction: tìm session cuối chưa có `checkOut` → Set `checkOut = now.toISOString()`.

**Auto Checkout:** `checkAutoCheckout()` (trong `timekeeping.js`) — Kiểm tra nếu class đã kết thúc mà chưa check-out → tự động checkout.

Hỗ trợ multi-session/ngày (sáng/chiều/tối).

### Schedule Flow (Lịch Làm)
Admin/Trợ lý mở `lich-lam.html` → `initSchedule()` → Branch tabs (CS1/CS2) + Week picker + Day tabs.

**Thêm Lớp:** Admin thêm row → `addNewRow()` → Lưu `DBService.saveSchedule(compositeKey, data)` (compositeKey = `branch__YYYY-MM-DD`).

**Nhận Lớp:** Staff bấm "Nhận Lớp" → `registerClass()` → Toggle user trong `registeredTeachers[]`. Nếu schedule chưa tồn tại cho ngày đó → materialize từ template/manifest.

**Schedule Inheritance:** `DBService.getSchedule(dateKey)` → Nếu doc không tồn tại → Tìm `schedule_manifest_{branch}` → Lấy template cho ngày trong tuần tương ứng → Sanitize `registeredTeachers` (xóa hết để bắt đầu fresh) → Trả về schedule kế thừa.

**Holiday Detection:** `getHolidayName(dateStr)` nhận diện ngày nghỉ lễ Việt Nam để hiển thị trên calendar.

### Personnel Flow (Nhân Sự)
Admin mở `nhan-su.html` → CRUD nhân viên:
- **Tạo:** `AuthHelper.createUser()` dùng Secondary Firebase App (`SecondaryApp`) → `firebase.initializeApp(config, 'SecondaryApp')` → `secondaryAuth.createUserWithEmailAndPassword(username@tuduytre.com, password)` → `DBService.saveUser()`. Xử lý zombie account: nếu Firebase Auth trả `email-already-in-use` → `secondaryAuth.signInWithEmailAndPassword()` → lấy UID cũ → xóa Auth account → tạo lại.
- **Multi-Role Salary Config:** `configureSalary()` → modal cho admin set nhiều role/mức lương cho 1 nhân viên. Mỗi role: `{ id, name, rate, color, isDefault }`. Lưu vào `users/{userId}.salary_config.roles[]`.
- **Staff Color Picker:** Mỗi role có `color` property.

### Report & Salary Flow (Báo Cáo & Tính Lương)
Admin mở `bao-cao.html` → `initReport()` → `populateStaffSelect()` → Chọn nhân viên → `renderMonthReport(date)` tạo calendar grid.

**Chip Calculation** (`calculateDailyChips`):
Merge schedule + attendance → Trả về mảng chips, mỗi chip có `text`, `class` (CSS), `paidMinutes`, `tooltip`, `sessionId`, `isClickable`.

Chip CSS Classes:
- `chip-green` = Đã chấm công + Đã chọn Role
- `chip-blue` = Đang dạy (chưa checkout)
- `chip-orange` = Trễ HOẶC Ca Ngoài Lịch HOẶC Quên checkout
- `chip-gray` = Vắng (đã qua giờ + không check-in)
- `chip-waiting` = Chưa chọn Role

**Early Check-in Bonus (C5):** Sớm 9-15 phút → +10 phút thưởng. Sớm >15 phút → không thưởng, hiện warning.

**Chip Sort:** Chips được sort theo thời gian bắt đầu (sáng → tối) — `chips.sort()` dùng regex match thời gian.

**Salary Calculation** (`calculateSalary()`):
- Lọc chips theo role filter (`all` | `giao-vien` | `tiep-tan`)
- Tính tiền: `(minutes / 60) × roleRate` cho mỗi chip
- Cộng Thưởng/Phạt từ Evaluation Table → Tổng lương cuối

**10 Evaluation Criteria** (`EVALUATION_CRITERIA`):
I. Chuyên Cần – Tác Phong | II. Đúng Giờ | III. Tập Trung | IV. Nhiệt Tình | V. Trách Nhiệm | VI. Soạn Bài / Nhận Xét | VII. Chuyên Môn | VIII. Kỹ Năng Sư Phạm | IX. Số Giờ Làm | X. Họp Định Kì. Mỗi criteria có `amount` (thưởng/phạt VND) + `note`.

**Notes System:** Calendar notes (`daily_notes` in localStorage) + Evaluation notes (per criteria).

**Admin Edit:** Click chip → `openEditModal()` sửa giờ vào/ra. Click vắng → `openManualModal()` tạo session mới. Cả hai gửi `admin_notifications` cho staff.

**Session Role Selection:** Click chip → `openRoleSelectModal()` → Admin/Staff chọn vai trò tính lương cho session đó → update `sessionData.role`, `sessionData.roleName`, `sessionData.roleRate`.

**Salary Settings:** Lưu vào `localStorage.salary_settings` (per staff). Bao gồm: `advance` (tạm ứng), `evaluation[]` (10 criteria amounts + notes).

**PDF Export:** `exportSalaryPDF()` — Custom PDF generation với bảng lương chi tiết.

### Analytics Flow (Thống Kê)
Admin → tab "Thống Kê" trên `admin.html` → `analytics.js` render 6 charts:
1. Overall Punctuality (Doughnut)
2. Late Trend (Line)
3. Staff Comparison (Horizontal Bar)
4. Weekly Hours (Bar)
5. Role Distribution (Doughnut)
6. Summary Stats (Cards)

Data layer: `chart-service.js` — Batch fetch attendance + schedules cho 1 tháng → Cache trong memory → Compute functions: `getStaffPunctuality()`, `getWeeklyHours()`, etc.

Staff cũng có personal charts trên `nhan-vien.html`: Punctuality Doughnut + Weekly Hours Bar.

### Receptionist Schedule Flow
Admin/Trợ Lý/Tiếp Tân mở `lich-tiep-tan.html` → Branch tabs → Week picker → Bảng shift config → Cell editor modal. Data lưu `receptionist_schedules/{weekId}`.

**Tích hợp Bảng Công (report.js):** Khi render bảng công cho nhân viên có `role === 'receptionist'`:
1. Tính Monday của mỗi ngày trong tháng → composite key per week
2. Fetch `receptionist_schedules` cho tất cả week overlapping the month (từ cả CS1 & CS2)
3. Kiểm tra `weekData[shift][dayKey]` xem nhân viên có được xếp lịch không
4. Truyền danh sách ca vào `calculateDailyChips()` qua param `receptionistShifts`
5. Chip hiển thị: `SÁNG 07:00–11:30`, `CHIỀU 14:00–18:00`, `TỐI 17:30–21:30`

**Logic chấm công tiếp tân:**
- Sớm/Muộn/Đúng giờ: Giống giáo viên (early bonus 9-15p, late penalty)
- Quên ra ca: Tự động tính đủ giờ theo ca (khác GV: không cần chờ 90p)
- Vào ca không có lịch: Chip cam "Ca Ngoài Lịch" + cảnh báo cho admin
- Auto checkout (`timekeeping.js`): Khi hết giờ ca → tự động ra ca

### Archiver Flow (Bảo Trì)
Admin → Tab "Bảo Trì" trên `admin.html` → `archiver.js` → Scan `attendance_logs` cũ hơn N ngày → Export CSV (BOM UTF-8) → Delete batch (400 docs/batch).

### Notification Flow
**Admin → Staff:** Khi Admin add/edit/delete session hoặc chọn role → `DBService.createAdminNotification()` → Staff thấy floating bell 🔔 → Popup danh sách → "Đã đọc tất cả" → `markAllNotificationsRead()`.

**Unregistered Alerts (Staff → Admin):** Staff check-in mà chưa nhận lớp → tự động tạo `unregistered_alerts` → Admin Dashboard hiện badge + danh sách → "Đã Xử Lý" → `resolveAlert()`. Auto-refresh mỗi 30 giây.

# 5. SIDEBAR NAVIGATION (Theo Role)

| Trang | admin | assistant | staff | receptionist |
|---|---|---|---|---|
| Tổng Quan (`admin.html`) | ✅ | ✅ | ❌ | ❌ |
| Nhân Sự (`nhan-su.html`) | ✅ | ❌ | ❌ | ❌ |
| Bảng Cá Nhân (`nhan-vien.html`) | ❌ | ✅ | ✅ | ✅ |
| Chấm Công (`cham-cong.html`) | ❌ | ✅ | ✅ | ✅ |
| Xếp Lịch / Lịch Làm (`lich-lam.html`) | ✅ (Xếp Lịch) | ✅ (Xếp Lịch) | ✅ (Lịch Làm) | ✅ (Lịch Làm) |
| Lịch Tiếp Tân (`lich-tiep-tan.html`) | ✅ | ✅ | ❌ | ✅ |
| Tính Lương / Bảng Công (`bao-cao.html`) | ✅ (Tính Lương) | ✅ (Bảng Công) | ✅ (Bảng Công) | ✅ (Bảng Công) |
| Hệ Thống (`he-thong.html`) | ✅ | ❌ | ❌ | ❌ |
| Bảo Trì (tab on `admin.html`) | ✅ | ❌ | ❌ | ❌ |
| Thống Kê (tab on `admin.html`) | ✅ | ❌ | ❌ | ❌ |

# 6. FIRESTORE SECURITY RULES (Tóm tắt)
- `user_roles/{authUid}`: Read — own doc only. Write — own doc + cannot escalate to admin (trừ khi đã là admin)
- `users/{userId}`: Read — all authenticated. Write — admin only
- `attendance_logs/{logId}`: Read/Write — all authenticated (cần cho check-in flow)
- `schedules/{dateId}`: Read — all authenticated. Create/Delete — admin/assistant. Update — all authenticated (cần cho "Nhận Lớp")
- `settings/{docId}`: Read — all authenticated. Write — admin only
- `unregistered_alerts/{alertId}`: Read/Delete — admin only. Create/Update — all authenticated
- `admin_notifications/{notifId}`: Read/Write — all authenticated (client-side filter by staffId)
- `receptionist_schedules/{weekId}`: Read — all authenticated. Write — admin/assistant
- **Default Deny:** Mọi path không match → `allow read, write: if false`

# 7. BLOCKERS & NEXT STEPS (Tình trạng hiện tại)
*(AI cần đọc kỹ phần này để biết đang làm dở cái gì)*

- **Blocker (Đang tắc nghẽn):**
  - App Check disabled — cần re-configure reCAPTCHA Enterprise key cho domain Vercel hiện tại
  - `attendance_logs` cho phép tất cả authenticated users write — cần tightening rules nếu muốn chặn staff sửa log người khác

- **Next Step (Việc tiếp theo):**
  - Re-enable App Check với reCAPTCHA key mới
  - Refactor `report.js` (890 dòng — đã tách `pdf-export.js` và `evaluation-service.js`)
  - Xem xét tightening Firestore rules cho `attendance_logs` và `admin_notifications`

# 8. NHẬT KÝ TIẾN ĐỘ & CẬP NHẬT MỚI NHẤT
*(AI sẽ tự động cập nhật vào phần này sau mỗi Task)*

### 07/03/2026 - Tích Hợp Lịch Tiếp Tân Vào Bảng Công & Tính Lương
- **Thay đổi kỹ thuật:**
  - `js/db-service.js`: Thêm `getReceptionistShiftConfig()` helper function
  - `js/evaluation-service.js`: Thêm param `receptionistShifts` vào `calculateDailyChips()` — tạo chip cho ca tiếp tân (sớm/muộn/đúng giờ/vắng/quên ra), flag `isReceptionist` cho salary filter. Fix: prevent double-matching sessions with `usedSessionIds` check.
  - `js/report.js`: `renderMonthReport()` fetch `receptionist_schedules` per-week cho nhân viên receptionist, build `receptionistShiftsMap`, truyền vào `calculateDailyChips()`
  - `js/timekeeping.js`: `checkAutoCheckout()` xử lý auto ra ca cho tiếp tân dựa trên shift end time
- **Rủi ro còn lại:** Cần test thực tế với dữ liệu tiếp tân đã xếp lịch
- **Tiến độ dự án:** [█████████░] 85%

### 22/02/2026 - Tách Evaluation Service ra khỏi report.js
- **Thay đổi kỹ thuật:** Tạo file mới `js/evaluation-service.js` (~250 dòng) chứa `EVALUATION_CRITERIA`, `calculateDailyChips()`, `removeVietnameseTones()`. Xóa các block tương ứng trong `js/report.js` (giảm từ ~1345 → ~890 dòng). Hợp nhất 2 bản `removeVietnameseTones` trùng lặp thành 1. Thêm `<script>` import trong `bao-cao.html` (trước `report.js`).
- **Rủi ro còn lại:** Không — pure cut-paste refactoring, tất cả hàm gắn vào `window` scope
- **Tiến độ dự án:** [████████░░] 75%

### 22/02/2026 - Tách PDF Export ra khỏi report.js
- **Thay đổi kỹ thuật:** Tạo file mới `js/pdf-export.js` chứa hàm `exportSalaryPDF()` (~190 dòng). Xóa block PDF trong `js/report.js` (giảm từ ~1540 → ~1345 dòng). Thêm `<script>` import trong `bao-cao.html`. Không chạm logic tính lương hay render.
- **Rủi ro còn lại:** Không — pure cut-paste refactoring
- **Tiến độ dự án:** [███████░░░] 72%

### 22/02/2026 - Audit & Rewrite system_logic.md
- **Thay đổi kỹ thuật:** Audit toàn bộ source code (17 file JS, HTML, CSS, firestore.rules) → Rewrite hoàn toàn `system_logic.md`. 17+ lỗi sai so với code thực tế đã được sửa (xem danh sách bên dưới)
- **Rủi ro còn lại:** Cần cập nhật file này khi có thay đổi code
- **Tiến độ dự án:** [███████░░░] 70%

### 21/02/2026 - Mobile Responsiveness cho Lịch Tiếp Tân
- **Thay đổi kỹ thuật:** Sửa `css/style.css`, `lich-tiep-tan.html`, `js/receptionist-schedule.js` — responsive cho bảng lịch, header, modal, time inputs trên mobile
- **Rủi ro còn lại:** Cần test thêm trên nhiều thiết bị mobile thực tế
- **Tiến độ dự án:** [██████░░░░] 60%

### 19/02/2026 - Fix Bugs & Polish UI
- **Thay đổi kỹ thuật:** Sửa `js/main.js`, `js/timekeeping.js`, `js/schedule.js`, `js/db-service.js`, `css/style.css` — login error text đỏ, ghi chú icon 📌, popup Ca Ngoài Lịch modal, bỏ fallback tên GV, chip trễ cam, hiện giờ vào ca, fix timezone UTC→local, auth guard tất cả trang, deploy Firestore rules
- **Rủi ro còn lại:** Một số edge case chip màu có thể chưa đúng trên dữ liệu legacy
- **Tiến độ dự án:** [█████░░░░░] 55%
