# Agent Fleet — Thiết kế

Ngày: 2026-11-02 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Người dùng làm việc theo kiểu **một leader + nhiều agent**: một model leader (Claude hoặc model khác) lập kế hoạch rồi giao việc cho các coding-agent CLI (codex, qodercli, agy/Antigravity, opencode). Hiện tại không có chỗ nào để theo dõi tập trung: mỗi công cụ có giao diện riêng, không biết task nào đang chạy, kẹt hay xong, và không có số liệu để biết agent nào làm tốt hơn.

Agent Fleet là app chạy local trên Windows, gồm:

- một **CLI `fleet`** để leader giao việc, chờ kết quả, xem diff, merge (giống cách Claude gọi subagent);
- một **server** chạy agent headless, mỗi task trong một git worktree riêng, và lưu toàn bộ lịch sử;
- một **web UI** (localhost) để người dùng theo dõi trực tiếp, xem diff, tiếp quản bằng terminal thật, và so sánh các agent.

**Thành công khi:** người dùng mở một trang và thấy mọi task của mọi agent, biết task nào đang chạy, kẹt hay xong; leader giao và nhận kết quả hoàn toàn bằng lệnh shell; sau vài tuần sử dụng, trang so sánh cho biết agent nào làm tốt hơn với số liệu khách quan.

### Đã quyết định (cùng người dùng)

- Leader giao việc **qua app** (không phải người dùng giao tay, cũng không phải app tự có leader).
- Mỗi task có **một git worktree riêng**.
- UI có: trạng thái + log trực tiếp, diff, so sánh agent, nhóm theo plan.
- Cách xem: **kết hợp**. Mặc định chạy headless và hiện luồng sự kiện; có nút mở **terminal thật** để tiếp quản.
- **Tự xây**, không dùng công cụ có sẵn. Superset/Paradev chưa có bản Windows. Claw Orchestrator đã được thử: dashboard không hiện task giao qua CLI, không có worktree cho từng task, không hỗ trợ sẵn qodercli.

### Ngoài phạm vi (YAGNI)

- Nhiều người dùng, đăng nhập, chạy từ xa.
- App tự lập kế hoạch hay tự chọn agent (đó là việc của leader).
- MCP server: để sau, khi cần thì làm lớp mỏng bọc CLI.
- Đóng gói thành app desktop (Electron).

## 2. Kiến trúc

```
Leader (Claude / model khác) ──lệnh shell──▶ fleet CLI
                                               │ HTTP + token
                                               ▼
                              ┌──── Fleet server (Node 24) ────┐
                              │ Store (SQLite) + log JSONL     │
                              │ WorktreeManager (git)          │
                              │ Scheduler (hàng đợi, giới hạn) │
                              │ Runner ─▶ Adapters             │
                              │   codex | qodercli | agy |     │
                              │   opencode | fake (test)       │
                              │ PtyManager (node-pty)          │
                              └──────┬─────────────────────────┘
                                     │ WebSocket (sự kiện, trạng thái, pty)
                                     ▼
                           Web UI (React + Vite) ở 127.0.0.1:4500
```

- **Ngôn ngữ:** TypeScript cho toàn bộ dự án. Một repo, chia thư mục `server/`, `cli/`, `web/`, `shared/` (kiểu dữ liệu và sự kiện dùng chung).
- **Server** là một tiến trình duy nhất. `fleet` tự khởi động server nếu chưa chạy; muốn chạy thủ công thì dùng `fleet server`.
- **Thư mục dữ liệu:** `%LOCALAPPDATA%\agent-fleet\` chứa `fleet.db`, `logs\<run-id>.jsonl`, `worktrees\<repo-name>\<task-id>\`, `token`, `fleet.config.json`.

### Các đơn vị và trách nhiệm

| Đơn vị | Làm gì | Phụ thuộc |
|---|---|---|
| `Store` | CRUD plan / task / run / event trên SQLite; ghi và đọc log JSONL | — |
| `WorktreeManager` | Tạo worktree và nhánh, tính diff, merge, xoá worktree | git |
| `Adapter` (mỗi agent một file) | Dựng lệnh headless, phân tích output thành `FleetEvent`, dựng lệnh tương tác, kiểm tra sẵn sàng | — (thuần, dễ test) |
| `Runner` | Spawn tiến trình theo adapter, đọc stdout/stderr, phát sự kiện, xử lý timeout, kill, chạy `--check` | Adapter, Store |
| `Scheduler` | Hàng đợi, giới hạn chạy song song theo agent và toàn cục | Runner |
| `PtyManager` | Mở terminal thật trong worktree và nối với WebSocket | node-pty |
| `Api` | HTTP (cho CLI và UI) và WebSocket (đẩy sự kiện) | tất cả |
| `fleet` CLI | Client HTTP mỏng, in ra người đọc được hoặc `--json` | Api |
| Web UI | Chỉ để hiển thị và thao tác, không chứa logic nghiệp vụ | Api |

## 3. Adapter

```ts
interface AgentAdapter {
  id: 'codex' | 'qodercli' | 'agy' | 'opencode' | 'fake';
  detect(cfg): Promise<{ ok: boolean; version?: string; reason?: string }>; // dùng cho fleet doctor
  headless(input: { brief: string; cwd: string; resumeSession?: string }): { cmd: string; args: string[]; env?: Record<string,string>; stdin?: string };
  parse(line: string, stream: 'stdout' | 'stderr'): FleetEvent[];          // dòng không hiểu → raw
  interactive(input: { cwd: string; session?: string }): { cmd: string; args: string[] };
}
```

Brief được truyền qua stdin hoặc file tạm khi CLI hỗ trợ, để tránh giới hạn độ dài và lỗi escape trên Windows.

| Agent | Lệnh headless (dự kiến, xác minh ở bước probe) | Lệnh tương tác |
|---|---|---|
| codex | `codex exec --json --full-auto -C <wt> -` (brief qua stdin) | `codex resume <session>` hoặc `codex` |
| qodercli | `qodercli -p <brief> -o stream-json -w <wt> --permission-mode <auto>` | `qodercli` (cwd = wt) |
| agy | chưa rõ cờ headless, xác minh ở bước probe (spike Claw đã chạy được agy headless) | `agy` (cwd = wt) |
| opencode | `opencode run --format json <brief>` (cwd = wt) | `opencode` |
| fake | `node fake-agent.js <scenario>` | — |

**Bước probe (bắt buộc trước khi viết adapter):** chạy từng CLI đã cài với một brief mẫu trong repo tạm, lưu nguyên stdout/stderr vào `server/adapters/__fixtures__/<agent>/`. Parser được viết và test dựa trên các fixture này. Cờ nào sai so với bảng trên thì sửa lại theo thực tế.

**Cấu hình** `fleet.config.json` (tự tạo khi chạy lần đầu, dò exe trong PATH và các đường dẫn đã biết):

```json
{
  "port": 4500,
  "agents": {
    "codex":    { "bin": "C:\\...\\codex.exe",    "maxParallel": 2, "extraArgs": [] },
    "qodercli": { "bin": "C:\\...\\qodercli.exe", "maxParallel": 2, "extraArgs": [] },
    "agy":      { "bin": "C:\\...\\agy.exe",      "maxParallel": 2, "extraArgs": [] },
    "opencode": { "bin": null }
  },
  "maxParallelTotal": 4,
  "timeouts": { "totalMin": 30, "idleMin": 10 }
}
```

Agent có `bin: null` hoặc không qua được `detect` thì hiện "chưa cài" trên UI. `fleet run` với agent đó báo lỗi ngay.

### Sự kiện chung

```ts
type FleetEvent =
  | { kind: 'message'; text: string }                        // agent nói / suy nghĩ
  | { kind: 'command'; cmd: string; exitCode?: number; output?: string }
  | { kind: 'file_edit'; path: string; added?: number; removed?: number }
  | { kind: 'tool'; name: string; detail?: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { kind: 'session'; id: string }                          // để resume trong terminal
  | { kind: 'error'; text: string; category?: 'quota' | 'auth' | 'agent' | 'system' }
  | { kind: 'raw'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'status'; status: RunStatus; note?: string }      // do Runner phát
  | { kind: 'check'; cmd: string; passed: boolean; output: string };
```

Mỗi sự kiện được lưu kèm `runId`, `seq` và `ts`.

## 4. Mô hình dữ liệu và vòng đời

- **Plan** `{id, name, repoPath, baseBranch, createdAt}`: nhóm các task của cùng một kế hoạch trên một repo.
- **Task** `{id, planId, title, agent, status, branch, worktreePath, checkCmd?, createdAt, finishedAt?}`. `id` ngắn và dễ đọc, ví dụ `t-7k2f`.
- **Run** `{id, taskId, attempt, agent, brief, note?, status, exitCode?, startedAt, endedAt?, durationMs?, checkPassed?, inputTokens?, outputTokens?, costUsd?, finalMessage?, errorCategory?}`: mỗi lần chạy (lần đầu hoặc retry) là một run.

```
queued → running → done ─┬─▶ merged
            │      failed ┼─▶ retry → (run mới, cùng worktree) queued …
            │   timeout ──┤
            │ interrupted ┘─▶ discarded (xoá worktree, giữ lịch sử)
            └─▶ taken_over (người dùng mở terminal tiếp quản; bấm "Đánh dấu xong" → done)
```

- **Trạng thái của task** lấy theo run mới nhất. Riêng `merged` và `discarded` là trạng thái cuối, gắn với task.
- **Worktree:** nhánh `fleet/<plan-slug>/<task-id>` tạo từ `baseBranch` (mặc định là nhánh hiện tại của repo lúc tạo plan, ghi đè được bằng `--base`).
- **Kết thúc một run:** `done` khi mã thoát bằng 0. Nếu có `checkCmd` thì chạy nó trong worktree và ghi `checkPassed`; check fail vẫn để run ở trạng thái `done`, kèm `checkPassed=false`, để leader tự quyết retry hay sửa tay. Mã thoát khác 0 thì run là `failed`.
- **Kết quả trả cho leader:** `finalMessage` (câu trả lời cuối của agent), danh sách file đổi kèm diff stat (so với `baseBranch`), `checkPassed`, thời gian, chi phí.
- **Merge:** `git merge --no-ff` nhánh task vào `baseBranch` ngay trong repo gốc. Trước khi merge phải commit mọi thay đổi trong worktree với message `fleet: <title>`. Nếu repo gốc đang có thay đổi chưa commit hoặc không đứng trên `baseBranch` thì từ chối và báo lý do. Nếu bị conflict thì `git merge --abort`, giữ worktree và trả danh sách file conflict.

## 5. CLI cho leader

Mọi lệnh đều có `--json`. Mã thoát khác 0 khi có lỗi.

```
fleet plan create <name> --repo <path> [--base <branch>]        → plan id
fleet plan list
fleet run --plan <p> --agent <a> --title <t> (--brief <file> | --brief-text <s>) [--check <cmd>]
                                                                 → task id (trả về ngay)
fleet wait <id...> [--timeout 30m]   → chờ đến khi task rời trạng thái queued/running; in kết quả
fleet result <id>                    → kết quả run mới nhất
fleet log <id> [--tail 50] [--follow]
fleet diff <id> [--stat]
fleet retry <id> [--agent <a>] --note <s>   → run mới trong cùng worktree; brief = brief gốc + ghi chú
fleet stop <id>
fleet merge <id>      fleet discard <id>
fleet list [--plan <p>] [--status running]
fleet doctor          → kiểm tra từng agent và cấu hình
fleet ui              → mở trình duyệt
fleet server          → chạy server ở foreground
```

## 6. Web UI

Theo mockup đã duyệt:

- **Thanh trên:** tab `Tasks` / `So sánh agent`, tổng số task đang chạy, chờ và xong.
- **Cột trái:** các plan, nhóm theo repo, mỗi plan có thanh tiến độ (số task đã merge hoặc xong trên tổng số). Danh sách task có biểu tượng trạng thái và agent.
- **Chi tiết task:** tiêu đề, badge trạng thái kèm thời gian chạy, agent, lần thử thứ mấy, tên nhánh. Gồm các tab:
  - `Log`: sự kiện trực tiếp, tô màu theo `kind`, tự cuộn xuống (tạm dừng cuộn khi người dùng kéo lên). Dòng `raw` mặc định thu gọn.
  - `Diff`: danh sách file kèm diff từng file.
  - `Brief`: brief gốc và ghi chú của từng lần retry.
  - Có bộ chọn run (lần 1, 2, …) để xem lại lịch sử.
- **Nút:** `Mở terminal` (xterm.js, cwd là worktree; nếu có `session` thì dùng lệnh resume của adapter; mở terminal khi task đang chạy sẽ dừng run headless trước và hỏi xác nhận), `Dừng`, `Đánh dấu xong` (khi đang `taken_over`). Merge và discard có trên UI nhưng phải xác nhận.
- **Trang so sánh agent:** mỗi agent một dòng, gồm số run, tỉ lệ thành công (`done` và check pass nếu có check), thời gian trung bình, tỉ lệ task phải retry, tỉ lệ task được merge, tổng chi phí nếu có. Lỗi loại `quota` và `auth` **không tính** vào tỉ lệ thất bại. Lọc được theo repo và khoảng thời gian.
- Có chế độ sáng/tối. Không cần tải lại trang: mọi thay đổi đến qua WebSocket.

## 7. Xử lý lỗi

| Tình huống | Cách xử lý |
|---|---|
| Exe không có, hoặc CLI chưa đăng nhập | `detect` thất bại → `fleet run` báo lỗi ngay. Nếu lỗi đăng nhập chỉ lộ ra lúc chạy thì adapter phân loại `auth` |
| Agent treo hoặc chờ nhập liệu | Quá `totalMin`, hoặc quá `idleMin` không có sự kiện → kill cả cây tiến trình (`taskkill /PID <pid> /T /F`), run thành `timeout`, UI gợi ý mở terminal |
| Quota hoặc rate limit | Adapter phân loại `quota`; không tính vào số liệu thất bại của agent |
| Server tắt giữa chừng | Khi khởi động lại, run đang `running` mà PID đã chết thì chuyển thành `interrupted`. Log đã ghi vẫn còn |
| Tạo worktree lỗi | `fleet run` trả lỗi, không tạo task |
| Merge conflict / repo gốc chưa sạch | Như mục 4: từ chối hoặc abort, giữ worktree, báo chi tiết |
| Đường dẫn Windows | Mọi đường dẫn đưa cho git và CLI đều chuẩn hoá bằng `path.win32`; luôn đặt trong dấu ngoặc kép; dùng UTF-8 |
| Bảo mật | Server chỉ nghe trên `127.0.0.1`. Mọi request HTTP/WS phải có token (trong `%LOCALAPPDATA%\agent-fleet\token`). `fleet ui` mở URL kèm token một lần, rồi chuyển token sang cookie HttpOnly |

## 8. Kiểm thử

- **Unit (Vitest):** parser của từng adapter test trên fixture thật từ bước probe; logic trạng thái; tính số liệu so sánh.
- **Tích hợp:** dùng `fake` adapter (`fake-agent.js` phát sự kiện theo kịch bản: thành công, lỗi, treo, ra quota, sửa file) trên repo git tạm. Phủ các luồng run, wait, retry, stop, timeout, merge (cả trường hợp conflict), discard, khởi động lại server.
- **UI:** smoke test bằng Playwright: task mới xuất hiện, log tự cập nhật, diff hiện đúng, mở được terminal.
- **Nghiệm thu thủ công:** với mỗi agent đã cài (codex, qodercli, agy), giao một task thật trên repo sandbox bằng `fleet run`, theo dõi trên UI, `fleet wait`, `fleet merge`.

## 9. Rủi ro

- **Định dạng output của các CLI có thể thay đổi** khi cập nhật. Giảm thiểu: dòng không hiểu vẫn giữ dưới dạng `raw`, nên log không mất; fixture giúp phát hiện sớm.
- **Cờ headless của agy chưa rõ.** Nếu agy không có chế độ headless ổn định, adapter agy chỉ hỗ trợ chế độ terminal, và task agy sẽ ở trạng thái `taken_over` cho đến khi người dùng đánh dấu xong.
- **node-pty trên Windows cần build native.** Phải kiểm tra cài đặt ngay ở task đầu của plan.
