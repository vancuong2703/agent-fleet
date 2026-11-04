# wd-f2 — Sửa web demo: hành vi Terminal / Jobs / Compare / Resources

## Bối cảnh
`web-demo/REVIEW.md` là bản chấm độc lập. Đọc nó trước. Nhiệm vụ: sửa **hành vi + nhất quán**
của 4 trang do task trước dựng. Không dựng lại bố cục.

## Phạm vi file (chỉ được sửa)
- `web-demo/terminal.html`, `web-demo/jobs.html`, `web-demo/compare.html`, `web-demo/resources.html`
- `web-demo/assets/terminal.css`, `assets/jobs.css`, `assets/compare.css`, `assets/resources.css`

**Không sửa** `web-demo/assets/app.css`, `app.js`, `dashboard.html`, `tool.html`, `index.html`
(do task khác sửa), và không sửa `web/src/**`, `server/**`, `shared/**`.

## Việc phải làm (theo REVIEW.md mục 6, lỗi #4 và mục 1/2/5)
1. **Bỏ mọi control bấm mà không có kết quả** (yêu cầu 11):
   - `jobs.html`: chip lọc phải **lọc thật** danh sách (bấm `Failed` chỉ còn dòng failed; `All` hiện đủ).
     Thêm `Done`/`Review` vào bộ lọc cho khớp bảng.
   - `jobs.html`: bấm một dòng phải **cập nhật panel chi tiết** (tiêu đề + nội dung theo job đang chọn),
     không đứng yên ở "Add jobs page".
   - `jobs.html`: bỏ nút "Empty state" trên header (là nút thử của designer). Trạng thái rỗng giữ trong
     một khối `.empty` hợp lệ (có thể ẩn/hiện bằng JS khi danh sách trống).
   - `terminal.html` + `jobs.html`: nút **System** đang là nút chết (trang không có `#resStrip`).
     Hoặc bỏ nút này trên 2 trang, hoặc thêm hàng System thật. Không để `aria-pressed` lật mà không có gì xảy ra.
   - `terminal.html`: banner "Connection lost" **không được hiện ngay khi tải trang** (hiện đang `role="alert"`
     thường trực). Chỉ hiện ở trạng thái lỗi (ví dụ sau khi bấm một nút mô phỏng mất kết nối), hoặc chuyển
     thành `role="status"` và mặc định ẩn.
2. **Dòng bảng chọn được bằng bàn phím**: `jobs.html` dòng `<tr>` click được phải có `tabindex="0"`,
   `role="button"` (hoặc dùng `<button>` trong ô), và hỗ trợ Enter/Space.
3. **Cửa sổ 7/30 ngày phải nhất quán** (REVIEW mục 6 #4, mục 2):
   - `compare.html`: đổi thời gian phải đổi **tất cả** chỉ số (Avg time, Success, Tasks run) **và** bảng
     tổng hợp, không chỉ "Tasks run".
   - `resources.html`: cửa sổ 30 ngày không được nói "No data yet" trong khi Compare có số 30 ngày.
     Hoặc cả hai có dữ liệu, hoặc cả hai đều ghi rõ "demo chỉ dựng 7 ngày". KPI phải đổi theo cửa sổ.
4. **Tự nhất quán số liệu** (REVIEW mục 1): bảng tổng hợp `compare.html` đang mâu thuẫn với card phía trên
   (54% vs 46%, cấp credit cho Antigravity, hệ số gán nhầm model). Sửa để card và bảng khớp nhau.
5. **Donut**: mọi nhãn `.pct` phải kèm `%`; Qoder/OpenCode ở `compare.html` phải có **thời gian hồi**
   (không dùng ô `.g-reset` cho số credit/token). `terminal.html` bỏ nhãn "resets in" cho cửa sổ context
   (context window không reset theo đồng hồ; đổi thành "context used").
6. **i18n sót**: thay chuỗi Anh lẫn trong trang Việt — `jobs.html` `#4818 · queued` / `#4816 · waiting slot`,
   `terminal.html` `/ 200K tokens`, các toast tiếng Anh ở `compare.html`/`resources.html`.
   Mọi chuỗi hiển thị cần `data-en`/`data-vi`.
7. **Nhất quán cỡ chữ/nút**: `.btn.sm` khai báo trùng ở `terminal.css` + `jobs.css`; `.tscroll`/`button.chip`
   trùng ở `compare.css` + `resources.css` — gộp về một chỗ trong file dùng chung của 2 trang đó.
   Thêm `aria-current="page"` cho nav (đã có) và `role="status"` cho toast nếu tự tạo.

## Tiêu chí hoàn thành
- `node web-demo/check.mjs terminal.html jobs.html compare.html resources.html` pass.
- Bấm thử: lọc Jobs ra kết quả đúng; đổi cửa sổ 7/30 đổi mọi chỉ số; không còn nút chết.
- Ở 375 / 768 / 1440 px không tràn ngang. Không sửa file ngoài phạm vi.

## Ràng buộc
Không commit. Không cài dependency. Báo cáo: file đã sửa, kết quả check, hạn chế còn lại.
