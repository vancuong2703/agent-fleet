# Kế hoạch sửa UI/UX (bản 2.5.x)

Ngày 04/11/2026. Mục tiêu: sửa các lỗi thị giác và dữ liệu người dùng báo sau khi
chạy bản desktop 2.5.0. Mỗi mục có phạm vi file riêng để nhiều agent làm song
song mà không giẫm lên nhau.

## Phân công

| # | Việc | Agent | File được sửa |
|---|------|-------|----------------|
| 1 | Đổi font, tăng nét, tăng tương phản chữ | `agent-ui` | `web/src/styles/fonts.css`, `reference.css` |
| 2 | Thanh menu đồng nhất (nhãn không xuống dòng, mục Leader guide cùng form) | `agent-ui` | `web/src/ui/Workspace.tsx`, `reference.css`, `workflow.css` |
| 3 | Viền đậm hơn, nút bớt đen / bớt "pill" | `agent-ui` | `reference.css`, `workflow.css` |
| 4 | Hiệu ứng xoay khi kiểm tra; câu "Cần chú ý" theo đúng cửa sổ hết hạn mức; "Công việc hôm nay" mặc định xám khi trống | `agent-dashboard` | `web/src/ui/Dashboard.tsx`, `web/src/ui/ToolDetail.tsx`, `web/src/styles/reference-dashboard.css` |
| 5 | Bỏ pool `routeway` (8/8) khỏi `key-pool.json`; chỉ hiển thị model của `tokenharbor`, `harbor-pool`, `opencode` (bỏ `9router`) | `agent-ui` (config) + `agent-opencode` (parser + test) | `~/.config/opencode/key-pool.json` (có backup), `server/dashboard/parsers/opencode.ts`, `test/server/opencode-data.test.ts` |
| 6 | Nghiệm thu: tsc, vitest, e2e, ảnh chụp, đóng gói lại | `agent-ui` | — |

## Chi tiết

### 1. Font / độ nét
- Bỏ `-webkit-font-smoothing:antialiased` (trên Windows nó làm chữ mảnh đi).
- `--sans` dùng `'Segoe UI Variable Text', 'Segoe UI', Inter, system-ui` để chữ
  nhỏ sắc nét; giữ Bricolage cho tiêu đề, JetBrains Mono cho số.
- Body 15px/1.55, weight 500; nhãn phụ (`.g-cap`, `.ver`, `.cellsub`, `.when`)
  tăng weight và dùng màu đậm hơn.
- `--muted` / `--faint` đậm hơn ở cả sáng và tối để đạt tương phản đọc được.

### 2. Thanh menu
- Nhãn VI "Tài nguyên & sử dụng" → "Tài nguyên" (crumb và tiêu đề trang giữ nguyên).
- `.nav a` / `.sidebar-guide` cùng padding, font, border-left; mục Leader guide
  không còn icon cam riêng, dùng chung trạng thái active.
- `white-space:nowrap` + ellipsis cho nhãn để không mục nào cao hơn mục khác.

### 3. Viền / nút
- `--border`, `--border-strong` đậm hơn ~15% ở cả 4 bảng màu.
- Nút chính bỏ nền đen: dùng nền `--accent-soft`, viền `--accent`, chữ
  `--accent-strong`; hover mới đổ đầy. Giảm bán kính pill 999px → 8–10px.
- Chip lọc, segmented EN/VI dùng cùng ngôn ngữ nút mới, không còn khối đen.

### 4. Dashboard
- Icon `refresh` bọc trong `<span class="spin">` khi đang kiểm tra (đã có
  `@keyframes spin` trong `reference.css`); tôn trọng `prefers-reduced-motion`.
- "Cần chú ý" sinh câu theo dữ liệu:
  - hết 5 giờ: "Đã hết hạn mức 5 giờ";
  - sắp hết tuần: "Sắp hết hạn mức tuần (còn 12%)";
  - credit/token: "Credit đã cạn" / "Đã dùng 92% hạn mức token";
  - pool: "Key trong pool đã cạn" / "Pool còn 8/15 key";
  - cần đăng nhập: "Cần đăng nhập lại".
- "Công việc hôm nay": khi 0 việc thì thanh xám và câu "Chưa có việc nào hôm
  nay"; chỉ tô màu cho trạng thái có số lượng > 0.

### 5. OpenCode
- `key-pool.json` đang có 2 pool: `harbor` (15 key) và `routeway` (8 key).
  `routeway` là pool đã bị xoá route key nhưng vẫn trả 8/8 → bỏ pool này khỏi
  file (sao lưu `key-pool.json.bak-<thời điểm>` trước khi sửa).
- `opencode models` trả model của 4 provider; chỉ giữ `opencode`,
  `tokenharbor`, `harbor-pool`; bỏ `9router` (7 model `ag/gemini-*`).
- Test parser: có `9router` trong stdout thì không xuất hiện trong kết quả.

## Nghiệm thu
- `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`.
- Ảnh chụp 1280×800 / 1440×900 / 1496×886, sáng + tối; không cuộn, không đè.
- Đóng gói lại `dist/AgentFleet-2.5.0` và chạy smoke test.

## Kết quả

- W1–W5 xong.
- `key-pool.json`: bỏ pool `routeway` (8 key), giữ `harbor` (15 key); bản sao
  lưu nằm cùng thư mục với hậu tố `.bak-<timestamp>`.
- Model OpenCode chỉ còn `opencode`, `tokenharbor`, `harbor-pool`.
- `tsc` sạch, `vitest` 628/628. E2E 105/105 (một lần chạy trước flake test focus
  `task-actions`, chạy lại thì pass).
- Gói portable đóng lại trong `dist/AgentFleet-2.5.0` + zip.
