# Agent Fleet Desktop

Bản **2.5.0** xây lại toàn bộ UI theo bản OpenCode: khung điều hướng, Dashboard,
Jobs hai cột, Terminal, Compare, Resources và trang chi tiết từng công cụ.
Có EN/VI, giấy ấm/trắng thuần, sáng/tối và **Hướng dẫn leader** để sao chép
kết nối cùng quy trình giao việc vào hội thoại.
Xem [ghi chú 2.5.0](docs/releases/2.5.0.md) và [kế hoạch nền tảng](docs/dashboard-v3-plan.md).

Agent Fleet là ứng dụng local cho Windows giúp một model leader giao việc cho
các coding agent `codex`, `qodercli`, `agy`, `opencode`. Mỗi công việc có git worktree
riêng; CLI `fleet` dùng để giao việc, chờ kết quả, xem thay đổi, retry, merge hoặc huỷ.
Web UI hiển thị công việc theo plan, nhật ký trực tiếp, thay đổi, terminal tiếp quản và số liệu
so sánh agent. Leader quyết định việc cần làm và review trước khi merge.

## Mở ứng dụng Windows

Đóng bản cũ rồi mở [AgentFleet.exe](dist/AgentFleet-2.5.0/AgentFleet.exe), hoặc giải nén toàn bộ
[AgentFleet-2.5.0-win-x64.zip](dist/AgentFleet-2.5.0-win-x64.zip) rồi mở `AgentFleet.exe`. Giữ thư mục `app/`
và `runtime/` cạnh EXE. Bản portable mặc định đã kèm Node và .NET; không cần mở
CMD hoặc trình duyệt riêng. Máy cần Windows 11 x64, WebView2, Git và agent CLI
đã cài/đăng nhập để giao việc cho agent thật.

**Bảng điều khiển** chia thành bốn vùng CLI liền nhau: gói, vòng hạn mức,
credit Qoder, ma trận AGY và pool OpenCode. Bấm **Chi tiết** để xem model,
giá catalog, lệnh kiểm tra và mở CLI. **Kiểm tra tất cả** chạy tuần tự;
app không tự kiểm tra tài khoản khi mở màn hình. Giá trị thiếu giữ là “—”,
không đổi thành 0 hay suy ra hạn mức tổng từ nhiều bucket credit.

**Terminal** có danh sách CLI và các tab phiên. Chuyển tab/màn hình hoặc ẩn
terminal giữ nguyên tiến trình và lịch sử. Có chỉnh cỡ chữ, tìm kiếm,
sao chép/dán và kết nối lại. Terminal giữ màu ANSI của CLI ở cả hai theme.

Vào **Công việc** → **Công việc mới** để chọn/tạo dự án Git và giao việc.
Danh sách nằm bên trái; bên phải là **Nhật ký**, **Thay đổi**, **Yêu cầu**,
hành động duyệt và terminal tiếp quản. Ctrl+K mở ô lệnh nhanh.
Thanh trên chuyển EN/VI, sáng/tối/hệ thống, sắc giấy và phần cứng.
Màn hình hẹp dùng menu điều hướng thu gọn.

**So sánh agent** có bốn thẻ vòng hạn mức, bảng tổng hợp, bộ lọc 7/30 ngày
và xuất CSV. **Tài nguyên & sử dụng** có KPI, biểu đồ token và bảng theo agent,
xuất báo cáo JSON; số liệu thiếu không được ước tính từ nội dung terminal.

Mở **Hướng dẫn leader** → **Sao chép gửi hội thoại** để lấy đúng hồ sơ dữ liệu,
cổng và CLI của app đang chạy. Gói portable đã kèm CLI nên không cần npm/tsx.
Ảnh và mô tả chi tiết ở [ghi chú 2.5.0](docs/releases/2.5.0.md).

Dữ liệu desktop nằm ở `%LOCALAPPDATA%\AgentFleetDesktop\`, độc lập với dữ liệu
CLI cũ. Không sao chép database/worktree đang chạy từ bản cũ sang khi server
cũ còn hoạt động. Xem [hướng dẫn desktop và build](desktop/README.md) để biết
cấu hình, log và cách đóng gói lại.

## Cấu trúc dự án

Thư mục gốc là nơi làm việc chính và là nơi chạy mọi lệnh `npm`.

```text
cli/          Lệnh fleet và client kết nối server
desktop/      Vỏ Windows C#/.NET, WebView2, native bridge và đo tài nguyên
scripts/      Biên dịch và đóng gói portable EXE
server/       API, chạy agent, Git worktree và lưu trữ
shared/       Kiểu dữ liệu và chẩn đoán dùng chung
web/          Giao diện React, cấu hình Vite và bản build web/dist/
test/         Unit test, integration test, E2E và fixture
docs/         Hướng dẫn, thiết kế, ghi chú phiên bản và bằng chứng bàn giao
.tmp/         Dữ liệu phát triển và bản lưu cục bộ, được Git bỏ qua
```

Đọc [START_HERE.md](START_HERE.md) khi tiếp nhận dự án và xem
[mục lục tài liệu](docs/README.md) để tìm hướng dẫn chi tiết.

## Phát triển hoặc dùng CLI/web

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
npm run desktop:check
npm run desktop:build
```

E2E tự build `web/dist`, chạy server thật ở cổng `4610` với dữ liệu và repo Git
tạm, dùng agent `fake` rồi dọn dữ liệu. Cổng `4610` phải trống; E2E không tái sử
dụng server đang chạy. Nghiệm thu bằng agent thật do leader thực hiện riêng.
