# Report shift deletion — v274, 09/11/2026

Deleting a merged operational shift previously unassigned only its first roster slot. The remaining slot could reappear as an absent chip. Deletion also wrote attendance, cancellation and roster separately, permitting partial completion, and used a different operational cancellation key from evaluation.

The report now retains each visible chip's original roster identities. A single Firestore transaction removes the selected attendance session (when present), records cancellation and unassigns all selected roster slots. An absent subshift is editable and deletes only its own slot; a worked subshift retains a separate delete target. Other employees, dates, sessions and teaching assignments are preserved. Legacy session clocks use start/null fallbacks. Repeated taps are guarded, and notification or local storage failures cannot misreport a committed deletion.

Validation: complete npm test suite; specific transaction/evaluation regressions; real Chrome modal deletion fixture; Firestore Emulator with existing production rules (Admin success, schedule-only consecutive deletion, employee denial without partial writes). No production attendance or payroll records were modified during validation. No Firestore rules, Functions, schema migrations or credentials are deployed.

Release baseline: production/main d19724e. Other uncommitted work in local checkouts is excluded. v273 was present only in an unrelated local working copy; this release uses v274 to avoid identifier collision.

The screenshots do not identify month or full employee name. The exact historical row is not automatically deleted or changed.
