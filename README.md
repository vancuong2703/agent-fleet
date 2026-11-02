# Agent Fleet

Agent Fleet là ứng dụng local cho Windows giúp một model leader giao việc cho
các coding agent `codex`, `qodercli`, `agy`, `opencode`. Mỗi task có git worktree
riêng; CLI `fleet` dùng để giao việc, chờ kết quả, xem diff, retry, merge hoặc huỷ.
Web UI hiển thị task theo plan, log trực tiếp, diff, terminal tiếp quản và số liệu
so sánh agent. Leader quyết định việc cần làm và review trước khi merge.

## Cài đặt và mở ứng dụng

Cần Windows 11, Node.js 24, Git và ít nhất một agent CLI đã cài, đăng nhập sẵn.
Trong thư mục dự án:

```powershell
npm install
npm run build:web
npm link
fleet doctor
fleet ui
```

`npm link` đưa lệnh `fleet` vào PATH. CLI tự khởi động server khi cần;
`fleet server` chạy server ở foreground. Server chỉ nghe trên `127.0.0.1`,
mặc định cổng `4500`. `fleet ui` mở URL xác thực, sau đó token được lưu vào
cookie HttpOnly để UI truy cập HTTP và WebSocket.

Xem [hướng dẫn leader](docs/leader-guide.md) để có quy trình giao việc và mẫu brief
có thể dán vào CLAUDE.md / AGENTS.md.

## Dữ liệu và cấu hình

Mặc định dữ liệu nằm ở `%LOCALAPPDATA%\agent-fleet\`:

- `fleet.db`: lịch sử plan, task và các lần chạy.
- `logs\`: sự kiện JSONL; `briefs\`: brief UTF-8 của từng lần chạy.
- `worktrees\`: worktree riêng của từng task.
- `token`: token truy cập local; `server.pid`: PID server.
- `fleet.config.json`: cấu hình, tự tạo và dò executable khi chạy lần đầu.

Đổi thư mục dữ liệu trước khi chạy CLI/server bằng PowerShell:

```powershell
$env:FLEET_DATA_DIR = "C:\du-lieu\agent-fleet"
fleet doctor
fleet ui
```

Ví dụ `fleet.config.json` (điền đường dẫn executable thực tế cho agent đã cài):

```json
{
  "port": 4500,
  "agents": {
    "codex": { "bin": "C:\\tools\\codex.exe", "maxParallel": 2, "extraArgs": [] },
    "qodercli": { "bin": null, "maxParallel": 2, "extraArgs": [] },
    "agy": { "bin": null, "maxParallel": 2, "extraArgs": [] },
    "opencode": { "bin": null, "maxParallel": 2, "extraArgs": [] }
  },
  "maxParallelTotal": 4,
  "timeouts": { "totalMin": 30, "idleMin": 10 }
}
```

| Trường | Ý nghĩa |
| --- | --- |
| `port` | Cổng HTTP/WebSocket, mặc định `4500`. |
| `agents.<id>.bin` | Đường dẫn executable; `null` nghĩa là chưa cài/không dùng. |
| `agents.<id>.maxParallel` | Số task chạy đồng thời tối đa của agent, mặc định `2`. |
| `agents.<id>.extraArgs` | Mảng tham số bổ sung truyền cho agent. |
| `maxParallelTotal` | Tổng số task chạy đồng thời, mặc định `4`. |
| `timeouts.totalMin` | Giới hạn thời gian một lần chạy, mặc định `30` phút. |
| `timeouts.idleMin` | Giới hạn thời gian không có output, mặc định `10` phút. |

Thiếu trường thì dùng mặc định; `bin` bị thiếu được dò trong PATH và các vị trí
cài đặt đã biết. Sau khi đổi cấu hình, khởi động lại server để áp dụng đầy đủ.
Agent `fake` dành cho kiểm thử, không cần mục cấu hình và không gọi agent thật.

## Phát triển và kiểm thử

```powershell
npm run dev:server
npm run dev:web
```

Vite dùng proxy tới server mặc định ở `127.0.0.1:4500`. Để kiểm tra:

```powershell
npx vitest run
npx tsc --noEmit
npx playwright install chromium
npm run test:e2e
```

E2E tự build `web/dist`, chạy server thật ở cổng `4610` với dữ liệu và repo Git
tạm, dùng agent `fake` rồi dọn dữ liệu. Cổng `4610` phải trống; E2E không tái sử
dụng server đang chạy. Nghiệm thu bằng agent thật do leader thực hiện riêng.
