# Agent Fleet Desktop

Bản **2.3.0**: Dashboard v3 theo từng CLI (gói, hạn mức, credit, key pool, hệ số
model), dải **Nên dùng ngay**, trang **Tài nguyên & sử dụng** mới và nền tảng giao
diện dùng chung. Vẫn là ứng dụng Windows `.exe` với giao diện sáng/tối, cột kéo
giãn, Terminal riêng giữ nhiều phiên CLI và cuộn chuột theo vùng.
Xem [ghi chú 2.3.0](docs/releases/2.3.0.md) và [kế hoạch hiện tại](docs/dashboard-v3-plan.md).

Agent Fleet là ứng dụng local cho Windows giúp một model leader giao việc cho
các coding agent `codex`, `qodercli`, `agy`, `opencode`. Mỗi công việc có git worktree
riêng; CLI `fleet` dùng để giao việc, chờ kết quả, xem thay đổi, retry, merge hoặc huỷ.
Web UI hiển thị công việc theo plan, nhật ký trực tiếp, thay đổi, terminal tiếp quản và số liệu
so sánh agent. Leader quyết định việc cần làm và review trước khi merge.

## Mở ứng dụng Windows

Đóng bản cũ rồi mở [AgentFleet.exe](dist/AgentFleet-2.3.0/AgentFleet.exe), hoặc giải nén toàn bộ
[AgentFleet-2.3.0-win-x64.zip](dist/AgentFleet-2.3.0-win-x64.zip) rồi mở `AgentFleet.exe`. Giữ thư mục `app/`
và `runtime/` cạnh EXE. Bản portable mặc định đã kèm Node và .NET; không cần mở
CMD hoặc trình duyệt riêng. Máy cần Windows 11 x64, WebView2, Git và agent CLI
đã cài/đăng nhập để giao việc cho agent thật.

**Bảng điều khiển** hiện mỗi CLI một thẻ: gói và tier, thanh hạn mức theo **cửa sổ
thấp hơn**, credit, key pool của OpenCode và danh sách model kèm hệ số. Dải
**Nên dùng ngay** gợi ý tối đa 3 lựa chọn rẻ/miễn phí kèm 1 cảnh báo: bấm gợi ý
model để sao chép lệnh `--model`, bấm gợi ý tool để mở CLI. Dashboard **không tự
chạy lệnh nào** khi mở màn hình; chỉ **Kiểm tra** hoặc **Kiểm tra tất cả** (chạy
tuần tự, có tiến độ) mới đọc trạng thái, và kết quả được lưu lại cho lần mở sau.
Dữ liệu thiếu luôn hiện "Chưa có dữ liệu", không bị đổi thành 0.

**Mở CLI** trên thẻ chuyển sang mục **Terminal**.
Mỗi CLI có tab riêng; chuyển tab hoặc màn hình giữ nguyên tiến trình và lịch sử.
Chuột trong vùng terminal cuộn history/pager CLI; chuột bên ngoài cuộn giao diện.
Nhấn **Kiểm tra** để đọc trạng thái; AGY đọc `/usage` để hiện quota từng nhóm model;
quota/credit còn lại hiện chưa có dữ liệu nếu CLI không cung cấp. Không tự kiểm tra tài khoản khi mở màn hình.
Chọn **Công việc mới** để tạo plan từ một Git repository và giao việc; chọn công việc ở
sidebar để xem **Nhật ký**, **Thay đổi**, **Yêu cầu** và terminal. Chọn **Giao diện** ở góc dưới trái
để dùng sáng/tối/theo hệ thống, hoặc **Ô lệnh nhanh** (Ctrl K) ở mọi độ rộng màn hình.
Kéo đường phân cách để chỉnh cột và chiều cao terminal.
**Tài nguyên & sử dụng** tổng hợp số liệu theo công cụ/model và xuất JSON, kèm badge
tier và credit của từng công cụ; khi chưa có lần chạy, biểu đồ hiện hướng dẫn thay
vì đường phẳng. Số liệu token/credit được lấy từ lần chạy task có dữ liệu CLI,
không ước tính từ nội dung terminal tương tác.
Ảnh và mô tả chi tiết ở [ghi chú 2.3.0](docs/releases/2.3.0.md).

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
