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
Mã thoát của `wait` là 0 khi mọi task `done`, 1 trong các trường hợp còn lại.
`done` chỉ cho biết agent thoát thành công; luôn đọc `run.checkPassed` vì check
thất bại vẫn có thể đi kèm trạng thái `done`.

Nếu chưa đạt, gửi ghi chú cụ thể rồi đợi và review lại:

```powershell
fleet retry $task.id --note "Bổ sung xử lý file rỗng và chạy lại npm test" --json
fleet wait $task.id --timeout 30m --json
fleet result $task.id --json
fleet diff $task.id
```

Retry tạo lần chạy mới trong cùng worktree, giữ brief gốc và thêm ghi chú.
Có thể đổi agent: `fleet retry <id> --agent qodercli --note "Sửa lỗi còn lại" --json`.

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
