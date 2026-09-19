# Kiểm soát phát hành — xét tăng lương và tự ra ca, 19/09/2026

Tài liệu kiểm tra độc lập, cập nhật sau phát hành ngày 19/09/2026. **Đã deploy và kiểm chứng**; kết quả thực tế, deployment và phạm vi kiểm thử ở cuối tệp. Những mục khảo sát baseline giữ nguyên để phục vụ đối chiếu/rollback.

## Phạm vi và nguồn đối chiếu

- Người dùng đã giao triển khai, cá nhân hóa tiêu chí/ngưỡng giờ theo từng người, kiểm tra tự ra ca và deploy sau kiểm chứng. Không cần hỏi lại quyền thực hiện công việc đã giao.
- Không ghi thử dữ liệu nhân viên thật, không migration giá, không tính/gửi lương tự động. Luồng nhắc phải tách khỏi quyền đổi tiền.
- Đọc `.agents/AGENTS.md`, `claude/system_logic.md`, `TODO_XET_TANG_LUONG.md`, `nghien-cuu-moc-luong-20260919.md`, release ngày 08–09/09 và mã thực tế. Tài liệu cũ có số dòng/phiên bản không còn đúng; mã là căn cứ kiểm tra hiện tại.
- Những nhận xét phía dưới được đối chiếu với `js/report.js`, `js/db-service.js`, `js/subject-rate-policy.js`, `firestore.rules`, cấu hình deploy và các test hiện hữu.

## Baseline deploy đã kiểm tra chỉ đọc

Ngày kiểm tra: 19/09/2026, khoảng 14:52 UTC+7.

| Mục | Kết quả |
|---|---|
| Vercel scope | `ha-huy-dungs-projects` |
| Dự án | `timekeeping-system` |
| Project ID | `prj_58GRPpalLQeeweIG1MYu3ji5K6ZH` |
| Team ID | `team_36pVT37BQDKv2KKYsyLSM5y2` |
| Alias bắt buộc | `https://timekeeping-system-tawny.vercel.app` |
| Baseline production | `dpl_89LAo2HbVQyj9uGLMBsJS7yotrCn`, `Ready`, target `production` |
| URL deployment baseline | `https://timekeeping-system-q90pxowum-ha-huy-dungs-projects.vercel.app` |
| Thời điểm baseline | 18/09/2026 02:40:06 UTC+7 |
| Firebase project/database | `timekeeping-69f3f` / `(default)` |
| Firebase region | `asia-southeast1` |

Không có `.firebaserc` ở source. Mọi lệnh Firebase deploy cần chỉ rõ `--project timekeeping-69f3f`; mọi emulator phải dùng `--project demo-timekeeping`. Không dựa vào project mặc định của CLI.

Rules production đã đọc qua API lúc 15:20:36 UTC+7, không có ghi: `projects/timekeeping-69f3f/rulesets/d1c2f442-60b9-4396-bcf0-f22582b09ff5`, release update `2026-09-11T08:17:18.784040Z`. Nguồn lưu ở `scratch/firestore-production-predeploy-1789806036319.rules`, manifest `.rules.json`; raw SHA-256 `132904c428f3af485fbbf4688178d76ae58f06c0e93701d6ab377326f7bed322`. Sau chuẩn hóa xuống dòng, Rules deployed **trùng Git HEAD** (hash `35ed8146a6c9bb7f418f51b78caa9b09efc283659002bad0e210ed8dc3cb8b98`). Không có Rules độc lập trên production bị bỏ sót lúc so sánh.

`node`, `npm`, `vercel`, `firebase`, `gcloud`, Java 21 đều có trên máy. Emulator Firestore JAR v1.21.0 đã có trong cache. `firebase.browser.json` cấu hình Auth 127.0.0.1:9098, Firestore 127.0.0.1:8088 và tắt emulator UI. Chưa chứng minh các cổng rảnh tại thời điểm bắt đầu từng bộ test.

## Backup: kết quả thực tế, không suy từ release cũ

Các lệnh chỉ đọc đã chạy:

```powershell
gcloud firestore databases describe --database='(default)' --project=timekeeping-69f3f --format='json(name,locationId,type,pointInTimeRecoveryEnablement,earliestVersionTime,versionRetentionPeriod,deleteProtectionState)'
gcloud firestore backups schedules list --database='(default)' --project=timekeeping-69f3f --format=json
gcloud firestore backups list --location=asia-southeast1 --project=timekeeping-69f3f --format='json(name,state,createTime,expireTime,database)'
```

Kết quả: PITR **disabled**, version retention **3600 giây**, delete protection **disabled**, danh sách lịch backup và backup trong region đều rỗng. Các bản `migration_backups` của sửa lỗi trước chỉ bảo vệ tập tài liệu riêng của lần đó; không phải backup toàn bộ database. Không được tuyên bố có thể restore toàn bộ production từ những bản này.

Không tự bật dịch vụ trả phí hoặc export cloud. Với release chỉ thêm tính năng và không sửa dữ liệu nguồn khi triển khai, giữ rollback mã tương thích là lớp bảo vệ chính. Trước khi mở thao tác áp giá, snapshot nguồn phải đi cùng audit trong transaction và cần có bản sao cục bộ của các tài liệu liên quan nếu tác vụ có thay đổi dữ liệu hàng loạt. Bản sao có lương chỉ đặt trong `scratch/` bị ignore, không đưa lên web hoặc commit.

**Bản sao phạm vi lương đã tạo chỉ đọc lúc 15:12:51 ngày 19/09/2026 UTC+7:** `scratch/salary-review-predeploy-1789805571469.json`, manifest cùng tên thêm `-manifest`, dung lượng 1.206.411 byte, SHA-256 `e2ac382e49c2c7b53b872854631b55a99d56fdca05fc60d30c90d8a30318bc11`. Gồm 76 user chỉ các trường nhân sự/cấu hình lương, 74 môn, 5 cấu hình lương mặc định, 112 tài liệu lương tháng; hai collection xét lương chưa có tài liệu. Giữ raw Firestore types và updateTime, không chứa trường credential của users. Script `scratch/backup-salary-review-readonly-20260919.cjs` chỉ GET.

Đây **không phải backup toàn database**: không gồm attendance/schedules, không gồm subcollection revisions, các trang đọc không chung một readTime. Khi cần phục hồi user chỉ patch các fieldMask đã lưu với precondition updateTime; tuyệt đối không thay nguyên user document bằng bản đã lọc. Triển khai phiên này không chạy restore hoặc migration production.

## Điểm nối lương phải hiểu trước khi duyệt code

### Adapter xem trước đã triển khai trong phiên này

`js/salary-review-application.js` là module thuần, **không ghi Firestore**. Kiểm thử `node test-automation/salary-review-application.test.js` đã qua cho module này; chưa có nghĩa toàn bộ feature/service/browser đã qua.

```javascript
SalaryReviewApplication.buildPreview({
  staffId, user, defaults, targetDoc, history, catalog, group,
  selectedSubjectIds, newRate, targetMonth, currentMonth,
  getPayslipLifecycleState: DBService.getPayslipLifecycleState
})
```

- `user`: hồ sơ có `salary_config`; `defaults`: `salary_settings` đã đọc hoặc `null` nếu xác nhận không tồn tại; `targetDoc`: tài liệu tháng đích hoặc `null`. Không dùng `undefined`/lỗi đọc thay cho tài liệu không tồn tại.
- `history`: map `YYYY-MM` → document hoặc `null` cho các tháng đã đọc. Cần đủ từng tháng trước tháng đích tới nguồn gần nhất có giá GV dương, tối đa 6 tháng.
- `group.subjectIds`: phạm vi môn đã được xác nhận; `selectedSubjectIds`: tập con được admin chọn rõ ràng, không tự chọn cả folder. `catalog`: danh mục môn thật theo ID.
- `targetMonth`/`currentMonth`: chuỗi tháng UTC+7 do service cấp; không tin thời gian hoặc patch từ browser khi commit.
- Kết quả: `patch` chỉ chứa vai trò GV cần merge, `effectiveRoleKey`, `mergedRates`, `changes`, `preserved`, `sourceMonths`, `inheritedMonth`, `warnings`, `effectiveFrom` và `sourceFingerprint`.
- `sourceFingerprint` là chuỗi canonical để đối chiếu, không phải hash mật mã và không nên lưu như trường audit lớn. Service phải đọc lại nguồn trong transaction rồi dựng lại patch. Root có thể dùng CAS riêng hoặc hash nguồn.
- Khi cả `giao_vien` và `giao-vien` tồn tại, chọn canonical `giao_vien` như report hiện tại; legacy được giữ nguyên. Khác biệt hiện thành `warnings`, không chặn dữ liệu cũ hợp lệ chỉ vì có hai khóa.
- Adapter giữ tên khóa alias/lớp ghép/lớp đông chưa chọn nguyên vẹn; chỉ tạo/thay khóa payroll chuẩn hóa của môn đơn có ID và tên duy nhất. Việc chuẩn hóa tên có test so sánh trực tiếp với `evaluation-service.normalizeChipFilterName`.
- Từ chối tháng đã có snapshot GV dù còn nháp, phiên hiệu chỉnh GV, thiếu nguồn và tháng hiện tại/quá khứ. Cho phép phiếu chỉ TT đã gửi/nhận vì patch GV không đụng snapshot đó.

`js/salary-review-service.js` đã nối adapter qua `prepareApplication`, `applyApplication`, `cancelApplication`. Prepare chỉ đọc. Commit dựng lại patch trong transaction sau khi đối chiếu nguồn; context riêng trong bộ nhớ tránh tin patch UI. Audit append-only có `recordedAt` server timestamp; parent tăng revision và trỏ `lastHistoryId`. Dữ liệu cấu hình/công/phiếu cũ không được ghi khi tải màn xét.

`node test-automation/salary-review-service.test.js` đã qua: bảo toàn lương cũ và TT, alias/giá 0, nguồn thay đổi tám nhóm, Firestore retry sau ghi đồng thời, hai bản xem trước, nhấn lặp, hủy và trả lại đúng vai trò, hủy không làm mất sửa nhóm khác, tháng mới chuyển trong lúc popup mở, primary-admin gate. Đây là transaction double có kiểm tra read version và staged writes; emulator thật được kiểm tra riêng bởi `salary-review-rules.test.js`.

Hủy chờ hiệu lực chỉ cho phép khi **toàn bộ vai trò GV tháng đích** còn khớp `afterRole` đã duyệt và chưa tính lương GV. Nếu một admin đã chỉnh tiếp vai trò đó, kể cả một nhóm khác, không tự rollback nguyên map; báo cần đối chiếu để bảo vệ thay đổi mới. Không xóa cả tài liệu tháng. Nếu bản áp đã bị hủy, phát lại operationId cũ phải báo đã hủy/thay thế, không được báo đã áp thành công.

Khi chỉ chọn một phần môn trong nhóm để tăng, nhóm xét sau duyệt chỉ giữ các ID đã chọn. Các môn bị loại vẫn giữ giá cũ, cần nhóm xét ngoại lệ riêng nếu muốn tiếp tục nhắc. Audit giữ phạm vi trước duyệt để hủy trả lại chính xác; nếu môn cũ đã được đưa vào nhóm ngoại lệ đang bật thì hủy phải báo phần trùng để admin xử lý trước, không tạo hai nhóm xét cùng một môn. Khi lưu thay đổi nhóm khác, nhóm đang chờ hiệu lực giữ nguyên cấu trúc để việc hủy còn đối chiếu đúng audit.

### Thứ tự giá hiện có

1. Override ca do admin có đường lấy giá riêng, cần tiếp tục được ưu tiên.
2. Giá theo tháng `salary_settings_monthly` có hai khóa vai trò tương thích `giao_vien`/`giao-vien`, `tiep_tan`/`tiep-tan`.
3. Report điền các giá thiếu từ tháng gần nhất trong tối đa 6 tháng, chỉ trong bộ nhớ. `loadInheritedClassRates()` dừng ở tháng đầu tiên có **bất kỳ** giá dương của vai trò, không tra tháng khác cho từng môn còn thiếu.
4. `users.salary_config.class_rates`, cấu hình `roles`, giá ca và `SubjectRatePolicy` cung cấp các fallback ở nhiều nơi. `salary_settings` còn có thể làm cấu hình nền khi tháng chưa có vai trò.
5. Phiếu đã gửi/đã nhận dùng snapshot `published`, các chỉnh sửa sau đó đi qua `revisionDrafts` và lịch sử hiệu chỉnh. Giữ nguyên cơ chế này.

Vì (3), **không tạo tháng hiệu lực chỉ chứa vài môn được tăng rồi coi là xong**. Các tháng sau có thể dừng kế thừa ở bản không đầy đủ đó, làm mất giá các nhóm khác. Cũng không thay thẳng `subjectRatePolicy.groupRates`: chính sách hiện có chỉ một mốc hiệu lực, lấy cây môn hiện tại, và bị các giá theo môn/theo tháng che.

### Cách áp dụng hẹp được đề xuất để kiểm chứng

- Màn xét ghi hồ sơ, mốc và quyết định riêng; lưu mốc không chạm lương.
- Chỉ áp giá qua thao tác admin rõ ràng, có xem trước từng môn, vào đầu một kỳ tương lai. Giữa tháng/hồi tố cần nhánh phân bổ riêng, chưa mở mặc định.
- Snapshot ID môn và tên khóa dùng trong bảng lương ngay khi quyết định; không suy từ cây folder mỗi lần đọc kỳ cũ. Tên trùng/alias chưa xác nhận phải dừng ở gợi ý.
- Đối soát dữ liệu thật của tháng đích với tập giá hiệu lực được kế thừa trước đó. Materialize nền giá đầy đủ, chỉ thay các môn admin đã chọn. Giữ các ngoại lệ chưa chọn, giá lớp đông, lớp ghép, TT/VP, thưởng/phạt/tạm ứng và mọi trường khác.
- Không biến giá đã nhập tay thành ngoại lệ bị xóa âm thầm. Preview cần phân biệt giá lưu tại tháng đích, giá kế thừa và mức dự kiến. Admin lựa chọn phạm vi rõ ràng.
- Dùng một transaction kiểm tra full baseline vai trò tháng đích, các tài liệu nguồn đã dùng, revision hồ sơ/quy định và quyết định chưa áp; lưu patch, source snapshot, quyết định, audit cùng nhau. Lỗi phải không để trạng thái "đã áp" khi chưa ghi giá.
- Không đụng `published`, xác nhận nhận/chi hoặc revision cũ. Nếu tháng đích đã có tính toán GV, phải có quy tắc chặn hoặc vô hiệu bản nháp rõ ràng; không để nháp cũ trông như đã dùng giá mới.
- Thao tác lưu tháng ở tab report cũ đã có baseline `expectedSettings`; bản áp mới phải làm baseline đó xung đột, thay vì cho tab cũ ghi giá trở lại.
- Giá 0, thiếu giá và giá ngoài thang phải tách biệt trong màn xét. Code cũ có chỗ coi 0 là thiếu; không sửa toàn bộ cách hiểu giá 0 trong đợt này chỉ để tiện feature mới.

## Hiệu năng và trạng thái đang ghi

- Dashboard chỉ đọc metadata hồ sơ xét và quy định để tính hạn. Không quét attendance, 6 tháng lương × toàn nhân sự, toàn bộ revisions hoặc mọi collection lúc nhân viên mở app.
- Tải bằng chứng theo nhân viên/nhóm khi mở chi tiết; ưu tiên 3 kỳ hoàn chỉnh, dùng cache có scope/ngày hết hạn và nút làm mới. Tìm kiếm/lọc chạy trên dữ liệu đã tải, không gọi Firestore trên từng phím.
- Query tháng dùng document-ID prefix/range hoặc phạm vi date hiện có. Luồng mới cần strict server reads, lỗi không giả thành mảng rỗng hoặc 0 giờ.
- Single-flight cho đọc/lưu; stale response guard khi đổi nhân viên/tháng. Cache lỗi phải được xóa để retry. Không thêm interval polling toàn bộ bảng lương.
- Mọi listener phải có unsubscribe; không viết snapshot vào collection đang nghe chỉ để cập nhật giờ "đã quét".
- Nút quyết định/lưu khóa trong lúc ghi. PWA `hasPendingDataWrite` phải nhận biết thao tác mới, để cập nhật không reload giữa transaction. Giữ nội dung chưa lưu khi tải lỗi hoặc có xung đột.
- Chỉ nạp JS màn xét trên trang xét; sidebar/dashboard sử dụng module metadata nhỏ hoặc lazy load. Không làm trang chấm công chờ dữ liệu xét lương.

## Checklist trước phát hành — ghi kết quả thật sau khi chạy

### Kiểm thử chức năng mới

- [x] Hồ sơ mới có thể nháp; lưu mốc/bật nhắc không đổi giá/công/phiếu.
- [x] Nhân viên có nhiều nhóm và chu kỳ/ngưỡng riêng: kế thừa đúng, để trống khác 0.
- [x] Mốc quan sát giá không giả thành ngày tăng; mốc khởi tạo được ghi rõ.
- [x] Ngày đầu tháng hiển thị mọi hạn trong tháng; cuối tháng/năm nhuận/timezone UTC+7 đúng.
- [x] Ít giờ/thiếu kỳ vẫn nhắc; admin mới quyết định hoãn; hoãn/không tăng không sửa ngày tăng gần nhất.
- [x] GV kiêm TT/VP, lớp ghép qua nhóm, lớp đông, tên trùng/alias, giá ngoài thang và các ngoại lệ được bảo toàn.
- [x] Nhắc và quyết định idempotent; nhấn hai lần/hai tab không tạo hai lần tăng.
- [x] Lưu/duyệt xung đột với sửa từ tab cũ, sửa tháng đích, sửa policy/hồ sơ/nguồn giá đều bị phát hiện.
- [x] Mất mạng/tải một phần không đưa 0 giờ hoặc không có giá giả; lỗi áp không báo thành công.
- [x] Apply cho một người/nhóm chỉ tác động các môn/kỳ đã xác nhận; tháng trước và nhóm khác byte-for-byte không đổi.
- [x] Tháng tiếp theo vẫn kế thừa đủ giá các nhóm khác; giá nhóm đã tăng tiếp tục đúng qua nhiều tháng.
- [x] Chỉ primary admin được xem/quyết định theo phạm vi thiết kế; Rules chặn staff/senior dùng trực tiếp API để đổi tiền.
- [x] Audit tạo được nhưng không sửa/xóa được; actor từ auth, timestamp từ server; revision không thể lùi.

### Hồi quy và trình duyệt

- [x] `npm test` ở `test-automation`: chạy cả pretest + toàn bộ script hiện có và các test mới liên quan.
- [x] Các suite của `npm run test:rules` được chạy trên emulator demo, bao gồm quyền mới, CAS, audit, concurrent admin writes.
- [x] `npm run test:payroll-ui`: lưu/tính/gửi/nhận/hiệu chỉnh/in, tháng cũ, đa vai trò và nhân sự đang nhập giá.
- [x] `npm run test:browser`: vào/ra ca và trang lịch/công đại diện các vai trò.
- [x] Luồng mới E2E emulator: nhập mốc → hạn tháng → thông báo admin → hoãn/duyệt → apply → tính lương kỳ đúng → xem phiếu cũ nguyên vẹn.
- [x] Tự ra ca: lịch đơn/chuỗi lớp, chuyển/đóng/vắng ca, ca đêm, ca hôm trước, mất mạng/mở lại app, tab cũ và lịch vừa sửa. Chỉ đóng phiên đủ căn cứ, không tạo công mới.
- [x] Kiểm tra desktop + mobile trang xét, modal, loading/error/saving/conflict; không tràn ngang, không uncaught JS errors.
- [x] `node --check` các JS sửa/thêm; `git diff --check`; xem lại diff độc lập.
- [x] Version query của mỗi JS/CSS chỉ có một giá trị trên mọi HTML và Service Worker; cache mới đồng bộ; trang xét được cache hợp lý.
- [x] PWA không tự reload giữa lưu/duyệt/công; kiểm tra bản cũ kết hợp Rules mới vẫn chấm công được.

### Deploy và xác minh

- [x] Xác minh alias production vẫn trỏ baseline dự kiến; nếu có deployment mới từ phiên khác, đọc lý do trước khi thay.
- [x] Xác minh `git status`, loại dữ liệu lương thật/log/emulator/scratch ra khỏi commit; `.vercelignore` vẫn chặn `scratch`, `scripts`, `test-automation`, `claude`, `.agents`, `.env*` và `text`.
- [x] Ghi Firebase ruleset baseline để rollback; deploy Rules additive đã test trước JS cần collection mới. Không deploy indexes hoặc migration ngoài phạm vi.
- [x] Theo workflow: commit/push main đã test, `npx vercel --prod --yes` đúng scope/project; không tự tạo project khác khi auth lỗi.
- [x] `vercel inspect` cho deployment mới: `Ready`, `production`, alias chính xác.
- [x] HTTP GET bản production: HTML/scripts/cache version mới; hash tài nguyên thay đổi khớp local. Test production chỉ đọc, không nhập công hoặc gửi lương thử.
- [x] Chrome mobile mở login/asset; SW/version đối chiếu source và hồi quy; kiểm tra tài nguyên mới, không lỗi JS và không request ghi production trong smoke.
- [x] Cập nhật deployment/commit/test và giới hạn ở TODO, release note và `system_logic.md` sau khi kiểm chứng; không đánh dấu phần chưa test là xong.

## Rollback

Baseline mã đang chạy trước đợt này là deployment `dpl_89LAo2HbVQyj9uGLMBsJS7yotrCn`. Trước khi dùng nó rollback cần kiểm tra lại alias/current deployment và thay đổi có thể phát sinh trong lúc làm việc. Rules additive nên giữ tương thích mã cũ; không xóa collection mới khi quay lại giao diện.

Nếu admin đã áp giá sau phát hành, rollback mã **không đồng nghĩa hoàn nguyên lương**. Cần đối soát quyết định/audit và nguồn tháng đích, lập thao tác hiệu chỉnh có điều kiện phiên bản; không phục hồi nguyên document cũ đè lên công hoặc lương vừa được người khác sửa.

## Kết quả thực thi release

Frontend commit `1976eb9` đã push main; Vercel deployment `dpl_9NesVxFVBur9vV8SShB2bpR7t4uh`, tạo 15:40:58 UTC+7, `Ready`, target `production`. `vercel inspect` xác nhận scope `ha-huy-dungs-projects`, project `timekeeping-system` và alias `https://timekeeping-system-tawny.vercel.app`. Rules project `timekeeping-69f3f` đã deploy; lần cuối đã tách nhánh list/map để compiler không cảnh báo, không đổi quyền nghiệp vụ đã kiểm thử.

- `npm test`: 69 file qua (log cục bộ `scratch/final-unit-20260919.log`). Các suite Rules hiện hữu/mới, chấm công thực tế, tài chính và tự ra ca đều qua emulator; Rules cũ 33/33.
- Browser Chrome: payroll đầy đủ, staff 8 vai trò, xét lương save/defer/preview/apply/report/cancel và tên/cấu hình audit đều qua. Đã kiểm tra viewport390px; `errors: []`. Xem release-salary-review-browser-20260919.md.
- HTTP production: 14 tệp HTML/JS/CSS/SW trả200 và SHA256 trùng local. Chrome mobile login hiển thị; truy cập xét khi chưa đăng nhập trở về login. `scratch/salary-review-production-verification.json`, không có request ghi Firestore trong smoke. Không thử duyệt tiền bằng tài khoản production.
- GET-only đối chiếu dữ liệu từ 15:12:51 đến 15:43:50 UTC+7: 112 tài liệu lương tháng, 5 salary_settings, 74 subjects và các trường đã chiếu của76 users đều không thêm/xóa/thay giá trị. Collection xét mới vẫn0 hồ sơ/0 cấu hình, nên chưa tự bật mốc hay áp mức nào. Bằng chứng `scratch/salary-review-production-data-comparison.json`.
- Đối chiếu production không quét attendance/lịch vì nhân viên đang làm; bảo toàn các luồng đó được kiểm bằng regression/emulator và kiểm tra writer. Không tuyên bố mọi tài liệu công đang hoạt động phải giữ nguyên updateTime.
- Không mở migration, tăng giữa tháng/hồi tố, worker khi app đóng, công liên kết/tại nhà mới hoặc XLSX mẫu mới. Có TODO/hướng dẫn riêng và snapshot nguồn giá/Rules cục bộ đã loại khỏi Git/Vercel.

Rà độc lập cuối ở nhánh tự ra ca: đọc diff `main.js`/`db-service.js`, chạy lại `auto-checkout.test.js`, `auto-checkout-freshness.test.js`, `startup-performance.test.js`, `app-update-write-safety.test.js`: đều PASS. Kiểm tra tập trung đọc server khi cần, giữ phiên admin sửa, kiểm tra đúng ID/giờ phiên trước ghi, single-flight, cache lịch 5 phút, vô hiệu cache sau lỗi và bảo vệ PWA. Không ghi hay sửa công production trong lượt rà này. Không coi đây là bằng chứng mọi thiết bị sẽ ghi ra ca khi app đóng.
