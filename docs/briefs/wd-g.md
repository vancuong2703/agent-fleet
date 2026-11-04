# wd-g — Web demo: chấm điểm & rà soát (grader)

## Vai trò
Bạn là **người chấm độc lập** cho bản web demo. Không viết lại giao diện; chỉ đánh giá và ghi báo cáo.
Bạn **không** được sửa bất kỳ file nào ngoài `web-demo/REVIEW.md`.

## Đầu vào
Toàn bộ thư mục `web-demo/`:
- `index.html`, `dashboard.html`, `tool.html`, `terminal.html`, `jobs.html`, `compare.html`, `resources.html`
- `web-demo/assets/app.css`, `app.js`, và các CSS riêng của từng trang (nếu có).

Đối chiếu với yêu cầu người dùng (bản chốt Editorial):
1. Bỏ dải "Nên dùng ngay"; tiêu đề trang là **DASHBOARD**; chữ đậm + 1 màu nhấn.
2. Dashboard chia **4 vùng công cụ đều nhau**: Codex, Qoder, Antigravity CLI, OpenCode.
3. **Codex**: 2 vòng tròn (5 giờ / tuần).
4. **Qoder**: hiển thị **credit còn lại** và tối đa 2 model.
5. **Antigravity CLI** (đổi tên từ AGY): quota dạng vòng tròn, **tách 2 cột 5 giờ / tuần** cho từng model.
6. **OpenCode**: chỉ 2 model (harbor-key free + opencode free), hiển thị **số token đã dùng**.
7. Vòng tròn **chuẩn, có viền**, hiển thị **% và thời gian hồi (reset)**.
8. Hàng **CPU · RAM · GPU** hiển thị **giá trị thật** (GHz/GB/°C), bật/tắt được.
9. Đổi ngôn ngữ **EN/VI**, mặc định **English**, theme **theo hệ thống**.
10. Có **trang chi tiết công cụ**.
11. Còn lại: Terminal, Jobs, Compare, Resources — đủ thông tin người dùng cần, tối giản, không bắt bấm thừa.

## Việc phải làm
Viết `web-demo/REVIEW.md` (tiếng Việt) gồm:
1. **Bảng điểm 0–10** cho từng trang + 1–2 câu lý do.
2. **Thiếu thông tin gì** theo từng trang: người dùng cần biết gì mà màn hình chưa hiển thị.
3. **Kiểm tra icon**: liệt kê từng icon đang dùng (đọc `--u:url(...)` trong HTML), nói đúng ngữ nghĩa chưa,
   đề xuất icon thay thế nếu sai (theo bộ Lucide).
4. **Kiểm tra vòng tròn donut**: có viền ngoài tách khỏi ring chưa; `stroke-dasharray` đúng theo `--pct`;
   có hiện % và thời gian hồi chưa; kích thước có đồng nhất không.
5. **Nhất quán**: màu (`--accent`/tier), khoảng cách, cỡ chữ tiêu đề, trạng thái rỗng, aria (`aria-current`, `role="tab"`).
6. **Top 5 việc nên sửa**, xếp theo mức độ ảnh hưởng, kèm `file:line` hoặc tên class cụ thể.
7. Kết luận: trang nào đạt, trang nào cần làm lại.

## Ràng buộc
- Chỉ tạo/sửa **`web-demo/REVIEW.md`**. Không sửa code, không sửa CSS, không sửa HTML khác.
- Nhận xét phải cụ thể, dẫn chứng bằng file/class/dòng; không nói chung chung.
- Không bịa tính năng không có trong file.

## Lệnh kiểm tra
`node web-demo/check.mjs index.html dashboard.html tool.html terminal.html jobs.html compare.html resources.html REVIEW.md`
