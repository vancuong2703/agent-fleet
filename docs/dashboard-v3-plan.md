# Dashboard v3 + nền tảng UI — kế hoạch và phân công

Ngày: 03/11/2026. Leader: Claude (lập brief, review, chạy kiểm tra, merge).
Người thực hiện: **Codex**, **Qoder**, **OpenCode** thông qua `fleet`.
Tài liệu liên quan:
- Mockup: [`docs/mockups/dashboard-v3.html`](mockups/dashboard-v3.html)
- Plan UI/UX tổng: [`docs/ui-ux-improvement-plan.md`](ui-ux-improvement-plan.md). Plan này thay thế mục 3.2 của plan đó.
- Kinh nghiệm debug: [`docs/codex-debug-playbook.md`](codex-debug-playbook.md)

---

## 0. Đề xuất thay đổi cốt lõi (cần anh/chị chốt trước khi chạy)

Hiện trạng: server Node/TypeScript khoảng 4.700 dòng, web React khoảng 2.250 dòng, vỏ
desktop C#/.NET 10 + WebView2 khoảng 1.000 dòng. Gói `dist/AgentFleet-2.2.0` nặng **187 MB**:
`runtime/node.exe` 90 MB, `app/node_modules` 47 MB. Trong `node_modules` có cả
`react-dom` và `@xterm` dù web đã được build sẵn vào `app/web`, có `@lydell/node-pty` 12 MB
chứa đủ prebuild cho mọi nền tảng, và có thư mục `test/`.

| Phương án | Lợi | Chi phí / rủi ro | Kết luận |
|---|---|---|---|
| **A. Giữ stack, giảm dung lượng gói + nền tảng UI mới** | Gói giảm còn khoảng 105–110 MB, `app/` dưới 10 MB. Khởi động nhanh hơn vì không phải resolve hàng nghìn file. UI đẹp hơn nhờ icon set chuẩn và design tokens | 1–2 ngày công, rủi ro thấp, test hiện có vẫn dùng được | **Khuyến nghị — Codex làm (T0.1, T0.2)** |
| B. Chuyển server vào tiến trình .NET (ASP.NET minimal API + ConPTY) | Bỏ được node.exe 90 MB, chỉ còn một runtime | Phải viết lại server và 5 adapter parse stream CLI, khoảng 2–3 tuần. Mất bộ test vitest. Dễ hồi quy ở phần parse | Chưa nên. Chỉ xét lại khi dung lượng thực sự là vấn đề |
| C. Tauri/Rust (hoặc Go + webview) | Gói khoảng 15 MB, rất nhẹ | Viết lại cả desktop lẫn server; node-pty phải thay bằng crate khác | Không đáng so với lợi ích |
| D. Đổi framework frontend (Svelte/Solid/Preact) | Bundle nhỏ hơn vài chục KB | WebView2 chạy cục bộ nên khoản tiết kiệm này không cảm nhận được. Phải viết lại 15 component | Không. UI "đẹp" do design system quyết định, không do ngôn ngữ |

Điểm cốt lõi nên đổi (nằm trong phương án A):
1. **Bundle server bằng esbuild** thành một `app/server/main.js` duy nhất. Chỉ ship các dependency runtime
   thật sự cần (fastify, @fastify/*, node-pty bản prebuild win32-x64). Bỏ `test/`. Tên file zip lấy version
   từ `package.json` (hiện `scripts/package-desktop.ps1` đang hard-code `2.2.0`).
2. **Icon:** chuyển sang `lucide-react` (tree-shake, nét 1.75, đồng bộ). `Icon.tsx` thành lớp map
   tên → icon lucide. Logo agent đổi sang dạng chip có nền riêng để luôn rõ ở cả hai theme.
3. **CSS:** tách `theme.css` (1.467 dòng) thành `tokens.css` + `layout.css` + mỗi component một
   file CSS. Thêm token spacing/radius/type/status/tier như trong mockup. Bỏ các khối định nghĩa trùng.
4. **Hợp đồng dữ liệu dashboard có cấu trúc:** hiện plan và model chỉ là chuỗi `details` tự do,
   UI không thể làm trực quan được (chi tiết ở T1).

---

## 1. Kết quả khảo sát nguồn dữ liệu (đã kiểm chứng trên máy, chỉ dùng lệnh đọc)

| Tool | Có sẵn | Lệnh/nguồn mới dùng được | Không có (phải dựa vào nguồn khác) |
|---|---|---|---|
| **Codex** 0.166.0 | `--version`, `login status`; PTY `/status` → hạn mức 5h + tuần, account, model | `~/.codex/config.toml` (`model`, `service_tier`); claim `chatgpt_plan_type` trong `id_token` của `~/.codex/auth.json` (giải mã cục bộ, **không log token**) | Credit (không áp dụng với gói ChatGPT) |
| **Qoder** 1.1.81 | `status -o json` (`user_type`, đăng nhập), PTY `/usage` → Plan/Add-on credits; stream-json `credits`/`original_credits` theo từng lượt | `--list-models` (15 model: Auto, Ultimate, Fast, Efficient, Qwen3.8-Max/Flash, DeepSeek-V4-Pro/Flash, GLM-5.3(-Flash), Kimi…) | **Hệ số xN theo model và khuyến mãi**: không lệnh không-tương-tác nào trả về. Phải scrape màn `/model` qua PTY (cần spike) và có catalog fallback |
| **AGY** 1.4.12 | PTY `/usage` + `/credits` → 5 bucket hạn mức (Gemini / Claude & GPT / Gemini 4 Argon × 5h / tuần), AI Credits | `agy models` (13 model, dạng `id<TAB>tên`) | Tên gói: thử đọc header `/usage`; nếu không có thì để `unknown` |
| **OpenCode** 2.2.5 | `auth list`, `stats --json --days 0` | `opencode models` (62 model, có tiền tố provider); `~/.config/opencode/opencode.json` (`limit.context` → nhãn "10M ctx"); **harbor-key**: `key-pool.json` + `GET http://127.0.0.1:20130/stats`, `:20131/stats` (mảng `{name,outputInWindow,requests,failures,status,percent,outputLimit,requestLimit,resetAt}`), `/health` | Số dư từ phía upstream. Lỗi hiện tại: `dashboard.ts` gọi `opencode` theo tên, nhưng máy này chỉ có `…\ai.opencode.desktop\resources\opencode-cli.exe` |

**Không được chạy** các lệnh `harbor-key.ps1 check/add/remove/reset…` (có lệnh gửi request thật lên upstream, có lệnh ghi file).
Chỉ dùng `list` hoặc HTTP `/stats`.

---

## 2. Hợp đồng dữ liệu v3 (T1 định nghĩa, các task sau dùng)

Thêm vào `DashboardCheck` trong `shared/dashboard.ts`. Mọi trường đều optional và giữ nguyên trường cũ:

```ts
type Tier = 'free' | 'trial' | 'plus' | 'pro' | 'team' | 'byok' | 'unknown';
interface PlanInfo { name: string; tier: Tier; renewsAt?: string | null; source: string }
interface CurrentModel { id: string; label: string; effort?: string | null }
interface ModelOffer {
  id: string; label: string; provider?: string | null;
  multiplier: number | null;          // 0 = miễn phí
  originalMultiplier?: number | null; // có giá trị khi đang giảm giá
  promo?: string | null;              // "Đang giảm", "-50%", "Miễn phí đến 10/11"
  contextTokens?: number | null;
  source: 'cli' | 'pty' | 'catalog' | 'config';
}
interface QuotaWindow {
  group: string; window: '5h' | 'day' | 'week' | 'month' | 'plan';
  remainingPct: number | null; used?: number | null; limit?: number | null;
  unit: 'tokens' | 'credits' | 'requests' | 'percent'; resetAt?: string | null;
}
interface KeyPool {
  name: string; total: number; ok: number; exhausted: number;
  remainingPct: number | null; limitLabel: string; resetAt?: string | null;
  keys: { label: string; status: 'ok' | 'low' | 'out'; pct: number | null }[]; // label đã mask
}
// DashboardCheck += plan?, currentModel?, models?, quotaWindows?, keyPools?, highlights?: string[]
```

Hàm thuần `rankPicks(tools): Pick[]` đặt ở `shared/dashboard-picks.ts`, dùng cho dải **"Nên dùng ngay"**. Quy tắc:
- Ưu tiên model miễn phí hoặc hệ số ≤0.1 thuộc tool đang `ready`.
- Sau đó đến tool có `min(remainingPct của các cửa sổ)` cao nhất.
- Thêm cảnh báo khi một cửa sổ dưới 25%, hoặc pool có key cạn.
- Mỗi pick có `reason` bằng tiếng Việt.

Quy ước UI (theo mockup):
- Thanh hạn mức luôn thể hiện **cửa sổ thấp hơn** (điểm nghẽn). Cửa sổ còn lại ghi nhỏ bên cạnh.
- Màu thanh: ≥50% xanh, 25–50% cam, dưới 25% đỏ.
- Badge tier: PLUS tím, PRO hồng, TRIAL cam, FREE xanh ngọc, BYOK xám.
- `null` nghĩa là "chưa có dữ liệu", **không bao giờ hiển thị thành 0**.

---

## 3. Chuỗi công việc

```
T0.1 Codex  Giảm dung lượng gói ────────────────────────────────────────────┐
T0.2 Codex  Nền tảng UI (lucide, tokens, sửa cascade) ─────────┐          │
T1   Codex  Hợp đồng v3 + tách parser theo agent + rankPicks ─┐ │          │
               ├─ T2 Qoder    Dữ liệu Qoder (/model, catalog) ─┤ │          │
               ├─ T3 OpenCode Dữ liệu OpenCode + harbor-key ───┼─┴─ T5 Qoder   ToolCard v3 + Dashboard
               └─ T4 Codex    Dữ liệu Codex + AGY ─────────────┘        └─ T6 OpenCode Dải "Nên dùng ngay" + chuỗi tiếng Việt
                                                                      T7 Qoder    Trang Tài nguyên & sử dụng
                                                                      T8 OpenCode E2E ảnh chụp + tài liệu 2.3.0
                                                                      T9 Codex    Tích hợp, build desktop, smoke CLI thật
```

Các nhóm chạy song song: {T0.1, T0.2, T1}, rồi {T2, T3, T4}, rồi {T5 → T6}, rồi {T7, T8}, rồi
chuỗi sửa phần còn lại của app {T10, T13} → T11 → T14 → T12 (mục 4b), **cuối cùng T9**.
Không có hai task nào cùng sửa một file. Lý do: T1 tách `server/dashboard-status.ts` thành
`server/dashboard/parsers/{codex,qoder,agy,opencode}.ts` để T2–T4 mỗi task sở hữu một file riêng.
Worktree mới chỉ chứa những gì **đã commit**, vì vậy leader phải merge xong nhóm trước rồi mới tạo task cho nhóm sau.

Vì sao chia như vậy:
- **Codex** nhận phần lõi: hợp đồng dữ liệu, build, tích hợp. Đây là phần cần suy luận nhiều nhất.
- **Qoder** làm UI, và làm luôn parser `/model` của chính Qoder vì nó hiểu màn hình của mình nhất.
- **OpenCode** chạy bằng pool key miễn phí, hợp với task có spec rõ: harbor-key, test, tài liệu, chuỗi giao diện.

### Lệnh leader (mẫu)

```powershell
$plan = (npm run -s fleet -- plan create "Dashboard v3" --repo "C:\Qoder\agent-fleet-upgrade" --base main --json | ConvertFrom-Json).id
npm run -s fleet -- run --plan $plan --agent codex    --title "T1 Hop dong dashboard v3" --brief docs/briefs/T1.md --check "npx tsc --noEmit && npx vitest run" --json
npm run -s fleet -- wait <taskId> --timeout 45m --json
npm run -s fleet -- diff <taskId> --stat
npm run -s fleet -- merge <taskId> --json
```

Các lưu ý khi giao task:
- Qoder chạy với `--permission-mode auto`.
- AGY nếu dùng phải có `--settings` allow lệnh check.
- OpenCode chạy `--standalone`, và `agents.opencode.bin` phải trỏ tới `opencode-cli.exe`.

Trước khi giao, mỗi brief bên dưới sẽ được copy thành `docs/briefs/Tn.md`.

---

## 4. Brief từng task

Áp dụng chung cho mọi task:
- Đọc `docs/codex-debug-playbook.md` trước khi bắt đầu.
- Không sửa file ngoài phạm vi được giao.
- Không chạy lệnh ghi cấu hình CLI và không đăng nhập/đăng xuất.
- Không đưa token hay API key vào log, fixture hoặc test. Fixture lấy từ máy thật phải được mask.
- Check bắt buộc: `npx tsc --noEmit` và `npx vitest run`. Task UI chạy thêm `npm run test:e2e`.

### T0.1 — Codex — Giảm dung lượng gói desktop
- File: `scripts/package-desktop.ps1`, `scripts/package-desktop.mjs`, `desktop/tsconfig.runtime.json` (thay bằng script esbuild nếu cần), `package.json` (thêm devDependency `esbuild`).
- Việc cần làm:
  - Bundle `server/main.ts` cùng `shared/` thành `app/server/main.js`. Để `@lydell/node-pty` ở dạng external và chỉ copy prebuild win32-x64.
  - Chỉ ship dependency runtime. Bỏ `react*`, `@xterm/*` (đã nằm trong `app/web`), `test/`.
  - Version trong tên zip đọc từ `package.json`.
- Xong khi:
  - `npm run desktop:build` chạy thành công.
  - `app/` dưới 15 MB, tổng gói dưới 115 MB. Báo cáo bảng kích thước trước và sau.
  - Smoke desktop: mở `AgentFleet.exe`, dashboard lên, mở được một terminal Codex.
  - `FleetRuntime.cs` vẫn tìm thấy `app/server/main.js`.

### T0.2 — Codex — Nền tảng UI
- File: `web/src/theme.css` (tách ra), `web/src/styles/tokens.css`, `web/src/styles/layout.css`, `web/src/components/Icon.tsx`, `web/src/App.tsx` (chỉ phần biến CSS inline), `package.json` (`lucide-react`).
- Việc cần làm:
  - Thêm token như trong `:root` của mockup.
  - `Icon.tsx` map tên hiện có sang lucide và giữ nguyên API `<Icon name>`.
  - `AgentMark` dùng chip có nền riêng.
  - Sửa cascade: biến `--sidebar-width` inline không được đè media rule. Cách sửa: chỉ đặt biến inline khi chiều rộng màn hình vượt breakpoint, hoặc dùng `clamp()` / `min()`.
  - Gộp các khối định nghĩa trùng (`.inspector`, `.topbar`, `.terminal-search`, `body`) và xoá selector chết.
- Xong khi:
  - Ảnh e2e hiện tại không khác biệt ngoài ý muốn.
  - Ở 375/768/1440 px không có cuộn ngang.
  - Logo Qoder và OpenCode đạt tương phản ≥3:1 trên theme tối.
  - Tổng CSS giảm ≥25%.

### T1 — Codex — Hợp đồng v3, tách parser, rankPicks
- File: `shared/dashboard.ts`, `shared/dashboard-picks.ts` (mới), `server/dashboard-status.ts` → `server/dashboard/parsers/*.ts` (giữ một file `index.ts` re-export để không vỡ import cũ), `server/dashboard.ts` (chỉ phần gọi parser), test tương ứng.
- Việc cần làm:
  - Thêm các type ở mục 2.
  - Chuyển logic parse hiện có sang 4 file parser, giữ nguyên hành vi.
  - Viết `rankPicks` kèm test bảng (table-driven).
  - Thêm config `dashboard.opencode.keyPoolConfig` (mặc định `~/.config/opencode/key-pool.json`).
  - Sửa cách resolve bin OpenCode: thử thêm `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`.
- Xong khi:
  - Toàn bộ test cũ trong `test/server/dashboard*.test.ts` vẫn pass mà không phải sửa expectation.
  - Có test mới cho `rankPicks`, tối thiểu 8 case: có model free, mọi tool đều cạn, tool chưa kiểm tra, có `null`…

### T2 — Qoder — Dữ liệu Qoder
- File: `server/dashboard/parsers/qoder.ts`, `server/terminal-status.ts` (chỉ nhánh qodercli), `server/model-catalog.ts` (mới), `server/adapters/__fixtures__/qodercli/model-picker.txt` (mới), test.
- Bước 1, spike tối đa 1 giờ:
  - Chạy `qodercli` trong PTY, gõ `/model`, chụp lại output thô (strip ANSI) để làm fixture.
  - Ghi vào `NOTES.md` xem màn này có hệ số xN hoặc nhãn khuyến mãi không.
  - Nếu **không có**, ghi rõ "không có" và chuyển sang bước 3. Không được đoán.
- Bước 2: parse `models[]` (label, multiplier, originalMultiplier, promo) và `plan` (từ `user_type` cùng `/usage`; `personal_professional_trial` → tier `trial`, name "Pro Trial"). Parse thêm `quotaWindows` dạng `plan` từ Plan Credits.
- Bước 3: `model-catalog.ts` đọc `<FLEET_DATA_DIR>/model-catalog.json` (người dùng tự sửa, có `verifiedAt`) để ghi đè hoặc bổ sung multiplier. Khi đó `source: 'catalog'` và UI ghi "theo catalog, cập nhật dd/mm".
- Xong khi:
  - Test với fixture pass.
  - Model nhận từ `--list-models` mà chưa có hệ số thì hiển thị `multiplier: null`.
  - Không còn chỗ nào hard-code giá.

### T3 — OpenCode — Dữ liệu OpenCode + harbor-key
- File: `server/dashboard/parsers/opencode.ts`, `server/key-pools.ts` (mới), test, fixture `test/fixtures/harbor-stats.json` (đã mask).
- Việc cần làm:
  - Đọc `key-pool.json` và chỉ lấy tên pool, port, giới hạn. **Không đọc biến môi trường chứa key.**
  - Gọi `GET http://127.0.0.1:<port>/stats` với timeout 1.5 s, và chỉ chấp nhận host loopback.
  - Map dữ liệu sang `KeyPool`. Tên key được mask thành `…ABCD` (4 ký tự cuối của *tên*, không phải giá trị key).
  - `models[]` lấy từ `opencode models`: tách provider bằng tiền tố trước `/`, `contextTokens` lấy từ `opencode.json`.
  - `plan.tier = 'byok'`.
  - Pool tắt: trả `keyPools[i].remainingPct = null` kèm lý do "pool không chạy". Không được coi đó là lỗi của cả tool.
- Xong khi:
  - Có test cho 3 trường hợp: pool chạy, pool tắt (ECONNREFUSED), JSON sai.
  - Không có request nào tới host khác loopback (có test khẳng định điều này).

### T4 — Codex — Dữ liệu Codex + AGY
- File: `server/dashboard/parsers/codex.ts`, `server/dashboard/parsers/agy.ts`, test, fixture.
- Codex:
  - `plan` lấy từ claim `chatgpt_plan_type`: decode phần payload của JWT bằng base64url, không verify, không gọi mạng. Chỉ giữ tên gói và bỏ mọi thứ khác.
  - `currentModel` đọc từ `config.toml` (`model`, `model_reasoning_effort`).
  - Map hạn mức 5h và tuần sang `quotaWindows`.
- AGY:
  - Map 5 bucket sang `quotaWindows`.
  - `models[]` lấy từ `agy models`.
  - `plan`: đọc từ header `/usage` nếu có, không có thì để `unknown`.
- Xong khi:
  - Có test chứng minh token không xuất hiện trong output (snapshot của `probes[].output` không chứa chuỗi `eyJ`).

### T5 — Qoder — ToolCard v3 + Dashboard
- File: `web/src/components/Dashboard.tsx`, `web/src/components/dashboard/*.tsx` (mới: `ToolCard`, `PlanStrip`, `QuotaMeter`, `ModelOfferList`, `KeyPoolGrid`, `CreditPanel`), `web/src/styles/dashboard.css`.
- Việc cần làm:
  - Bám theo mockup về bố cục và thứ tự ưu tiên thông tin. Thêm nút "Kiểm tra tất cả" (chạy tuần tự, có tiến độ).
  - Mỗi khối đều có đủ trạng thái loading (skeleton), chưa kiểm tra, lỗi (có nút thử lại) và `null`.
  - Danh sách model mặc định hiện 6 dòng, sắp theo multiplier tăng dần, `null` xếp cuối, mở rộng bằng `<details>`.
  - Thông báo thành công phải là toast xanh. Chuỗi giao diện bằng tiếng Việt.
- Xong khi:
  - Ảnh chụp 1440 px ở cả theme sáng và tối khớp tinh thần mockup.
  - Ở 375 px các thẻ xếp một cột, không cuộn ngang.
  - Có test component cho `QuotaMeter`: thanh luôn thể hiện cửa sổ thấp hơn, màu đúng ngưỡng.

### T6 — OpenCode — Dải "Nên dùng ngay" + chuỗi tiếng Việt
- File: `web/src/components/dashboard/PicksStrip.tsx`, `web/src/strings.ts` (mới, chỉ chuỗi của dashboard), test.
- Việc cần làm:
  - Gọi `rankPicks` và hiển thị tối đa 3 gợi ý cộng 1 cảnh báo.
  - Bấm vào một gợi ý: tool có `Mở CLI` thì mở luôn CLI; với gợi ý model thì copy lệnh `--model`.
- Xong khi: có test render cho 3 kịch bản.

### T7 — Qoder — Trang Tài nguyên & sử dụng
- File: `web/src/components/Inspector.tsx` (tách `UsagePage` ra `web/src/components/usage/UsagePage.tsx`), `web/src/styles/usage.css`.
- Việc cần làm:
  - KPI tile dùng chung style với dashboard.
  - Biểu đồ khi chưa có dữ liệu phải hiện trạng thái trống có hướng dẫn, không vẽ đường phẳng.
  - Bảng theo agent có badge tier và cột credit/hệ số.
  - Icon lucide.
- Xong khi: ảnh chụp ở trạng thái trống và có dữ liệu (fixture) đều đọc được ở cả hai theme.

### T8 — OpenCode — E2E + tài liệu
- File: `test/e2e/dashboard-v3.spec.ts` (mới), `test/e2e/fixtures/dashboard-checks.json`, `docs/releases/2.3.0.md`, `README.md` (phần dashboard).
- Việc cần làm:
  - Bơm fixture vào `<data>/dashboard-checks.json` trước khi khởi động server test.
  - Chụp ảnh ma trận 3 độ rộng × 2 theme cho Dashboard và Tài nguyên.
- Xong khi: `npm run test:e2e` pass và có ảnh trong `docs/images/2.3/`.

## 4b. Chuỗi sửa phần còn lại của app (T10–T14)

Các task này giải quyết những lỗi trong [`ui-ux-improvement-plan.md`](ui-ux-improvement-plan.md) mà Dashboard chưa đụng tới.
Chuỗi chỉ bắt đầu khi T0.2 (tokens, lucide) và T7 đã được merge.

Thứ tự chạy:
1. T10 và T13 chạy song song vì sửa các file khác nhau.
2. Sau đó tới T11.
3. Rồi tới T14, vì T14 cũng sửa `App.tsx` như T11.
4. Cuối cùng là T12. T12 chạm vào hầu hết component nên phải làm sau cùng để không gây conflict.

| Task | Agent | File sở hữu |
|---|---|---|
| T10 | Codex | `ConfirmDialog.tsx`, `TaskActions.tsx`, `TaskHeader.tsx` |
| T13 | Qoder | `TaskComposer.tsx`, `TerminalPage.tsx`, `TerminalPanel.tsx` |
| T11 | Qoder | `App.tsx` (vùng main/inspector), `LogView.tsx`, `DiffView.tsx`, `ComparePage.tsx`, `store.ts`, `Inspector.tsx` |
| T14 | Codex | `App.tsx` (topbar, nav), `Sidebar.tsx`, `CommandPalette.tsx` (mới) |
| T12 | OpenCode | `web/src/strings.ts` + chỉ phần chuỗi trong mọi component |

### T10 — Codex — Hộp xác nhận an toàn + nhóm hành động của task
- Lỗi cần xử lý: plan UI/UX #7, #11.
- ConfirmDialog:
  - Đóng được bằng Escape.
  - Giữ focus bên trong dialog; khi đóng, trả focus về nút đã mở dialog.
  - Focus ban đầu đặt vào nút **an toàn** (Huỷ bỏ).
  - Với thao tác destructive (discard, huỷ task, kết thúc phiên), bấm ra nền không đóng dialog.
  - Nút xác nhận ghi rõ hậu quả, ví dụ "Xoá worktree và thay đổi".
- TaskActions:
  - Nút chính (Merge / Dừng / Đánh dấu xong) đặt bên phải.
  - Huỷ task chuyển vào menu "⋯", hiển thị màu đỏ.
  - Nút bị khoá phải có `title` và tooltip ghi lý do, ví dụ "Check chưa pass" hoặc "Không có thay đổi".
  - "Mở terminal" trên task đang chạy đổi tên thành "Tiếp quản terminal", dialog nói rõ agent sẽ tạm dừng.
- Xong khi: có test Playwright cho Escape, Tab vòng trong dialog, trả focus, và việc bấm nền không đóng khi discard.

### T13 — Qoder — Hộp tạo task + Terminal
- Lỗi cần xử lý: plan UI/UX #3, mục 3.4 và 3.5.
- TaskComposer:
  - Sửa lỗi chữ dính "CLIKiểm tra" bằng flex + gap.
  - Chia thành 2 bước: Dự án → Giao việc.
  - Nhớ agent và plan đã chọn lần trước (localStorage, có try/catch).
  - Validate đường dẫn repo khi rời ô nhập (gọi API sẵn có, hoặc báo "không phải Git repo").
  - Ctrl+Enter để gửi.
  - Hiện trạng thái kiểm tra CLI của agent đã chọn bằng badge.
- Terminal:
  - Đổi nhãn "Đóng" thành "Ẩn" (tiến trình vẫn chạy) và "Kết thúc phiên" thành "Kết thúc tiến trình".
  - Tablist đúng ARIA (`role=tablist/tab`, đổi tab bằng mũi tên trái/phải, Home/End).
  - Nhớ cỡ chữ.
  - Socket lỗi thì hiện banner kèm nút "Kết nối lại".
  - Copy/Paste đổi thành Sao chép/Dán.
- Xong khi: có test cho việc chuyển bước của composer và Ctrl+Enter, test điều hướng tab bằng bàn phím, và ảnh chụp ở cả hai theme.

### T11 — Qoder — Trạng thái đang tải / lỗi + màn Công việc
- Lỗi cần xử lý: plan UI/UX #5, #6, #8, #12.
- `store.ts`: thêm cờ `loaded` và `error` cho tasks, log và diff. Lỗi tải log không được nuốt mất nữa (hiện `store.ts:372`).
- Trạng thái đang tải:
  - Thêm skeleton cho màn chào, Nhật ký và Thay đổi.
  - Badge "Diff (n)" chỉ hiện khi đã tải xong.
- ComparePage: khi lỗi thì hiện thông báo kèm nút thử lại; không được kẹt ở "Đang tải…".
- Màn Công việc khi chưa có task:
  - Ẩn inspector.
  - Hiện CTA kèm 3 bước "Chọn repo → Viết yêu cầu → Duyệt thay đổi".
- Inspector ở cửa sổ ≤1050 px:
  - Mặc định đóng, có nút đóng thật.
  - Icon trang trí ở `Inspector.tsx:37` phải đổi thành nút có chức năng, hoặc bỏ đi.
- Hàng log raw (`LogView.tsx:80`) đổi thành `<button>`.
- Xong khi: test giả lập API chậm (delay) và API lỗi xác nhận không còn hiện nội dung của trạng thái rỗng trong lúc đang tải.

### T14 — Codex — Thanh trạng thái, điều hướng, ô lệnh nhanh
- Lỗi cần xử lý: plan UI/UX #15, #16, mục 3.1 và 3.7.
- Topbar:
  - Chip lớn, bấm được: Đang chạy · Chờ duyệt · Lỗi.
  - Bấm chip thì Sidebar lọc task theo trạng thái đó.
  - Số task chờ duyệt hiện ở nav.
- Nav:
  - Thêm `aria-current="page"`.
  - Sửa `aria-label="Tasks"`.
  - Các tab Nhật ký / Thay đổi / Yêu cầu dùng đúng `role=tab`, chuyển bằng phím 1/2/3.
- Trạng thái trong Sidebar: thay ký hiệu Unicode (◐ ○ ⑂ ⏱) bằng icon lucide có `aria-label`.
- `CommandPalette.tsx`, mở bằng Ctrl+K, cho phép:
  - nhảy tới task,
  - tạo task,
  - mở CLI theo agent,
  - đổi theme,
  - đi tới từng màn hình.
- Xong khi: có test bàn phím cho palette (mở, lọc, Enter, Escape) và test lọc theo chip trạng thái.

### T12 — OpenCode — Thống nhất ngôn ngữ toàn app
- Lỗi cần xử lý: plan UI/UX #13, #14.
- Mở rộng `web/src/strings.ts` (do T6 tạo) ra mọi component.
- Glossary bắt buộc:

  | Hiện tại | Đổi thành |
  |---|---|
  | task / việc | công việc |
  | Log | Nhật ký |
  | Diff | Thay đổi |
  | Brief | Yêu cầu |
  | Local workspace | Máy cục bộ |
  | LIVE | Trực tiếp |
  | `file_edit`… | Sửa tệp… |

  Giữ nguyên tên agent, Git, Merge, CPU, RAM, GPU.
- Thống nhất tên trang: dùng "Tài nguyên & sử dụng" ở mọi nơi.
- Phiên bản ở `App.tsx:87` lấy từ `package.json` qua `define` của Vite.
- Chỉ đổi chuỗi, không đổi logic hay bố cục.
- Xong khi:
  - Có test quét toàn bộ `web/src/components` khẳng định không còn chuỗi trong danh sách cấm ("Task mới", "Copy", "Paste", "Log", "Brief", "Tasks").
  - Ảnh e2e không bị vỡ bố cục do chuỗi dài hơn.

### T9 — Codex — Tích hợp & phát hành (chạy sau T12)
- Việc cần làm:
  - Rebase hoặc gộp lại, chạy đủ check, `npm run desktop:build`.
  - Smoke trên 4 CLI thật: bấm "Kiểm tra tất cả" và lưu ảnh.
  - Sửa các lỗi tích hợp nhỏ. Lỗi lớn thì báo leader, không tự mở rộng phạm vi.
- Xong khi: có báo cáo gồm bảng check, kích thước gói và ảnh.

---

## 5. Leader review sau mỗi task
1. `fleet diff --stat`: kiểm tra task chỉ sửa đúng file được giao.
2. Đọc diff và tìm: secret, `catch {}` nuốt lỗi, giá trị hard-code, `null` bị hiển thị thành 0.
3. Chạy lại check tại máy leader. Với task UI, mở browser ở 3 độ rộng × 2 theme.
4. Nếu chưa đạt: `fleet retry <id> --note "<lỗi cụ thể + file:dòng>"`. Sau 2 lần retry vẫn hỏng thì chuyển task sang Codex.

## 6. Rủi ro
- **Màn `/model` của Qoder có thể không hiển thị hệ số.** Khi đó dùng catalog do người dùng sửa và UI ghi rõ nguồn.
- **Output PTY đổi theo version CLI.** Parser phải dựa vào marker; khi không khớp thì trả `null` kèm `reason`. Fixture cần ghi version.
- **harbor-key không chạy thì không có số liệu pool.** Hiển thị "pool không chạy" thay vì báo lỗi đỏ.
