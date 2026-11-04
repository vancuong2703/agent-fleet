# wd-g2 — Chấm lại web demo sau khi sửa

## Vai trò
Người chấm độc lập. Chỉ được tạo/sửa **`web-demo/REVIEW2.md`**. Không sửa code/CSS/HTML nào khác.

## Đầu vào
Trạng thái hiện tại của `web-demo/` (7 trang + `assets/`), và bản chấm lần trước `web-demo/REVIEW.md`.
Hai task sửa đã merge:
- `wd-f1`: `assets/app.css`, `assets/app.js`, `dashboard.html`, `tool.html`, `index.html`.
- `wd-f2`: `terminal.html`, `jobs.html`, `compare.html`, `resources.html`, `assets/pages.css` + CSS 4 trang.

## Việc phải làm
Viết `web-demo/REVIEW2.md` (tiếng Việt) gồm:
1. **Xác minh 5 lỗi nặng nhất của `REVIEW.md` (mục 6) đã sửa chưa** — mỗi lỗi: Đã sửa / Chưa / Một phần, kèm bằng chứng (file:line hoặc số đo thật).
   Cụ thể: (1) cột tên model Antigravity; (2) `tool.html` đúng dữ liệu theo `?t=`; (3) hình học donut
   (`stroke-linecap`, khe viền, `%`, cỡ đồng nhất); (4) control chết (System ở terminal/jobs, lọc Jobs,
   chọn dòng, 7/30 ngày, "Check all" giữ icon); (5) tương phản `--faint` + tràn ngang 375px + i18n sót.
2. **Bảng điểm 0–10 mới cho từng trang** (7 trang) + lý do, so với điểm cũ trong `REVIEW.md` mục 1.
3. **Lỗi còn lại** (nếu có), xếp theo mức ảnh hưởng, có `file:line`/class.
4. **Có còn control bấm mà không có kết quả không?** Liệt kê từng control và trạng thái.
5. **Icon**: còn icon nào sai ngữ nghĩa/không đổi theo trạng thái không.
6. **Kết luận**: đã đủ để chốt bản web demo chưa; nếu chưa, còn tối đa 3 việc bắt buộc.

## Ràng buộc
- Chỉ tạo/sửa `web-demo/REVIEW2.md`.
- Nhận xét phải có bằng chứng cụ thể; không nói chung chung; không bịa tính năng.

## Lệnh kiểm tra
`node web-demo/check.mjs index.html dashboard.html tool.html terminal.html jobs.html compare.html resources.html REVIEW2.md`
