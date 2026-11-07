# Hướng dẫn cho agent

- Đọc `docs/codex-debug-playbook.md` trước khi làm task; tuân theo checklist ở mục 7.
- Cách gọi/cấu hình các CLI agent (Codex, Qoder, AGY, OpenCode + DeepSeek 1017): `docs/agent-cli-guide.md`.
- Kế hoạch hiện tại: `docs/superpowers/plans/2026-11-06-calm-ui-ux-motion.md` (đề xuất chờ duyệt triển khai). Kế hoạch Dashboard v3 cũ: `docs/dashboard-v3-plan.md`; mockup lịch sử: `docs/mockups/dashboard-v3.html`.
- Chỉ sửa file trong phạm vi brief. Không đưa token/API key vào log, fixture hay test.
- Kiểm tra: `npx tsc --noEmit`, `npx vitest run`; task UI thêm `npm run test:e2e`.
- Build/đóng gói bản phát hành (bump version, scripts/package-desktop.ps1, release notes): main agent tự chạy, không giao subagent. Quy trình: đổi version bằng lệnh thay chuỗi (xem test/release.test.ts để biết đủ file), chạy `powershell -ExecutionPolicy Bypass -File scripts/package-desktop.ps1 -OutputName AgentFleet-x.y.z`, rồi chỉ chạy `npx vitest run test/release.test.ts` và `npx tsc --noEmit`. Bỏ `desktop:check` khi `dotnet publish` đã thành công.
