# Review / release 2026-09-05 v2

Baseline: `be1429b777b821543a14a1cda9cbea23a978a517`, clean `main` before work.
Owner authorized implementation, regression checks and production deployment.

## Changes and evidence

1. Financial readers no longer turn a failed/partial OT or +10 query into a cached empty result. Owner-index pagination reads all legacy records before month filtering; successful cache has a 15-second freshness bound, explicit reload invalidates it. Tests cover 601 records, second-page failure and recovery without source mutation.
2. Report completeness is scoped to employee/month. Required profile, settings, subjects, attendance, observations, notes, fixed/cancelled shifts and schedules fail explicitly. Save, modal save, receptionist extras, draft and publish refuse incomplete input. Receptionist collective bonus calculations are awaited and guarded against stale employee/month commits; attendance failures for another member cannot become zero points. One render shares manifest/template reads without creating a cross-render stale cache.
3. New overtime requests contend on one deterministic transaction document. Admin edits and approval/rejection via a legacy button synchronize the canonical decision and retained legacy records. Revoking through the edit popup no longer deletes the request first. Re-request after rejection retains the previous decision. Rules enforce canonical owner creation, pending status and bounded minutes; Admin historical session identifiers remain compatible.
4. Expired temporary transfer deltas are reversed only in inherited roster projections, newest-first. Permanent moves, unrelated teachers and original historical documents are preserved. New history includes before/after rosters; legacy events use their explicit add/remove identities. Every root page using DBService loads the same teacher-state helper. Tests cover source/target, legacy events, nested moves, idempotence and stable inherited chip IDs.
5. Staff clock values are validated against server request time and canonical ISO format. New check-ins must belong to their Vietnam-local day and be within -5/+2 minutes of server time. Checkout cannot precede check-in or be in the future; a staff member cannot rewrite a completed manual checkout or change only top-level clock fields. Admin-primary authorization is checked before staff restrictions. Existing normal v2 clients remain compatible; no new browser prompt is added.

## Verification

- `npm test`: 53 regression files, including the new pagination/completeness/transfer-expiry cases.
- `npm run test:rules`: 30 existing Rules scenarios, real DBService attendance/name/registration/Admin-OT integration, plus real concurrent staff/Admin transactions and forged clock/header rejection tests. Positive boundary tests also cover 24-session append/checkout/student-count and automatic stale-session extension.
- `npm run test:browser`: isolated Auth + Firestore emulators, 8 account configurations, 36 page visits. Actual login/check-in/check-out; primary Admin +10 without schedule produces 100 minutes from a 90-minute session. Injected OT-read failure and a different receptionist's attendance failure both block the actual publish handler; retry restores readiness. No uncaught page errors in the completed run.
- Browser fixture configurations: teaching+reception, teaching, senior assistant, assistant, office, receptionist assistant, staff, primary admin.
- Mobile-width Chrome screenshots reviewed. This is not a physical iPhone/Safari test or a production-load benchmark.
- Production writes in this task are limited to deployment/Rules configuration. No staff profiles, schedules, attendance records or published payroll documents are migrated or repaired in production.

## Important limits (do not claim otherwise)

- RuleHD still uses real browser location and the required staff-facing Wifi/IP sentence. Local acknowledgement is not permission and not a location proof. OS/browser/origin controls permission retention; perpetual one-time consent cannot be guaranteed.
- The existing location gate is client-side. Time Rules close the reproduced arbitrary historical/future-clock writes, **not** the whole direct-API/location-attestation threat. No trusted location gateway, WIF account, service-account key or new backend authorization was provisioned in this release. Moving the location decision to a trusted service needs a separately verified backend and a client migration/cutover; do not disable compatible live clients to imply that this gap is solved.
- Temporary expiry projection applies to inherited days, not deliberate direct overrides. If old historical transfer metadata has already been removed, do not invent missing teachers or bulk rewrite history.
- Financial reads are complete per request, not one global transaction spanning every collection. Existing source revision and published/received-payroll protections remain in place.
- A severely incorrect device clock or an offline queued check-in is rejected by the new time boundary; Admin can correct genuine work through the existing audited workflow.

## Deployment safety

Primary target only: `timekeeping-system-tawny.vercel.app`, Firebase `timekeeping-69f3f`.
Secondary `chamcongtdt.vercel.app` was not silently repointed.
Build `20260905-payroll-schedule-integrity-v2`; worker `tdt-chamcong-v152-payroll-schedule-integrity-20260905`.
Worker downloads the new assets but does not force activation/reload while old tabs are recording work.
Deploy a compatible Rules stage (canonical missing-own GET/re-request support, legacy pending creation still allowed), publish and verify static files, then activate final canonical-only creation Rules. Retain exact previous ruleset IDs for rollback; do not roll back business documents.
