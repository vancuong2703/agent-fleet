# wd-2 — Web demo: Compare + Resources

## Mục tiêu
Dựng 2 trang HTML tĩnh cho bản **web demo** (không liên quan app thật):
`web-demo/compare.html` và `web-demo/resources.html`, bám đúng design system đã có.

## Phạm vi file (chỉ được tạo/sửa)
- `web-demo/compare.html` (mới)
- `web-demo/resources.html` (mới)
- `web-demo/assets/compare.css` (mới, tuỳ chọn)
- `web-demo/assets/resources.css` (mới, tuỳ chọn)

**Tuyệt đối không** sửa `web/src/**`, `server/**`, `shared/**`, `desktop/**`, `web-demo/assets/app.css`, `web-demo/assets/app.js`.

## Bám design system
Đọc kỹ `web-demo/dashboard.html` và `web-demo/assets/app.css`, `web-demo/assets/app.js`.
- Mỗi trang HTML đầy đủ, có `<link rel="stylesheet" href="assets/app.css">` và `<script src="assets/app.js"></script>`.
- Chép nguyên sidebar/topbar từ `dashboard.html`, giữ 5 mục nav và `aria-current="page"` cho trang hiện tại.
- Dùng `.head`, `h1.title`, `.panel`, `.table`, `.badge`, `.chip`, `.donut`, `.kpi`, `.bar`, `.empty`, `.btn`.
- Icon dùng SVG data-URI mask như các trang mẫu.

## Ngôn ngữ
Mặc định **tiếng Anh**; mọi chuỗi có `data-en` / `data-vi`, hiển thị ban đầu tiếng Anh.

## compare.html — so sánh 4 agent
- 4 cột (responsive xuống 2 cột ở hẹp): `Codex`, `Qoder`, `Antigravity CLI`, `OpenCode`.
- Mỗi cột: logo + tên + tier badge; model mặc định; **vòng hạn mức nhỏ** (`.donut.sm`) cho các cửa sổ
  (Codex: 5h + week; Antigravity: 5h + week; Qoder: credit còn lại; OpenCode: token đã dùng);
  tốc độ trung bình (giây/task), tỉ lệ thành công (%), số task đã chạy.
- Bộ lọc thời gian: chip `7 days` / `30 days`.
- Bảng tổng hợp cuối trang: Agent, Plan, Model, Quota thấp nhất, Credit/Token, Avg time, Success.
- Giá trị minh hoạ hợp lý, không để `—` tràn lan.

## resources.html — tài nguyên & sử dụng
- 4 ô KPI (`.panel` + `.kpi`): Total tokens used, Credits remaining, Jobs run, Avg duration.
- Biểu đồ cột SVG token theo 7 ngày (tự vẽ `<rect>`), có nhãn ngày. Thêm trạng thái rỗng `.empty`
  (chú thích "chưa có dữ liệu" + hướng dẫn) — có thể để trong một khối ẩn hoặc mô tả bằng comment,
  miễn là nhìn thấy được thiết kế trạng thái rỗng ở đâu đó trong trang.
- Bảng theo agent: tier badge, model, credit đã dùng, hệ số, token.
- Khu **System** (CPU/RAM/GPU) hiển thị **giá trị thật**, không phải %: ví dụ `3.8 / 5.2 GHz · 8/24`,
  `19.8 / 32 GB`, `4.6 / 12 GB · 52°C`; có nút bật/tắt hàng này (`id="resStrip"` + `id="resToggle"` +
  `onclick="AF.toggleRes()"` giống `dashboard.html`).

## Tiêu chí hoàn thành
- `node web-demo/check.mjs compare.html resources.html` pass.
- Mở độc lập được, không lỗi console, không phụ thuộc file ngoài `web-demo/`.
- Ở 375 / 768 / 1440 px không cuộn ngang.
- Không sửa file ngoài phạm vi.

## Ràng buộc
Không commit. Không cài dependency. Không gọi mạng. Báo cáo: file đã tạo, kết quả
`node web-demo/check.mjs compare.html resources.html`, hạn chế còn lại.
