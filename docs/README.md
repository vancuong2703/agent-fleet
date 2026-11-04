# Tài liệu Agent Fleet

- [Bắt đầu và tiếp nhận dự án](../START_HERE.md)
- [Cài đặt, cấu hình và phát triển](../README.md)
- [Ứng dụng Windows và đóng gói EXE](../desktop/README.md)
- [Xây lại UI OpenCode, sao chép hướng dẫn leader 2.5](releases/2.5.0.md)
- [Review bản demo OpenCode trước tích hợp](reviews/editorial-demo-review-2.md)
- [Dashboard v3 và nền tảng giao diện 2.3](releases/2.3.0.md)
- [Terminal riêng, cuộn chuột và quota AGY 2.2](releases/2.2.0.md)
- [Bản vá CLI và kiểm tra trạng thái 2.1.1](releases/2.1.1.md)
- [Ghi chú desktop 2.1](releases/2.1.0.md)
- [Phân công DeepSeek-Flash, Qwen3.8-Flash và OpenCode](upgrade-2.1-plan.md)
- [Kế hoạch desktop 2.0](desktop-upgrade-plan.md)
- [Ghi chú desktop 2.0](releases/2.0.0.md)
- [Hướng dẫn leader](leader-guide.md)
- [Ghi chú phiên bản 1.1.0](releases/1.1.0.md)
- [Thiết kế ban đầu](superpowers/specs/2026-11-02-agent-fleet-design.md)
- [Kế hoạch triển khai ban đầu](superpowers/plans/2026-11-02-agent-fleet.md)
- [Bằng chứng bàn giao](handoff/)

## Sắp xếp thư mục ngày 03/11/2026

Thư mục làm việc chính là `C:\Qoder\agent-fleet-upgrade`. Chạy cài đặt,
phát triển, build và kiểm thử từ đây. Các thư mục `cli/`, `server/`, `shared/`,
`web/`, `test/` giữ vị trí hiện tại để các import, CLI và cấu hình build dùng
cùng một bộ mã nguồn.

Bản dự án lồng `agent-fleet/` đã được đối chiếu SHA-256: cả 93 tệp mã nguồn,
cấu hình và tài liệu đều giống bản ở gốc. Bản này được chuyển nguyên phần còn
lại vào `.tmp/archive/agent-fleet/`, bao gồm Git riêng, `web/dist/` và kết quả
E2E cũ. `node_modules/` của bản lồng được chuyển lên gốc; hai bản dùng cùng
`package.json` và `package-lock.json`. Bản lưu là dữ liệu cục bộ được Git bỏ qua.

Ghi chú nâng cấp chuyển từ `UPDATE_FLEET.md` sang `docs/releases/1.1.0.md`.
Bằng chứng bàn giao chuyển từ `handoff/` sang `docs/handoff/`; nội dung manifest,
log và ảnh lịch sử được giữ nguyên. Đường dẫn trong `source-manifest.json` mô
tả cấu trúc tại thời điểm bàn giao, trước lần sắp xếp này.

Để hoàn tác việc lưu bản lồng, chuyển `node_modules/` từ gốc về
`.tmp/archive/agent-fleet/node_modules/`, rồi chuyển `.tmp/archive/agent-fleet/`
về `agent-fleet/`. Chỉ thực hiện khi không có tiến trình đang dùng các thư mục
này và đích di chuyển chưa tồn tại.

## Kiểm tra sau khi sắp xếp

- `npm ls --depth=0`: đủ dependency, không có lỗi sau khi chuyển lên gốc.
- `npx --no-install tsc --noEmit`: PASS.
- `npm run build:web`: PASS, tạo bản build tại `web/dist/`.
- `npm test`: **319/319 PASS**, 16 tệp test.
- `npm run test:e2e`: **5/5 PASS**, dùng agent giả và dữ liệu tạm riêng.
- Đối chiếu lại **81 tệp mã nguồn và kiểm thử** với bản lưu: không đổi nội dung.
- Kiểm tra **19 liên kết tài liệu nội bộ**: tất cả đích đều tồn tại.
- `git diff --check`: PASS; bản lưu, dependency và bản build được Git bỏ qua.

Lần chạy unit test đầu trong sandbox không ghi được `.git/config` của repo
tạm. Sau khi chạy lại với quyền cho phép tạo repo Git tạm, toàn bộ test đạt.
