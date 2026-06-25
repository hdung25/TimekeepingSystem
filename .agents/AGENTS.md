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
