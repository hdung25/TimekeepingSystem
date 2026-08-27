# Project Rules & Technical Specifications for Timekeeping System

> [!IMPORTANT]
> This workspace is a live production system. Any regression will immediately disrupt active employees and administrators. You must double-check syntax, follow exact deployment workflows, and respect the core system logic detailed below.

---

## 1. Core Logic & Crucial Rules

### 1.1. The GPS Location Secret (GPS vs. Wifi IP check)
* **Under the Hood:** The check-in system checks the user's precise **GPS coordinates** (lat, lng, and radius) configured in settings for each campus.
* **Staff-Facing Persona:** Staff members and managers are told that the system checks the **Office Wifi IP network**.
* **CRITICAL RULE:** All error messages shown to the user when GPS permission is denied or coordinates are outside the radius must strictly say: **`"IP Mạng không hợp lệ! Vui lòng kết nối đúng Wifi của cơ sở để chấm công."`**.
* **NEVER** mention "GPS", "Location", "Quyền vị trí", or "Định vị" in user-facing alert messages. Keep this secret strictly between developers and the Admin.
* **Acquisition invariant:** Do not request the attendance position automatically on page load. Request it only from the user's explicit **VÀO CA** gesture so a new phone/browser can show its permission prompt reliably.
* **Fresh-fix invariant:** If a cached/coarse browser position falls outside every configured campus, clear the in-memory value and retry exactly once with `maximumAge: 0` before refusing check-in. The retry must not widen the configured campus radius or bypass the location gate.
* **Mutation invariant:** Do not wrap `checkInPersonal()` or `checkOutPersonal()` in a UI `Promise.race` timeout. A Firestore write cannot be cancelled; reporting a timeout while the write later succeeds creates a phantom failure and duplicate retries. Guard both actions with a single-flight flag so repeated taps cannot start concurrent attendance transactions.

### 1.2. PWA Caching & Forced Updates
* The application runs as a Progressive Web App (PWA) with a Service Worker caching assets aggressively.
* **How to update scripts:** If you edit any critical script (like `js/db-service.js`), you **must**:
  1. Bump the query parameter version in `cham-cong.html` (e.g., `js/db-service.js?v=YYYYMMDD-description`).
  2. Update the cache version name (`CACHE_NAME`) in `service-worker.js`.
  3. Update the matching asset string inside the `STATIC_ASSETS` array of `service-worker.js`.
  * Failure to do this will cause browsers and mobile PWA icons to run stale cached code, making your deployment invisible to users.

### 1.3. Prevent Firestore Read/Write Loops
* The Firestore database has reading quota limits. Avoid any polling, recursive functions, or multiple triggers in `onSnapshot` that could cause infinite loops of reads and exhaust the Firestore free/paid quotas.
* Always query using cache indicators where possible (like `_cachedStaffId` or `localStorage` caches).

### 1.4. Missing Checkout Handling
* For matched scheduled shifts (teaching or receptionist) where check-out is missing on a past day, the system automatically checks out at the scheduled end time and calculates shift duration based on the schedule.
* For unmatched sessions (outside schedule) where check-out is missing on a past day, the system sets duration to **0 hours**, sets the chip color to **orange** (warning), and displays the label as **`[start]–???`** so it stands out to administrators.

---

## 2. Chip & Shift Matching Specifications

### 2.1. Unmatched Sessions & Purple "Role?" Chips
* Manual sessions added by Admin must contain `linkedClassStart` (for class teaching shifts) or `linkedReceptionistShift` (for receptionist shifts).
* If a session has no role selected (`role` is empty), it shows as a purple **`(Role?)`** chip.
* **Auto-Assignment:** In `calculateDailyChips`, if a session has no role:
  * Auto-assign to `'tiep-tan'` if the user is a pure receptionist or if the session has `linkedReceptionistShift`.
  * Auto-assign to the matching subject role if `linkedClassStart` matches a scheduled class.
  * Fallback to the user's single configured teaching role if they only have one.

### 2.2. Hiding Grey Receptionist Chips on VĐX
* **VĐX (Vắng đã xác nhận)** is a red chip indicating a teacher reported absent and a substitute teacher took over.
* If a teacher has a receptionist shift on the same day overlapping with a VĐX teaching shift, **hide the grey receptionist absent chip** to avoid UI clutter.

---

## 3. Code Quality & Deployment Workflow

### 3.1. Syntax Integrity
* Always write clean, syntactically correct JavaScript and HTML. Double-check for missing commas, brackets, parentheses, or semicolons before committing.
* Never leave placeholder comments or raw code chunks that break existing functions.

### 3.2. Deploy Commands
* Push code to remote main branch using `git push origin main`.
* Trigger direct production deployment on Vercel using `npx vercel --prod --yes`.

### 3.3. Interactive Authentication & Project Selection
* If Vercel, Git, Firebase, or another deployment tool asks for a login, password,
  token, two-factor code, team, project, or scope, run the command in an interactive
  terminal and pause so the user can choose or enter it.
* Never guess a password, reuse an unverified saved credential, inspect or print
  secrets from `.env` files, or silently create a new project when the intended
  project is not accessible.
* Before continuing after authentication, verify the selected account/team and the
  exact production project and alias. A deployment to a different team or project
  is not an acceptable substitute for the intended production deployment.

### 3.4. Production Alias Safety Gate
* Before uploading, confirm all three exact targets: scope/team
  `ha-huy-dungs-projects`, project `timekeeping-system`, and alias
  `https://timekeeping-system-tawny.vercel.app` (or the explicitly approved target).
* If Vercel reports `missing_scope`, inaccessible project, wrong account, or missing
  permission, STOP. Open an interactive terminal and ask the user to switch account,
  select the correct team, or grant access. Do not fall back to the personal scope.
* Never create, link, or deploy to a new project as a workaround. Never use a
  generated `*.vercel.app` URL as proof that the requested production deployment
  succeeded unless the requested alias was also updated.
* After deployment, verify the exact requested alias with an HTTP request and verify
  the deployment target is `production`. Only then report the deployment as done;
  otherwise report the exact blocker and wait for the user's direction.

### 3.5 Payroll & Attendance Integrity Gate
* Never make opening a report silently rewrite attendance, salary rates, links between
  a session and its scheduled shift, or a published payslip. Any necessary automatic
  classification must be explicit, auditable, and reversible.
* A manual time edit must preserve the existing class/receptionist link unless the
  editor explicitly chooses a replacement or chooses to clear the link.
* New payroll automation must default to `legacy` mode. It may run only as a
  comparison/draft until an administrator approves the result; it must never publish
  a payslip, change a historical rate, or alter an already locked month on its own.
* Before a migration, bulk data change, or activation of automatic payroll, verify a
  recoverable backup path, keep source snapshots/audit history, and run regression
  tests for monthly report, edited sessions, early-10 policy, and payout month.

### 3.6 Cross-Flow Impact Analysis & Reversible Operations (Rule HD)
* Never treat the screen or prompt where a problem is reported as the full scope of
  the fix. Trace the complete state flow: every writer, Firestore representation,
  cache, derived calculation, permission rule, and every page that reads or mutates
  that state (including schedule, attendance, reports, payroll, and oversight).
* Before declaring a change complete, verify both the forward path and the correction
  path on all affected pages. An administrator must be able to reverse operational
  states such as absent/cancelled/replaced without deleting unrelated attendance,
  notes, salary data, or assignments.
* Model intermediate real-world states explicitly instead of inferring them from a
  later step. Example: "teacher reported absent; replacement not found yet" is a
  first-class per-shift state and must not require assigning a substitute first.
* Preserve backward compatibility for existing Firestore documents, but make the new
  explicit state the source of truth once present. Add regression tests for legacy
  data, the new state, restoration, and downstream display/calculation behavior.

#### Office staff schedule and attendance invariant
* `office_staff` is a distinct employment role. Its roster lives only in
  `office_schedules`, is edited from `lich-van-phong.html`, and uses per-branch
  `officeShifts_{branch}` settings. Never migrate, merge, overwrite, or delete the
  corresponding `receptionist_schedules` roster while changing an office schedule.
* Office staff clock in and out through the normal attendance flow. A matched office
  session uses `linkedOfficeShift`; manual edits must preserve that link unless the
  editor explicitly replaces or clears it. Until a dedicated office pay policy is
  approved, office hours use the existing operational/receptionist pay bucket while
  all user-facing labels remain "Văn Phòng".
* Cancellation document keys for office shifts must be namespaced as
  `office_{branch}_{monday}_{shift}_{day}` so a cancelled office shift cannot cancel
  the receptionist shift in the same branch/time slot.
* A time chip may display scheduled hours only when the employee has one valid,
  uniquely matched assignment. Otherwise retain the actual check-in/check-out values,
  show an unmatched warning, and require an explicit roster/link correction. Never
  rewrite historical attendance merely to make the display agree with a schedule.
