# Xóa dòng lớp không báo xung đột giả — v244

Baseline: a80ea6a (production v243). Existing GitHub/main integration targets ha-huy-dungs-projects/timekeeping-system and https://timekeeping-system-tawny.vercel.app.

The reported delete failure has two reproducible causes. scheduleRowContentFingerprint sorted only top-level keys, so unordered nested Firestore maps (teacher lists/history) could compare unequal with unchanged data. Three read-only fetches of cs1__2026-10-16 returned the same updateTime; 8 of its 16 evening2 rows differed under the old comparison but were identical with recursively sorted map keys. A second failure dropped a delete click during an in-flight same-row blur edit, or used its pre-edit locator after that edit completed.

The fingerprint now sorts maps recursively while preserving array order and all business values. Deletes queue behind same-row edits, deduplicate repeated clicks, and rebase only known same-page commits scoped to schedule/date/branch/section (and index for legacy rows without IDs). Fresh reads, exact row identity, transaction retry checks and worked-attendance deletion guards remain in place. No production classes are deleted as part of this release. No database repair, rules, Cloud Functions or payroll calculation changes.

Validation: 37 behavioral scenarios, including reordered nested maps, real nested changes on retry, room-edit/delete sequencing, same-page subject edits, repeated clicks, legacy identity scoping, inherited rows, ambiguous identities and worked-attendance protection. Real Chrome desktop/admin and mobile/senior_assistant controls exercise delayed room writes followed immediately by deletion, shuffled nested maps, and v243 stacked confirmation accept/cancel. Full npm regression suite and PWA update checks passed before release.

Rollback baseline: a80ea6a / dpl_5ovqbpddTnHP8v6QacLyBTgQXuso. Production smoke is read-only: compare 14 asset hashes and check desktop/mobile logged-out routing without attendance/payroll writes.
