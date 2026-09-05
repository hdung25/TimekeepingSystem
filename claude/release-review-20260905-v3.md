# Payroll synchronization review / release 2026-09-05 v3

Baseline: `6b73efaff1215b7e2c76d47455d857053b8c714b`, clean main before the audit.
Owner authorized fixes, UI verification and production deployment after the review.

## Reproduced defects and fixes

1. Filtering one class reduced the saved/sent monthly payroll from 420,000 to 210,000 while the popup still showed 420,000. Calculation, draft, header and legacy PDF source now use the complete payable month, independent of display filters.
2. Main Save discarded monthly class rates in memory, falling back to profile rates. Both save paths preserve monthly role settings. The modal no longer writes monthly rates/evaluations into the general profile in memory; it reloads the selected role before drafting.
3. Dual teaching/reception pay mixed attendance bonuses and reception fees between the header, popup and saved payload. The final header now uses the same per-role payloads as saving. Auto attendance bonuses are role-specific. Admin manual amounts, including zero, remain manual after save/reopen.
4. A VP chip has multiple CSS classes and failed an exact string comparison. Payroll statistics now use absence metadata/class tokens. Verified fixture: 3 worked, 1 VP, 1 VDX, 1 VKP, 1 late arrival / 7 minutes; future shifts excluded.
5. Previous-month history said "saved" but recalculated using current rates. It now shows the saved role snapshot. If no snapshot exists, the fallback is explicitly labelled as a recalculation, not a finalized payslip.
6. An employee could confirm a newly published second component that was not on their screen. A canonical view token is compared inside the existing receipt transaction. A changed payslip requires review first; repeat confirmation of the same amounts stays idempotent.
7. Employee and Admin salary views retained old publication/receipt status. Month-scoped listeners synchronize those views; strict reads and retry UI prevent failed reads from appearing as an empty/unfinished payroll.
8. Legacy dual-role published documents lost the reception side in ZIP export. Export now uses the shared lifecycle interpretation and fresh strict monthly reads.
9. Staff punctuality charts queried all employees and legacy schedule keys. They now read the employee's own attendance and shared multi-branch monthly schedules, match overlapping sessions in the same branch, and do not mark an upcoming class as absent.

## Verification completed before release

- `npm test`: 54 regression files passed after the final build-version bump. Expected negative-test errors are caught/asserted, not application failures.
- `npm run test:rules`: 30 Rules scenarios plus real DBService attendance and financial-concurrency integrations passed. This release does not change or deploy Firestore Rules.
- Actual Chrome UI with isolated Auth/Firestore emulators: filtering, Save, popup Save, monthly rates, manual bonus zero, publish, employee view, stale receipt rejection, live receipt synchronization, strict-read failure/retry, saved history, ZIP export and worked/absence/lateness statistics passed.
- UI amounts: full and filtered teacher payroll 420,000; dual role 560,000 = teaching 390,000 + reception 170,000; monthly-rate payroll 820,000; manual attendance bonus zero retained at 800,000; history retains saved 200,000 rather than recalculated 400,000.
- Existing browser regression: 8 account configurations / 36 page visits; login, check-in, check-out, primary Admin +10 without schedule, financial-read failure blocking and retry passed with no uncaught page errors.
- New UI test uses fixed September 2026 fixtures and the September 5 local clock. Re-running on another date requires the corresponding test clock/fixture adjustment. Screenshots/JSON are local ignored artifacts, not production data.
- Physical iPhone/Safari and production-load performance have not been benchmarked. Local timing is not a production performance promise. The unused legacy PDF callable was code-reviewed; the reachable ZIP UI was exercised.

## Deployment and data boundaries

Target: existing Git-linked Vercel production `timekeeping-system-tawny.vercel.app` only.
Build: `20260905-payroll-sync-v3`; worker: `tdt-chamcong-v153-payroll-sync-20260905`.
Worker installs the new cache without forcing active attendance/payroll tabs to reload.

No production employee profile, schedule, attendance, payroll snapshot or receipt is edited by this task. No migration, historical recalculation, Auth reset, role change, GPS bypass, Rules deployment, environment change or secondary-domain repointing is included. Historically incorrect sent payroll is not silently changed; any repair needs a separately scoped audit and Admin action.

Deployment is verified through the GitHub/Vercel commit status and public asset comparison. Vercel CLI/connector runtime-log access is unavailable in this session; do not claim a clean production error scan or configured monitoring.

Rollback baseline is the prior code commit above. If rollback is needed, revert only this code release using the existing deployment pipeline; never roll back business documents.
