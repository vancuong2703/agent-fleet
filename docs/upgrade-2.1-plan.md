# Kế hoạch nâng cấp 2.1 · Hai CLI

Điều phối: DeepSeek-Flash qua Qoder. Theo yêu cầu mới nhất, worker Qoder dùng **Qwen3.8-Flash**, không dùng Max. OpenCode dùng cấu hình model hiện có.

**Kết quả:** hai CLI đã bàn giao và agent chính đã tích hợp. TypeScript PASS,
402 test mã nguồn, 22 E2E và 17 native PASS. AGY auto-approval đã thử thật;
EXE 2.1 đã kiểm tra theme/layout qua hai lần mở và terminal AGY thật.
Xem [ghi chú nghiệm thu 2.1](releases/2.1.0.md). Phân công bên dưới được giữ lại
để giải thích phạm vi từng worker; không phải danh sách việc còn chờ.

## 1. Phân công

### 1.1 OpenCode — backend/dashboard/observability

**File được ghi duy nhất**
- `shared/dashboard.ts`, `shared/observability.ts`
- `server/dashboard.ts` (mới)
- `server/pty.ts`
- `server/observability.ts`
- `server/adapters/metadata.ts`
- `server/model-usage.ts` (chỉ sửa để khớp ledger; không đổi tên field)
- `test/server/dashboard.test.ts` (mới), `test/server/observability.test.ts`, `test/server/metadata.test.ts`, `test/server/model-usage.test.ts` (mới)

**Không ghi**: `server/api.ts`, `main.ts`, `service.ts`, `store.ts`, `runner.ts`, `command-permissions.ts`, `shared/types.ts`, `web/**`, `desktop/**`, `cli/**`, `scripts/**`, `test/e2e/**`.

**Bàn giao**
1. `server/dashboard.ts` export:
   ```ts
   registerDashboardRoutes(routes, { store, ptyManager }): void
   ```
   Đăng ký đúng:
   - `GET /api/dashboard` → `DashboardSnapshot`
   - `POST /api/dashboard/check` body `{agent}` → `DashboardTool`
   - `POST /api/terminal-sessions` body `{agent, planId?, taskId?}` → `TerminalSessionInfo`
   - `DELETE /api/terminal-sessions/:id` → `204`
   - `GET /ws/terminal?sessionId=&cols=&rows=` → WebSocket `{t:'out',d}` / `{t:'exit',code}`; nhận `{t:'in',d}` / `{t:'resize',cols,rows}`.
2. Không tự gắn auth. Route được parent gọi bên trong scope đã xác thực.
3. `GET /api/dashboard` chỉ đọc cache/config/filesystem; tuyệt đối không spawn/exec CLI, không gọi `detectCli`.
4. `POST /api/dashboard/check` chỉ chạy probe cố định, read-only (`status`/`version`/`help` nếu CLI hỗ trợ), `shell:false`, timeout ngắn, output giới hạn, `windowsHide:true`. Không chạy login, quota hay lệnh do client gửi. Quota/credit không đọc được → `remaining:null`, `unit:null`, `reason` rõ; không trả `0`, không suy diễn từ token/USD.
5. Terminal session do server sinh ID; chỉ nhận `agent`, `planId`, `taskId`. `cwd` lấy từ task `worktreePath`, plan `repoPath`, hoặc workspace an toàn dưới data dir; không nhận `cmd`, `argv`, `cwd`, `title` từ client. Plan/task không tồn tại → 404; task + plan lệch nhau → 400/404.
6. `PtyManager`/dashboard session phải có cách dọn session theo task khi worktree thay đổi; session đã chết tự GIẢI phóng; delete kill và cập nhật `connected`.
7. `server/observability.ts`:
   - Trả đủ `models`, `reportedCredits`, `usageByTool`, `usageByModel` trong `RunObservation`/`ObservabilitySnapshot`.
   - Mọi model được báo/cấu hình đều xuất hiện; model generic như `qfmodel` giữ nguyên, không alias.
   - `usageByModel` cộng các dòng model + bucket `model:null` (unattributed) đúng bằng totals, không nhân đôi.
   - `reportedCredits` tách khỏi `credits`; không cộng hai trường.
8. `metadata.ts`: gắn `model/provider` vào usage event khi parser có model hiện hành; dedupe model; Qoder credit dedupe theo message ID; truyền `usageId`, `usageScope`, `billable`, `attributionOnly`, `reportedCredits` nếu nguồn có, không tự bịa.

**Nghiệm thu**
- Unit test backend đạt; `npm run typecheck` phần server/shared không lỗi.
- Spy `spawn/execFile` chứng minh GET dashboard không chạy process.
- Không file nào ngoài danh sách bị sửa.

### 1.2 Qoder CLI (Qwen3.8-Flash) — web/UI/E2E

**File được ghi**
- Toàn bộ `web/**`, trừ `web/src/api.ts`, `web/src/store.ts`, `web/src/ws.ts` (parent sở hữu).
- `test/e2e/**`, gồm cập nhật `desktop.spec.ts`, tạo `upgrade.spec.ts`; được sửa selector UI ở các spec E2E khác nếu cần.
- Có thể thêm helper mới trong `web/src/` (ví dụ `dashboard-client.ts`, `terminal-theme.ts`), không sửa `api.ts/store.ts/ws.ts`.

**Không ghi**: `server/**`, `shared/**`, `desktop/**`, `cli/**`, `scripts/**`, file package, `asset-logo/**`.

**Bàn giao**
1. Nối `Dashboard` vào `App`: view/nav “Bảng điều khiển”; không gọi check khi mount; chỉ POST check khi bấm nút.
2. Sidebar/task row: logo agent đứng **trước** title; dấu thành công/thất bại đứng **sau** title. Header task cũng logo trước.
3. Dùng đúng 4 logo vendor từ `asset-logo/` (copy vào `web/public/agents/` nếu cần); không thay bằng chữ cái/logo tự vẽ.
4. Theme: thay select bằng 3 nút icon sáng/tối/hệ thống, `aria-label`, `aria-pressed`, lưu localStorage và postMessage native. Light theme trắng/neutral, xoá toàn bộ màu nâu khỏi biến/CSS/terminal light.
5. Layout: nối `useWorkspaceLayout()` + `ResizeHandle` cho sidebar, inspector, terminal; ghi `fleet.layout` và gửi `fleet:set-layout`; clamps khi resize.
6. `TerminalPanel` hỗ trợ cả task terminal cũ (`/ws/pty`) và dashboard terminal (`/ws/terminal?sessionId=`); props tương thích `Dashboard` (`taskId`, `socketPath`, `title`, `closeLabel`, `height`, `onHeightChange`, `onInputReady`). Terminal luôn nền đen + ANSI palette kiểu Windows CMD ở cả light/dark; không đổi theme terminal theo app; đảm bảo chữ AGY đọc rõ.
7. Dashboard: hiển thị tools/logos, trạng thái, version, account, quota/credit “Chưa có dữ liệu” khi null, suggestions, nút Kiểm tra thủ công, nút mở CLI một lần, danh sách session; đóng session gọi DELETE. Không tự chạy CLI/quota khi mở màn hình.
8. Usage/Inspector: hiển thị **tất cả** model từ `models` và bảng `usageByModel` gồm provider, source, unattributed; tách token/cost/credit; không hiển thị giá/credit ước tính.
9. AGY composer: mặc định `auto` chỉ cho task mới; có đủ `ask/check-only/auto`; `allowedCommands` chỉ gửi khi `check-only`; không lưu policy toàn cục. Retry có điều khiển policy cho AGY.
10. `desktop.spec.ts`: kiểm tra 3 nút theme, thứ tự logo/status, resize/persist, terminal đen ở light/dark, dashboard launch.
11. `upgrade.spec.ts`: dashboard GET không check, check thủ công, model/unattributed, AGY default và validation.

**Nghiệm thu**
- `npm run build:web` đạt; `npm run typecheck` không lỗi do UI.
- `npx playwright test test/e2e/desktop.spec.ts test/e2e/upgrade.spec.ts` đạt.
- Không sửa file parent; nếu cần đổi `api.ts/store.ts/ws.ts`, báo parent bằng diff/contract, không tự sửa.

### 1.3 Parent — tích hợp, bảo mật, đóng gói

**File sở hữu**
- `server/api.ts`, `server/main.ts`, `server/service.ts`, `server/store.ts`, `server/runner.ts`, `server/command-permissions.ts`, `shared/types.ts`
- `web/src/api.ts`, `web/src/store.ts`, `web/src/ws.ts`
- `cli/**`, `desktop/**`, `scripts/**`, `package.json`, lockfile
- `test/server/**` còn lại, `test/web/**`, `test/cli/**`, desktop/native tests, final review.

**Bàn giao**
1. Gọi `registerDashboardRoutes(routes, {store, ptyManager})` bên trong `app.register(async routes => ...)` đã có auth/host/origin hook. Giữ `/ws/terminal` trong vùng protected.
2. Nối cleanup dashboard terminal khi task merge/discard/takeover/worktree thay đổi; dọn toàn bộ khi shutdown.
3. Hoàn thiện AGY per-run:
   - `ask|check-only|auto` và `allowedCommands` chỉ áp dụng run hiện tại.
   - Không ghi `--settings` toàn cục; auto chỉ `command(*)` trong session settings.
   - Ghi audit event cho mọi quyết định policy AGY, kể cả `ask` không có rule.
   - Retry cùng agent giữ policy cũ; khác agent hoặc API cũ mặc định `ask`.
4. Migration SQLite: DB cũ thiếu `commandPolicy`/`allowedCommands` phải có default `ask`/`[]`; run cũ đọc ra `ask`.
5. Native layout: `DesktopPreferences` lưu/đọc `sidebarWidth/inspectorWidth/terminalHeight`; inject vào `window.__FLEET_DESKTOP__.layout`; xử lý `fleet:set-layout` có validate/clamp.
6. Packaging: build web + desktop, copy assets/license/runtime manifest, portable EXE/ZIP trong `dist/`.
7. Chạy toàn bộ test, sửa lỗi tích hợp, review cuối; không chấp nhận số liệu giả hoặc route dashboard ngoài auth.

## 2. Trình tự tích hợp

1. **Khóa contract**: cả hai worker dùng đúng tên field hiện có. OpenCode chỉ được thêm field optional; không đổi tên sau khi Qoder bắt đầu. Không copy/worktree chéo.
2. **Song song**:
   - OpenCode hoàn thiện shared + `server/dashboard.ts` + observability/pty/metadata và unit test.
   - Qoder làm UI theo route contract, dùng mock/local cho tới khi backend xong.
3. **Gate backend**: OpenCode báo `registerDashboardRoutes` export ổn định, unit test và typecheck phần server đạt.
4. **Parent nối API**: thêm import/call trong `server/api.ts`, nối cleanup trong `main.ts`, chạy typecheck toàn repo.
5. **Gate UI**: Qoder nối Dashboard/Terminal thật, cập nhật E2E; parent chỉ sửa `api/store/ws` nếu Qoder báo contract thiếu.
6. **Parent hoàn thiện** AGY policy, migration, native layout, packaging.
7. **Gate cuối**: typecheck → unit/integration → web build → Playwright → desktop build/smoke → đóng gói và review.

## 3. Hợp đồng dùng chung — lỗi phải tránh

1. `DashboardAgent = Exclude<AgentId,'fake'>`: dashboard API không nhận `fake`; terminal task cũ `/ws/pty` vẫn phục vụ fake cho E2E.
2. `GET /api/dashboard` không spawn CLI. `installed` chỉ từ bin cấu hình + `existsSync`/cache; không gọi `detectCli`, version hay quota.
3. Chỉ `POST /api/dashboard/check` mới được chạy probe. Probe phải cố định, bounded, read-only; balance không hỗ trợ phải là `null`, không phải `0`.
4. `credits` là credit thực báo cáo; `reportedCredits` là credit danh nghĩa gồm cả non-billable. Không cộng hai trường, không suy ra từ token/USD.
5. `usageScope:'delta'` cộng dồn; `'cumulative'` ghi đè. `usageId` dedupe phải thống nhất giữa runner và observability; key nên gồm provider/model/scope/id.
6. `attributionOnly:true` không được làm thay đổi run totals hay usage totals; chỉ dùng để gán model, và nếu vượt totals thì model rows phải về null + dồn residual.
7. Persisted run totals (`run.inputTokens/outputTokens/costUsd`) là nguồn chính; event totals cùng công việc không được cộng thêm. Credits lấy từ event.
8. Mọi model phải có trong `models`; `reported` thắng `configured`; model cấu hình hiện tại không được gán ngược cho run đã xong.
9. `usageByModel`: tổng các dòng model + dòng `model:null` phải bằng totals; nếu attribution vượt totals, không rescale bịa số — đưa toàn bộ vào unattributed.
10. Terminal: client không được chọn executable/argv/cwd/title. Server sinh ID, suy ra cwd từ store, fallback workspace an toàn; ID lạ phải đóng WS/404. Xoá session phải kill process.
11. WebSocket `/ws/terminal` phải đi qua auth host/origin/token hiện có; không mở route auth riêng. Frame lỗi chỉ chứa `t:'exit'`.
12. Terminal UI luôn dùng black/ANSI CMD, không phụ thuộc `data-theme`; light theme của app không được biến terminal thành trắng/nâu.
13. AGY `allowedCommands` chỉ thuộc run; không ghi global settings, không mặc định auto cho API cũ/retry.
14. Layout native dùng message `fleet:set-layout`; UI clamp trước, desktop validate lại; không lưu giá trị ngoài biên.

## 4. Kiểm thử cụ thể

**OpenCode**
- `test/server/dashboard.test.ts`
  - GET snapshot không gọi `spawn/execFile` và giữ `lastCheck` cũ.
  - POST check chỉ agent hợp lệ; probe bounded; quota/credit không hỗ trợ trả null + reason.
  - Terminal session sinh ID server, hai session khác ID; body có `cmd/cwd/title` bị từ chối.
  - `planId` → `repoPath`; `taskId` → `worktreePath`; không có ID → workspace fallback; ID lạ 404; plan/task lệch 400/404.
  - DELETE kill đúng session; session chết giải phóng.
- `test/server/observability.test.ts`
  - Nhiều model + model cấu hình; run cũ không nhận model hiện tại.
  - Persisted tokens + cùng event tokens = tổng một lần; duplicate seq không nhân đôi.
  - Delta/cumulative/usageId/attributionOnly đúng.
  - Model rows + unattributed = totals; hai model vượt tổng → reset attribution, residual đúng.
  - `reportedCredits` không trộn `credits`.
- `test/server/model-usage.test.ts`
  - Ledger theo tool/model, coverage, generic `qfmodel`, dedupe attributionOnly.
- `test/server/metadata.test.ts`
  - Model/provider dedupe; usage event được gắn model; Qoder credit 0/positive dedupe, âm bị bỏ; field optional không bị bịa.

**Qoder / E2E**
- `desktop.spec.ts`: 3 nút theme + reload; sidebar logo trước title, status sau; resize sidebar/inspector/terminal và persist; dashboard không POST check khi mở; terminal nền đen ở light và dark; AGY text đọc được.
- `upgrade.spec.ts`: dashboard check thủ công; session launch/close; bảng model có unattributed; AGY task mới mặc định auto, ask/check-only hoạt động; không gửi allowedCommands ngoài check-only.

**Parent**
- `test/server/api.test.ts`: `/ws/terminal` thiếu token 401, origin lạ 403, token/cookie đúng mở được; dashboard route nằm trong auth scope.
- `command-permissions`/`runner`/`store`: `ask|check-only|auto`, audit log, default `ask`, migration DB cũ, retry policy.
- `typecheck`, `npm test`, `test:e2e`, `desktop:check`, `desktop:build`; smoke EXE mở/đóng, theme/layout persist, terminal và dashboard hoạt động.
