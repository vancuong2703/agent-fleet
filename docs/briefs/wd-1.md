# wd-1 — Web demo: Terminal + Jobs

## Mục tiêu
Dựng 2 trang HTML tĩnh cho bản **web demo** (không liên quan app thật):
`web-demo/terminal.html` và `web-demo/jobs.html`, bám đúng design system đã có.

## Phạm vi file (chỉ được tạo/sửa)
- `web-demo/terminal.html` (mới)
- `web-demo/jobs.html` (mới)
- `web-demo/assets/terminal.css` (mới, tuỳ chọn)
- `web-demo/assets/jobs.css` (mới, tuỳ chọn)

**Tuyệt đối không** sửa `web/src/**`, `server/**`, `shared/**`, `desktop/**`, `web-demo/assets/app.css`, `web-demo/assets/app.js`.

## Bám design system
Đọc kỹ `web-demo/dashboard.html` và `web-demo/assets/app.css`, `web-demo/assets/app.js`.
- Mỗi trang là một file HTML đầy đủ, `<!doctype html>`, có `<link rel="stylesheet" href="assets/app.css">`
  và `<script src="assets/app.js"></script>`.
- Dùng đúng khối shell: `.app > aside.side` (brand + `nav.nav`) và `main.main > .topbar + .wrap`.
  Chép nguyên phần sidebar/topbar từ `dashboard.html`, giữ đồng bộ 5 mục nav:
  `dashboard.html`, `terminal.html`, `jobs.html`, `compare.html`, `resources.html`.
  Đặt `aria-current="page"` cho mục của trang hiện tại.
- Tiêu đề trang dùng `.head` + `h1.title` (có thể `h1.title` cỡ nhỏ bằng class `sm`).
- Nút: `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`; nhãn: `.toggle`, `.tbtn`.
- Bảng: `.table`; badge trạng thái: `.badge.ok|.warn|.bad|.plain`; chip lọc: `.chip`.
- Panel: `.panel` (có `h4`); khối rỗng: `.empty` (có `<b>` + mô tả).
- Vòng tròn hạn mức: dùng đúng markup `.donut` như trong `dashboard.html`
  (`<svg viewBox="0 0 44 44">` với `.edge`, `.trk`, `.val pathLength="100"`), không tự vẽ kiểu khác.
- Icon: dùng SVG data-URI mask như các trang mẫu:
  `<i class="ic" style="--u:url(&quot;data:image/svg+xml,...&quot;)"></i>`.
  Có thể chép lại từ `dashboard.html`. Icon phải đúng ngữ nghĩa (xem mục icon bên dưới).

## Ngôn ngữ
Mặc định **tiếng Anh**. Mọi chuỗi hiển thị có `data-en="..."` và `data-vi="..."`,
nội dung hiển thị ban đầu là tiếng Anh. Không hard-code chuỗi không dịch được.

## terminal.html
- Tab phiên (tablist ARIA): ví dụ `Codex · agent-fleet`, `Qoder · docs`, nút `+ New session`.
- Khung terminal nền tối (tự khai báo biến CSS riêng trong trang), vài dòng output `.mono` minh hoạ
  (prompt + 2–3 dòng kết quả). Đây là mockup, không cần xterm thật.
- Thanh công cụ: cỡ chữ (A- / A+), nút **Hide** (ẩn, tiến trình vẫn chạy) và **End process**
  (kết thúc tiến trình) — nhãn nói rõ hậu quả.
- Trạng thái lỗi: banner cảnh báo + nút **Reconnect** (chỉ hiển thị trong mockup).
- Panel bên phải hoặc dưới: thông tin phiên — agent, thư mục làm việc, model, bắt đầu lúc, trạng thái.
- Icon đúng nghĩa: terminal (`m4 17 6-6-6-6` + `M12 19h8`), refresh cho Reconnect, plus cho New session.

## jobs.html
- Hàng chip lọc trạng thái: `All`, `Running`, `Waiting`, `Failed` (dùng `.chip`, một cái đang chọn).
- Danh sách công việc `.table`: cột Title, Agent (chip logo nhỏ), Repo/Plan, Status (`.badge`),
  Changes (số file), Updated, Actions (nút `Details`, `Merge` hoặc `Stop`, `Open CLI`).
  Ít nhất 5 dòng với trạng thái đa dạng: running, queued, review, done, failed.
- Công việc đang chọn: panel chi tiết có 3 tab `Log`, `Changes`, `Request` (nội dung mẫu ngắn,
  tab dùng `role="tab"`/`role="tabpanel"`).
- Khối rỗng `.empty`: hiện khi chưa có việc — CTA "New job" kèm 3 bước
  `Pick repo → Write request → Review changes`.
- Icon đúng nghĩa: `list` cho nav Jobs, `refresh`/`play`/`stop` cho hành động, `git-merge` cho Merge.

## Tiêu chí hoàn thành
- `node web-demo/check.mjs terminal.html jobs.html` pass.
- Cả hai trang mở độc lập được, không lỗi console, không phụ thuộc file ngoài `web-demo/`.
- Ở 375 / 768 / 1440 px không cuộn ngang (bảng có thể cuộn trong khung của nó).
- Không sửa file ngoài phạm vi.

## Ràng buộc
Không commit. Không cài dependency. Không gọi mạng. Báo cáo: file đã tạo, kết quả
`node web-demo/check.mjs terminal.html jobs.html`, hạn chế còn lại.
