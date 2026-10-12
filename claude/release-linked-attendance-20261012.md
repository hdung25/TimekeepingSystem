# Bảng công nhóm liên kết — v239

Base production: `123d24d` (v238). No database migrations, rule changes, or production data repairs.

Admin opens Môn học → the group's “Bảng công nhóm · Xuất Excel” link. The selected folder and all its descendant subjects define the scope. The report reads fresh schedules (including inherited rosters), attendance, substitute teachers, cancelled shifts, observations, overtime and early-arrival decisions. It uses the existing evaluator; its opt-in separateSubjectChips flag prevents adjacent different subjects from merging only in this report. Default payroll behavior is unchanged.

Filters: month, subject, teacher name. Summary: hours and unique working dates by subject/teacher. Details include schedule and actual clock times. Combined-class hours count once; a class mixing an included and excluded subject blocks export until corrected or filtered out. An incomplete server read clears totals and disables export.

“Sửa công” opens the existing report/editor in a new tab at the exact teacher/date. Existing permission checks and concurrency-safe attendance/payroll writes remain authoritative. Returning to the report or exporting re-reads the data. Excel contains summary and daily detail, numeric hours, no salary amounts, rates, evaluation payments or published payslip data. Text cells are inline strings rather than formulas.

Validation: full npm test suite; partner policy/evaluator integration tests; local Chrome desktop/mobile UI with real evaluator, keyboard selection, outside-subject isolation, refresh-before-export, network-failure clearing and retry; ZIP CRC and XML validation of the generated workbook. Production smoke verifies matching public assets and logged-out desktop/mobile redirects without authentication or data writes.

Deployment: fast-forward main only after confirming its head remains the baseline. Existing GitHub → Vercel production integration targets `ha-huy-dungs-projects/timekeeping-system`, canonical domain `timekeeping-system-tawny.vercel.app`. Service worker v239 and consistent version keys preserve the existing update/write safety flow.
