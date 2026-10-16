# Xếp lịch linh hoạt + tìm nhân viên trên điện thoại — v245 (16/10/2026)

Baseline: a183878 (production v244). Deploy = push main (Vercel Git integration).

## Bảng Tính Lương: ô tìm nhân viên
Owner (phone screenshot): typing any name showed "Không tìm thấy nhân viên". The search input still held the
currently selected name ("Nguyễn Thị Thanh Nhàn") while the row Trước · mã · ô tìm · Tiếp squeezed it to an
icon-wide box, so typed text was appended to the hidden name and never matched; "Tiếp" was clipped off-screen.
- Opening the search empties the box (current name becomes the placeholder); dismissing restores the name.
- Accent-free matching also handles decomposed (NFD) keyboard input and đ; every typed word must appear in the
  name or code ("duc dai", "nhan 20", "58").
- ≤640px: Trước · mã · Tiếp on one row, full-width search below (16px font, no iOS zoom).

## Lịch làm: sửa / tắt / xóa lớp
Production read-only scan of October (34 schedule docs, 987 rows; scripts/inspect-schedule-*.cjs): no duplicate
or missing shiftIds, and no row whose registration-merged fingerprint differs from the stored row, so v244's
nested-map fix covers the deterministic failures. The remaining friction was policy: any change by another
scheduler (room/time/subject) or any audit/note change made edits, toggles and deletes refuse with "Ca đã được
người khác thay đổi…", and every delete locked the whole table while saving (a second click was dropped).
- A persisted shiftId is the class identity. Room/time/subject edits by someone else no longer block editing
  another field, toggling Bật/Tắt, or deleting that class. Same-field collisions still conflict.
- Delete confirmation always shows the latest server row (incl. room) and states what changed since the table
  was drawn ("phòng: P3 → P9"). During the dialog, only a change to time/room/subject/teachers/closure blocks the
  delete; notes, student counts and audit history do not. Started classes keep the worked-attendance guard.
- Deletes of rows with a shiftId no longer lock the table; row write queues are keyed by shiftId so a delete
  of the next row (now at the same index) is not merged with the previous one.
- Clearer conflict text: the table reloads itself; the user just retries.

No Firestore rules, Cloud Functions, data repair or payroll calculation changes. db-service.js unchanged.

Validation: full `npm test`; schedule-editor-behavior 40 scenarios (new: delete policy, refreshed confirmation,
ID-based edit/toggle, back-to-back deletes); real Chrome `schedule-flex-flow.cjs` (two deletes while the first
saves, note edit + delete after an outside room change) and `schedule-typing-flow.cjs`; real Chrome
`staff-search-mobile-flow.cjs` at 390px touch (layout, empty-on-open, search, pick, restore) + desktop mouse run.
