# Hướng dẫn cho agent

- Đọc `docs/codex-debug-playbook.md` trước khi làm task; tuân theo checklist ở mục 7.
- Kế hoạch hiện tại: `docs/dashboard-v3-plan.md`; mockup tham chiếu: `docs/mockups/dashboard-v3.html`.
- Chỉ sửa file trong phạm vi brief. Không đưa token/API key vào log, fixture hay test.
- Kiểm tra: `npx tsc --noEmit`, `npx vitest run`; task UI thêm `npm run test:e2e`.
