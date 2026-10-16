# Sửa kẹt lưu điều phối ca — v243 (16/10/2026)

Production baseline: 087a5a6 (v242). Project: ha-huy-dungs-projects/timekeeping-system; canonical domain: https://timekeeping-system-tawny.vercel.app. Existing GitHub integration deploys main.

Root cause: syncCombinedClassAbsences awaited UIService.confirm at z-index 10000 beneath the teacher shift overlay at 10020. The saved row was not rebased until this follow-up completed, while saving had already been cleared. This left a hidden confirmation, a stale loading button and a misleading unsaved-changes prompt.

Changes: scope confirmation/toast stacking above the shift modal; acknowledge the committed primary row before follow-up work; keep write controls locked during combined-class confirmation/sync; release and restore controls in finally before read-only attendance refresh; distinguish a primary failure from a follow-up failure. Declining combined sync preserves the saved source and leaves other classes unchanged. Failed primary writes retain the draft. Schedule asset version and service worker release updated together.

Validation: npm test passed; 31 schedule editor behavioral cases including accept/decline, duplicate save/close protection, primary failure, follow-up failure and stalled attendance refresh. Headless Chrome checks actual table controls for admin and senior_assistant and real confirmation hit-testing at 1365px and 390px. PWA write/update safety and service-worker shell tests passed after release-key change.

No migration, production data repair, Firestore rule, Cloud Function, attendance calculation or payroll changes. Production validation is read-only. Rollback baseline: 087a5a6 / dpl_9gdWWScGaNYqfXtARsE5Nxg3kixJ.

Production verification: fix commit `2317416` deployed as `dpl_FT3QjcBaLajGQSReTh2w16D7274W` (READY), canonical alias confirmed. `schedule-save-production-smoke.cjs` passed: 14 public asset hashes match local tested files; desktop/mobile logged-out routing works; zero page errors and no Firestore mutation requests. Firebase Listen/channel uses POST for reads and is intentionally allowed by the read-only smoke.
