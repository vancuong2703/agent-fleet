# Hướng dẫn cho agent

- Đọc `docs/codex-debug-playbook.md` trước khi làm task; tuân theo checklist ở mục 7.
- Cách gọi/cấu hình các CLI agent (Codex, Qoder, AGY, OpenCode + DeepSeek 1017): `docs/agent-cli-guide.md`.
- Kế hoạch hiện tại: `docs/dashboard-v3-plan.md`; mockup tham chiếu: `docs/mockups/dashboard-v3.html`.
- Chỉ sửa file trong phạm vi brief. Không đưa token/API key vào log, fixture hay test.
- Kiểm tra: `npx tsc --noEmit`, `npx vitest run`; task UI thêm `npm run test:e2e`.
