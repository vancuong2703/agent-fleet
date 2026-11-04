# wd-f1 — Sửa web demo (phần dùng chung + Dashboard + Tool detail)

## Bối cảnh
`web-demo/REVIEW.md` là bản chấm độc lập. Đọc nó trước. Nhiệm vụ: sửa các lỗi thuộc
**design system dùng chung + Dashboard + Tool detail + index**. Không dựng lại giao diện.

## Phạm vi file (chỉ được sửa)
- `web-demo/assets/app.css`
- `web-demo/assets/app.js`
- `web-demo/dashboard.html`
- `web-demo/tool.html`
- `web-demo/index.html`

**Không sửa** `web-demo/terminal.html`, `jobs.html`, `compare.html`, `resources.html`,
`assets/{terminal,jobs,compare,resources}.css` (do task khác sửa), và không sửa `web/src/**`, `server/**`, `shared/**`.

## Việc phải làm (theo REVIEW.md)
1. **Lỗi #1 (mục 6) — tên model Antigravity bị ẩn 0px.** `assets/app.css` `.mtx td:first-child`
   đang `max-width:0` + `overflow:hidden` → cột tên co về 0px. Sửa để tên **luôn hiện**:
   `.mtx{table-layout:fixed}` và cột đầu có bề rộng xác định (~38%), bỏ `max-width:0`.
   Kiểm chứng: `.mtx tbody td:first-child` phải có `getBoundingClientRect().width > 40`.
2. **Lỗi #3 (mục 6) + mục 4 — hình học donut.** Trong `app.css`:
   - Đổi `stroke-linecap:round` → `stroke-linecap:butt` cho `.donut .val` (mũi tròn đang làm
     giá trị phồng ~6 điểm %).
   - Tăng khe giữa viền ngoài và ring: đặt `r=21` cho `.edge` (đổi trong markup `dashboard.html`
     và `tool.html`), hoặc giảm `r` của `.trk/.val` xuống 15; khe thực ≥ 2px.
   - Thống nhất cỡ: khai báo biến `--donut` (mặc định 80px), `.donut.sm` = 56px. Cùng một dữ liệu
     không được vẽ 2 cỡ tuỳ tiện.
   - Mọi `.pct` phải hiển thị kèm `%` (kể cả 6 donut Antigravity). Nếu `%` làm tràn donut nhỏ,
     giảm cỡ chữ `.donut.sm .pct`.
3. **`dashboard.html`**
   - Thêm `%` vào 6 nhãn donut Antigravity.
   - OpenCode: thêm `title` chứa id model đầy đủ cho 2 dòng model (id đang bị cắt cứng bằng `…`).
   - Trạng thái `.dot`: ít nhất 1 card dùng `.dot.warn` để điểm trạng thái có nghĩa (không phải 4 dot xanh giống hệt).
   - Mọi chuỗi còn tiếng Anh sót (`check 18:41:50`, ...) phải có `data-en`/`data-vi`.
4. **`tool.html` — phải dữ liệu theo từng tool, không dùng số Codex cho tất cả.**
   - Dùng `<template data-tool="codex|qoder|agy|opencode">` và render theo `?t=`.
   - Nội dung đúng loại quota:
     - `codex`: 2 vòng (5 giờ / tuần) + model gpt-6.1-sol + gói PLUS.
     - `qoder`: **credit còn lại** (1,240 / 2,000) + 2 model, không có cửa sổ 5 giờ.
     - `agy`: **2 cột 5 giờ / tuần** theo model + credit.
     - `opencode`: **token đã dùng** + key pool (12/13) + 2 model free, không cửa sổ 5 giờ.
   - `?t=` không hợp lệ → **empty state** (không âm thầm rơi về Codex, như `tool.html:123` hiện tại).
   - Nút "Open location": nói rõ mở cái gì, hoặc bỏ.
5. **`app.js`**
   - `checkAll`: **không được phá icon**. Chỉ cập nhật phần nhãn (span trong nút), giữ icon;
     khi xong khôi phục đúng nhãn theo ngôn ngữ đang chọn (không quay về tiếng Anh cứng).
   - `setLang`: đặt luôn `document.documentElement.lang`.
   - `.toast`: thêm `role="status"` + `aria-live="polite"` khi khởi tạo.
   - Nhớ `data-theme` và `data-lang` trong `localStorage` (bọc `try/catch`), đọc lại lúc tải.
   - Nếu trang **không có** `#resStrip`, tự ẩn nút `#resToggle` (tránh nút chết).
   - Nhãn `System/Dark/Light` phải đổi theo ngôn ngữ.
6. **Mục 5 — tương phản & 375px.** `app.css`: tăng tương phản `--faint` (hiện 2.45:1) đủ ≥3:1
   cho chữ nhỏ (mặc định tối hơn khoảng `#7b7b70`; dark theme cũng chỉnh lại).
   Thêm `@media(max-width:560px){ h1.title{font-size:40px} h1.title.sm{font-size:30px} }`
   để `index.html` và `dashboard.html` không tràn ngang ở 375px.
7. **`index.html`**: ghi rõ có 4 trang chi tiết tool (`tool.html?t=codex|qoder|agy|opencode`).

## Tiêu chí hoàn thành
- `node web-demo/check.mjs index.html dashboard.html tool.html` pass.
- Đo thật (nếu được): không tràn ngang ở 375px; `.mtx` tên model hiện; donut có `%`.
- Không sửa file ngoài phạm vi.

## Ràng buộc
Không commit. Không cài dependency. Báo cáo: file đã sửa, kết quả check, hạn chế còn lại.
