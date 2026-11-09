# Bàn giao dự án nâng cấp Agent Fleet

Thư mục dự án: `C:\Qoder\agent-fleet-upgrade`.

**Bản làm việc hiện tại: Agent Fleet Desktop 2.7.2.** Mở
`dist/AgentFleet-2.7.2/AgentFleet.exe`; xem [ghi chú 2.7.2](docs/releases/2.7.2.md) và
[hướng dẫn desktop](desktop/README.md). UI đã xây lại theo toàn bộ bố cục OpenCode;
mục **Hướng dẫn leader** sao chép kết nối hiện tại và quy trình vào hội thoại.
Mục tiêu tổng gói <115 MB vẫn **chưa đạt** vì Node và .NET portable.
Kết quả nghiệm thu 2.3.0 trước đây: 690 unit/integration, 106 E2E, 25 native policy;
smoke thật 4/4 CLI `ready`. Các số liệu 1.1.0 bên dưới là lịch sử bàn giao.

Chọn thư mục này khi tạo dự án mới trong Codex. Mã nguồn ở ngay thư mục gốc,
không cần ghép thêm dữ liệu từ các thư mục thử nghiệm cũ.

Đã hợp nhất cấu trúc thư mục ngày 03/11/2026: chỉ làm việc tại thư mục gốc.
Bản lồng `agent-fleet/` có đủ 93 tệp trùng SHA-256 với bản gốc đã được chuyển
vào `.tmp/archive/agent-fleet/`, giữ Git riêng và kết quả kiểm thử cũ để có thể
khôi phục. Thư viện `node_modules/` đã chuyển lên gốc để dùng chung cho bản
làm việc chính. Xem [cấu trúc và mục lục tài liệu](docs/README.md).

## Trạng thái bàn giao

- Mã nguồn khi bàn giao ban đầu: **Agent Fleet 1.1.0**.
- Có lịch sử Git của repo gốc, baseline `dda1d3cd9a0b3a5f34bc5d4d8026c6f6bd37fa46`.
- Các thay đổi nâng cấp được giữ ở working tree, chưa commit để dự án mới review.
- Repo mới có Git độc lập, không đặt remote về repo gốc.
- Đã sao chép và đối chiếu SHA-256 cho đủ **93 tệp mã nguồn/tài liệu**.
- Thư viện được cài lại bằng `npm ci`. Token, database, worktree đang chạy và
  cấu hình tài khoản không nằm trong gói bàn giao.

## Đọc theo thứ tự

1. [Ghi chú 2.3.0](docs/releases/2.3.0.md): thay đổi, phân công CLI, kết quả test,
   kích thước gói và giới hạn số liệu. [Ghi chú 2.2.0](docs/releases/2.2.0.md) và
   [Ghi chú 1.1.0](docs/releases/1.1.0.md) là lịch sử.
2. [README.md](README.md): cấu trúc ứng dụng, cài đặt, cấu hình.
3. [Hướng dẫn leader](docs/leader-guide.md): giao việc cho Codex, Qoder, AGY và OpenCode qua fleet.
4. [Thiết kế ban đầu](docs/superpowers/specs/2026-11-02-agent-fleet-design.md).
5. [Bằng chứng bàn giao](docs/handoff/): manifest, trạng thái Git lúc bàn giao, log và kết quả smoke test,
   ảnh giao diện check FAIL.

## Chạy bản phát triển riêng

Cần Windows, Git và Node.js 24 như README của fleet. Trong PowerShell tại thư
mục dự án mới:

```powershell
npm ci
npm run build:web

# Dữ liệu và cổng riêng cho bản phát triển; không dùng server fleet cũ ở 4500.
$env:FLEET_DATA_DIR = Join-Path (Get-Location).Path '.tmp\fleet-dev'
New-Item -ItemType Directory -Path $env:FLEET_DATA_DIR -Force | Out-Null
$devConfig = Join-Path $env:FLEET_DATA_DIR 'fleet.config.json'
if (!(Test-Path -LiteralPath $devConfig)) {
  [System.IO.File]::WriteAllText(
    $devConfig,
    '{"port":4510}',
    [System.Text.UTF8Encoding]::new($false)
  )
}

# Gọi CLI của chính dự án mới, thay vì lệnh fleet global đang trỏ repo cũ.
npm run fleet -- doctor
npm run fleet -- ui
```

Giữ `FLEET_DATA_DIR` giống nhau trong các terminal dùng bản phát triển. Nếu cổng
4510 đã được dùng, đổi `port` trong file cấu hình trên trước khi khởi động.
Dữ liệu `.tmp/` đã nằm trong `.gitignore`.

Sau khi đổi mã server, khởi động lại bản phát triển khi không có task đang chạy:

```powershell
npm run fleet -- server stop
npm run fleet -- doctor
```

## Kiểm tra lại trong dự án mới

```powershell
npx vitest run
npx tsc --noEmit
npm run test:e2e
```

Ở repo nguồn trước khi sao chép: **319 test/16 tệp PASS**, TypeScript PASS,
build PASS và **5/5 E2E PASS**. E2E dùng dữ liệu tạm riêng và cổng 4610.
Các số liệu trên thuộc lần nghiệm thu trước khi bàn giao. Kết quả kiểm tra sau
khi sắp xếp lại thư mục được ghi tại [mục lục tài liệu](docs/README.md).

## Tình huống AGY trong bản bàn giao cũ

AGY tạo được `hello.txt`, nhưng `--mode accept-edits` chưa bảo đảm quyền chạy
lệnh. Trong bài thử thật, `node check.cjs` bị từ chối ở headless và AGY vẫn
thoát 0. Fleet 1.1.0 đã nhận diện lỗi này là `failed`/`permission`; check độc lập
của fleet PASS không xoá lỗi agent. Không có thay đổi tự cấp quyền toàn bộ.

Bản 2.1 đã bổ sung quyền `ask/check-only/auto` theo từng run và thử thật AGY auto
thành công. Xem [quyền AGY và nghiệm thu 2.1](docs/releases/2.2.0.md).

Kết quả và log trong `docs/handoff/smoke-tests/` là bằng chứng lịch sử của repo cũ;
các plan/task ID và đường dẫn trong đó không phải dữ liệu vận hành của dự án mới.
Task AGY `t-ee6lwl`, lần 2, đã chuyển sang tiếp quản terminal ở môi trường cũ;
lần chạy đó không được tính là regression PASS. Gói bàn giao không thay đổi phiên đó.

## Ưu tiên tại thời điểm bàn giao 1.1 (lịch sử)

1. Quyền theo task/lần chạy: hỗ trợ danh sách lệnh AGY được người dùng cấp;
   lưu lại để retry rõ ràng, không phải sửa cấu hình chung cho mọi task.
2. Tiếp quản terminal: hoàn tất task và chạy lại check ngay trên UI; xử lý đúng
   trạng thái sau khi tiếp quản task đã failed.
3. Doctor: phân biệt có executable, đã đăng nhập và sẵn sàng chạy headless.
4. Một lệnh smoke test nhiều agent, báo cáo riêng kết quả agent và check độc lập.

Mẫu yêu cầu cho chat mới:

> Đọc START_HERE.md và docs/releases/2.3.0.md. Review hiện trạng dự án đã bàn giao, sau đó
> tiếp tục theo yêu cầu mới. Giữ dữ liệu/cổng phát triển
> riêng và kiểm tra đầy đủ trước khi áp dụng thay đổi vào server đang dùng.
