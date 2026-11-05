# Hướng dẫn cho leader dùng Agent Fleet

Có thể dán toàn bộ nội dung này vào CLAUDE.md hoặc AGENTS.md của leader.

## Khi nào dùng fleet

Dùng fleet để giao các phần việc có phạm vi rõ, tiêu chí kiểm tra cụ thể và có thể
làm độc lập cho coding agent. Leader chịu trách nhiệm chia task, chọn agent,
đọc kết quả, review diff và quyết định merge. Các agent: `codex`, `qodercli`,
`agy`, `opencode`. Mỗi task chạy trong một git worktree riêng.

Không giao đồng thời các task phụ thuộc vào thay đổi chưa merge của nhau.
Chạy `fleet doctor` để kiểm tra agent đã cài và sẵn sàng; dùng `fleet ui` để
theo dõi task, log, diff, terminal và so sánh agent.

## Khi không kết nối được

Nếu CLI báo `Fleet server did not become healthy`, kiểm tra theo thứ tự:

1. Giữ app đang mở và sao chép lại phần kết nối hiện tại từ app. Cổng có thể
   thay đổi sau khi mở lại; chạy lại cả dòng `FLEET_DATA_DIR` và hàm `fleet`
   trong đúng cửa sổ PowerShell đang dùng.
2. Kiểm tra HTTP bằng `Invoke-RestMethod http://127.0.0.1:<cổng-trong-app>/api/health`
   (thay phần `<cổng-trong-app>` bằng cổng vừa sao chép). Kết quả cần có `ok: true`.
3. Nếu báo lỗi quyền truy cập socket, kiểm tra quyền kết nối loopback của môi
   trường chạy agent, hoặc thử lệnh trong PowerShell thông thường. Đây chưa phải
   bằng chứng server bị lỗi. Không tắt bảo vệ hệ thống để thử kết nối.
4. Chạy lại `fleet plan list --json`, `fleet list --json` rồi `fleet doctor`.
   Nếu vẫn lỗi, báo lại URL, lệnh và thông báo lỗi; không sao chép token hay nội
   dung file cấu hình chứa thông tin xác thực.

Đoạn kết nối mới đặt `FLEET_SERVER_URL` để ghim đúng app đang mở. Trong chế độ
này CLI không tự khởi động server khác khi kết nối thất bại. Không xoá biến này
để thử né lỗi; sao chép lại kết nối từ đúng app.

Nếu chạy CLI từ ứng dụng Windows có chuyển hướng AppData, cấu hình và token đọc
được có thể thuộc bản sao khác với app desktop. `FLEET_TOKEN_FILE` cho phép chỉ
định file token của đúng hồ sơ, chỉ truyền đường dẫn, không truyền giá trị token.
Ví dụ trên máy có quyền truy cập administrative share cục bộ:

```powershell
$env:FLEET_TOKEN_FILE = '\\localhost\C$\Users\<user>\AppData\Local\AgentFleetDesktop\token'
```

Đường dẫn này chỉ dùng đọc xác thực cho CLI; không đặt `FLEET_DATA_DIR` của
server lên network share. Xác nhận `fleet plan list --json` thành công trên URL
đã ghim trước khi giao task. Khi đổi sang hồ sơ khác, cập nhật hoặc xoá biến
`FLEET_TOKEN_FILE` đang có để tránh dùng xác thực của phiên trước.

### Kiểm tra đúng phiên: `fleet connection`

Đoạn kết nối còn đặt `FLEET_SERVER_INSTANCE` (mã phiên của server đang mở). CLI
chỉ gửi token tới listener trả về `service: agent-fleet` đúng mã phiên đó. Nếu
thấy `expected instance X, got Y`, bạn đang nói chuyện với phiên Fleet khác:
sao chép lại khối kết nối từ app, không sửa biến bằng tay.

`fleet connection [--json]` in URL, `instanceId`, có ghim hay không, đường dẫn
file token (không bao giờ in giá trị token) và gọi thử một API cần xác thực.
Đây là bước đầu tiên trong khối kết nối, trước `fleet plan list`.

### Lỗi 401: token không khớp (AppData bị chuyển hướng)

Ứng dụng đóng gói (MSIX) có thể ảo hoá `%LOCALAPPDATA%` thành
`%LOCALAPPDATA%\Packages\<pfn>\LocalCache\Local`, nên CLI đọc nhầm bản sao
token. Khi gặp 401, CLI liệt kê các bản sao dạng
`Packages\*\LocalCache\Local\<đường dẫn hồ sơ>\token`, nêu tên file đã tìm thấy
(chỉ đường dẫn) và in sẵn dòng PowerShell cần chạy, ví dụ:

```powershell
$env:FLEET_TOKEN_FILE = '\\localhost\C$\Users\<user>\AppData\Local\agent-fleet\token'
```

### Cơ sở dữ liệu: `fleet db`

Các lệnh làm việc trực tiếp trên `fleet.db` (offline), bản sao lưu nằm trong
`<thư mục dữ liệu>\backups`:

- `fleet db check` chạy kiểm tra toàn vẹn; thoát mã 1 nếu hỏng.
- `fleet db backup` sao chép database vào `backups` và in đường dẫn.
- `fleet db repair --yes` sao lưu trước, thử lần lượt REINDEX, tạo lại chỉ mục, dựng lại từ bảng, kiểm tra lại rồi in số dòng
  của từng bảng. Thiếu `--yes` thì chỉ in các bước sẽ làm và thoát mã 1. Lệnh
  từ chối chạy khi có server đang trả lời healthy ở URL đã cấu hình hoặc đã
  ghim: đóng app (hoặc `fleet server stop`) trước.

Nếu server không khởi động được, `<thư mục dữ liệu>\startup-error.json` ghi
nguyên nhân và gợi ý (CLI cũng hiển thị khi quá thời gian chờ). Mã `db_corrupt`
nghĩa là database không qua integrity_check: dùng `fleet db repair --yes`, hoặc
chọn "Sao lưu rồi sửa database" trong app desktop.

## Quy trình giao việc (PowerShell)

Tạo plan trên repo cần sửa; `--base` là nhánh nhận thay đổi:

```powershell
$plan = fleet plan create "Sửa trình soạn thảo" --repo "C:\du-an\repo" --base main --json | ConvertFrom-Json
```

Viết brief vào file UTF-8, ví dụ `C:\du-an\brief-editor.md`, theo mẫu:

```markdown
## Mục tiêu
Mô tả hành vi cần có và vấn đề cần giải quyết.
## File liên quan
Liệt kê file cần đọc, file được sửa và mã hiện có cần tái sử dụng.
## Tiêu chí hoàn thành
Nêu kết quả quan sát được, trường hợp biên và giới hạn phạm vi.
## Lệnh kiểm tra
npm test
## Ràng buộc
Không commit. Chỉ sửa trong phạm vi task, giữ thay đổi để leader review.
Báo cáo file đã sửa, kiểm tra đã chạy và hạn chế còn lại.
```

Giao task; `run` trả về ngay, không đợi agent hoàn thành:

```powershell
$task = fleet run --plan $plan.id --agent codex --title "Sửa editor" --brief "C:\du-an\brief-editor.md" --check "npm test" --json | ConvertFrom-Json
fleet wait $task.id --timeout 30m --json
fleet result $task.id --json
fleet diff $task.id --stat
fleet diff $task.id
```

Worktree mới chỉ chứa file đã commit: không có `node_modules`, `.env` hay thư mục build.
Nếu lệnh check cần dependency, cho nó tự cài (ví dụ `--check "npm ci && npm test"`)
hoặc ghi trong brief để agent cài trước khi làm.

Chọn agent khác bằng `--agent qodercli`, `--agent agy` hoặc `--agent opencode`.
Có thể chờ nhiều task: `fleet wait <id1> <id2> --timeout 30m --json`.
`wait` hết hạn có thể trả về task còn chạy; đọc `task.status` trước khi hành động.
Mã thoát của `wait` là 0 khi mọi task `done`, không có lỗi agent và không có
check thất bại; 1 trong các trường hợp còn lại. Từ bản 1.1.0, lỗi agent hoặc
check thất bại chuyển task sang `failed`, kể cả agent thoát với mã 0. Dữ liệu
trước 1.1.0 có thể vẫn là `done` kèm check thất bại: luôn đọc `run.checkPassed`
và `run.errorCategory`. Check PASS không thay thế việc review kết quả.

Nếu chưa đạt, gửi ghi chú cụ thể rồi đợi và review lại:

```powershell
fleet retry $task.id --note "Bổ sung xử lý file rỗng và chạy lại npm test" --json
fleet wait $task.id --timeout 30m --json
fleet result $task.id --json
fleet diff $task.id
```

Retry tạo lần chạy mới trong cùng worktree, giữ brief gốc và thêm ghi chú.
Có thể đổi agent: `fleet retry <id> --agent qodercli --note "Sửa lỗi còn lại" --json`.

## AGY và quyền chạy lệnh

Fleet mặc định gọi AGY bằng `--mode accept-edits`: agent có thể sửa file,
nhưng một số lệnh cần người dùng duyệt. Chế độ headless không hiện được hộp hỏi
nên AGY có thể từ chối lệnh rồi vẫn thoát 0. Fleet nhận diện trường hợp này là
`failed`, `errorCategory: permission`; log giữ nguyên thông báo bị từ chối.
Check độc lập của fleet có thể PASS trong khi agent vẫn bị lỗi quyền.

Để duyệt tương tác, mở `fleet ui`, chọn task, bấm **Mở terminal** để tiếp tục
phiên cũ. Nếu task còn chạy, dừng agent qua luồng tiếp quản trước khi thao tác.
Sau khi xử lý quyền, retry để fleet chạy lại brief và check, ghi nhận kết quả mới.

Để chạy headless, người vận hành có thể cấp trước đúng lệnh qua cấu hình AGY.
Ví dụ cho `node check.cjs`, ghép phần này vào mục `agents.agy` trong
`%LOCALAPPDATA%\agent-fleet\fleet.config.json`, giữ nguyên `bin` và các trường khác:

```json
{
  "extraArgs": [
    "--settings",
    "{\"permissions\":{\"allow\":[\"command(node check.cjs)\"]}}"
  ]
}
```

Đây là ví dụ cấu hình, không tự được bật khi nâng cấp. Chỉ thêm lệnh đã được
phép; cấu hình `extraArgs` áp dụng cho mọi task AGY dùng server đó. Khởi động
lại fleet server để nạp cấu hình. Không cần bật bỏ qua toàn bộ kiểm tra quyền.

## Checklist trước khi merge

- Task đã dừng chạy, kết quả đáp ứng mọi tiêu chí trong brief.
- Đã đọc `finalMessage`, danh sách file và toàn bộ diff; không có thay đổi ngoài phạm vi.
- `checkPassed` là `true`; nếu chưa có check, đã chạy kiểm tra phù hợp và đọc kết quả.
- Đã kiểm tra trường hợp biên, lỗi hồi quy và các task phụ thuộc.
- Repo gốc sạch và đang ở đúng `baseBranch` của plan.

Sau khi review đạt, merge qua fleet:

```powershell
fleet merge $task.id --json
```

Fleet tự commit thay đổi của worktree rồi merge vào nhánh gốc. Nếu repo bẩn,
sai nhánh hoặc có conflict, đọc lý do, giải quyết nguyên nhân rồi review lại;
không coi merge thất bại là hoàn tất.

Nếu bỏ kết quả, xoá worktree và nhánh task (lịch sử vẫn được giữ):

```powershell
fleet discard $task.id --json
```

Chẩn đoán: `fleet list --plan <plan-id> --json`, `fleet log <task-id> --follow`,
`fleet stop <task-id>`. Task cần tiếp quản: mở UI, chọn task, bấm **Mở terminal**;
nếu đang chạy, xác nhận dừng agent trước khi thao tác.

## Sao lưu và chẩn đoán khởi động

- Mỗi lần khởi động, server chạy `PRAGMA integrity_check`; nếu tốt và bản sao lưu mới nhất đã quá 24 giờ thì tạo
  `backups/fleet-<thời điểm>.db` (giữ 5 bản). Bản sao trước khi sửa nằm ở `backups/repair-<thời điểm>.db`.
- Khi khởi động thất bại, server ghi `startup-error.json` (nguyên nhân, hướng xử lý, log đã che thông tin nhạy cảm).
  App Desktop và CLI hiển thị nội dung này; file tự xoá sau lần khởi động thành công.
- `timeouts.networkMin` (mặc định 5, đặt 0 để tắt) dừng task khi lệnh mạng như `curl` treo. Chỉ có hiệu lực với
  Codex và Qoder; Antigravity và OpenCode không báo lệnh trước khi chạy xong nên vẫn dựa vào `idleMin`/`totalMin`.
  Trong brief nên yêu cầu agent đặt timeout cho mọi lệnh tải mạng.
