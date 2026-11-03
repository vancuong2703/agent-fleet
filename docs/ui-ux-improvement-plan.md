# Plan cải tiến UI/UX — Agent Fleet 2.3

Ngày: 03/11/2026. Dựa trên bản 2.2.0 (web UI chạy cục bộ ở cổng 4510, dữ liệu trống),
ảnh chụp sáng/tối ở 1440, 768 và 375 px, ảnh cũ trong `docs/images/`, và rà soát
mã `web/src`.

## 1. Hiện trạng tóm tắt

- 5 màn hình, không có router: Bảng điều khiển, Terminal, Công việc, So sánh agent,
  Tài nguyên & sử dụng (`App.tsx:38`). Cộng thêm modal tạo task và ConfirmDialog.
- Bố cục: sidebar | main | inspector, cùng thanh trạng thái 30 px. Kích thước lưu vào
  localStorage.
- `theme.css` dài 1.467 dòng. Nhiều khối bị định nghĩa trùng (`.inspector` 4 lần,
  `.topbar` 3 lần, `.terminal-search` 3 lần). Không có token khoảng cách. Bán kính bo góc dao động 4–15 px.
- Điểm tốt nên giữ: theme bootstrap trước khi vẽ trang (không bị nháy màu khi mở),
  ResizeHandle dùng được bằng bàn phím, có style `:focus-visible`, terminal luôn tối,
  phiên terminal vẫn sống khi đổi màn.

## 2. Vấn đề quan sát được

### A. Lỗi hiển thị / hành vi (ưu tiên cao)
1. **Responsive hỏng ở cửa sổ hẹp.** Ở 375 px, sidebar chiếm khoảng 60% màn hình và nội dung bị bóp
   thành cột chữ dọc. Nguyên nhân: `App.tsx:85` gán `--sidebar-width` inline, nên
   đè mất media rule 720 px (`theme.css:1146`). Ở 768 px sidebar vẫn rộng 258 px và
   không thu gọn được.
2. **Logo Qoder (và OpenCode) gần như không thấy được ở theme tối.** Logo màu tối nằm trên nền tối.
3. **Text dính nhau trong modal tạo task:** "Chưa chạy kiểm tra CLI**Kiểm tra agent**",
   thiếu khoảng cách giữa trạng thái và nút.
4. **Thông báo thành công bị tô đỏ như lỗi.** `Dashboard.tsx:27` luôn dùng `banner-error`
   cho `cli.message`, kể cả "Đã sao chép lệnh".
5. **Không có trạng thái loading.** Trong lúc tải lần đầu, các màn hiện nội dung của trạng thái trống:
   "Bắt đầu một công việc mới" (`App.tsx:110`), "Chưa có thay đổi" / "Diff (0)"
   (`DiffView.tsx:48`), "Chưa có sự kiện" (`LogView.tsx:60`).
6. **Không thoát được khi lỗi:** So sánh agent đứng mãi ở "Đang tải…" sau lần tải lỗi đầu tiên
   (`ComparePage.tsx:125`). Socket terminal lỗi thì không có nút thử lại
   (`TerminalPanel.tsx:94`). Lỗi tải log bị nuốt mất (`store.ts:372`).
7. **ConfirmDialog không an toàn:** không đóng được bằng Escape, không giữ focus trong
   dialog, không trả focus về chỗ cũ. Bấm ra nền là huỷ luôn, kể cả với thao tác
   discard (`ConfirmDialog.tsx:27`).

### B. Kiến trúc thông tin & luồng
8. **Màn "Công việc" khi trống vẫn bày cả inspector** (CPU/RAM, token, credit đều "—"),
   gây nhiễu đúng lúc người dùng mới vào lần đầu.
9. **Bảng điều khiển:** 4 thẻ đều "Chưa kiểm tra / Chưa có dữ liệu" và không có nút
   "Kiểm tra tất cả". Banner hướng dẫn chiếm một hàng riêng. Trên trang có ba kiểu chữ:
   mono, sans và chữ đậm.
10. **Trang Tài nguyên khi trống:** biểu đồ vẫn vẽ đường phẳng thay vì hiện trạng thái trống, và có
    hai bảng trống xếp chồng nhau.
11. **Nút gây hiểu nhầm:** "Mở terminal" trên task đang chạy thực ra là takeover
    (`TaskActions.tsx:69`). "Đóng" và "Kết thúc phiên" khác nhau ở chỗ có tắt process hay không,
    nhưng nhãn không nói điều đó. "Huỷ" (huỷ task) nằm cạnh "Huỷ bỏ" (đóng dialog). Merge bị khoá mà không
    ghi lý do (`TaskActions.tsx:138`). Trong màn task, nút Huỷ (huỷ task, viền đỏ) đứng ngay
    cạnh nút Merge chính.
12. **Inspector ở ≤1050 px** mở dạng overlay theo mặc định và không có nút đóng. Icon
    ở `Inspector.tsx:37` trông như bấm được nhưng thực ra chỉ để trang trí.

### C. Ngôn ngữ & nhất quán
13. **Trộn Anh và Việt:** "Task mới", "Local workspace", các tab Log/Diff/Brief, Copy/Paste,
    LIVE, GPU, kind thô như `file_edit`. Nút nav "Công việc" lại có `aria-label="Tasks"`.
14. **Thuật ngữ không thống nhất:** task / công việc / việc. Nav ghi "Tài nguyên & sử dụng" nhưng
    tiêu đề trang ghi "Tài nguyên & mức sử dụng". Phiên bản "2.2.0" bị hard-code (`App.tsx:87`).
15. **Header trạng thái** ("0 đang chạy · 0 chờ · Trực tiếp") quá nhỏ và mờ, trong khi đây là
    thông tin quan trọng nhất khi chạy nhiều agent.

### D. Accessibility
16. Nav không có `aria-current`. Tab Log/Diff/Brief không có role tab. Tablist terminal
    không điều hướng được bằng phím mũi tên. Hàng log raw là `div role=button` nhưng không có
    handler bàn phím (`LogView.tsx:80`). Trạng thái task chỉ được thể hiện bằng ký hiệu và màu
    (◐ ○ ⑂ ⏱ có thể hiển thị không đều trên Segoe UI).

## 3. Hướng thiết kế

- **Ưu tiên trạng thái:** người dùng mở app chủ yếu để hỏi "agent nào đang chạy, việc nào
  cần mình duyệt". Thông tin đó cần lớn và nằm ở đầu trang. Số liệu tài nguyên và
  quota xếp sau.
- **Ẩn bớt khi chưa có dữ liệu:** màn trống chỉ hiện một hành động chính và không hiện bảng hay biểu đồ rỗng.
- **Một ngôn ngữ:** giao diện dùng tiếng Việt. Chỉ giữ tiếng Anh cho tên riêng (Codex, Git,
  Merge, Diff) và đưa vào glossary.
- **Hành động nguy hiểm tách khỏi hành động chính,** luôn cần xác nhận và nói rõ hậu quả.

## 4. Lộ trình

### Giai đoạn 1 — Sửa lỗi & nền tảng (khoảng 2–3 ngày, rủi ro thấp)
| # | Việc | File chính | Tiêu chí xong |
|---|------|-----------|---------------|
| 1.1 | Sửa cascade sidebar. Thêm breakpoint ≤900 px: sidebar thu thành rail icon 56 px, có nút mở/đóng; ≤600 px: sidebar thành drawer | `App.tsx`, `layout.ts`, `theme.css` | Ở 375, 768 và 1024 px không có cuộn ngang và nội dung đọc được |
| 1.2 | Logo agent tự đổi màu theo theme (nền chip sáng, hoặc dùng biến thể SVG) | `Icon.tsx`, `theme.css` | Cả 4 logo đạt tương phản ≥3:1 ở cả hai theme |
| 1.3 | Banner phân loại success/info/error | `Dashboard.tsx`, `store.ts` | Thông báo sao chép hiện màu xanh và tự ẩn sau 3 s |
| 1.4 | Skeleton/loading cho welcome, Log, Diff, Compare; thêm nút "Thử lại" khi lỗi | `App.tsx`, `LogView.tsx`, `DiffView.tsx`, `ComparePage.tsx`, `TerminalPanel.tsx` | Không còn chỗ nào hiện trạng thái trống trong lúc đang tải |
| 1.5 | ConfirmDialog: Escape, giữ focus, trả focus. Với thao tác destructive, bấm ra nền không đóng dialog | `ConfirmDialog.tsx` | Có test Playwright cho bàn phím |
| 1.6 | Sửa text dính trong composer; đọc phiên bản từ `package.json` qua Vite define | `TaskComposer.tsx`, `vite.config.ts` | — |

### Giai đoạn 2 — Design tokens & dọn CSS (khoảng 2 ngày)
- Thêm token: `--space-1..8` (bước 4 px), `--radius-sm/md/lg` (6/8/12), `--text-xs..2xl`,
  màu trạng thái `--status-running/queued/review/done/failed` (dạng tint + text).
- Gộp các khối định nghĩa trùng (`.inspector`, `.topbar`, `.terminal-search`, `body`). Xoá
  selector chết (`.theme-control`, `.brand`, `.tabs`, `.counts .sep`). Tách `theme.css` thành
  `tokens.css`, `layout.css`, `components/*.css`.
- Tiêu chí: giảm ≥30% số dòng CSS, ảnh Playwright trước và sau không có khác biệt ngoài ý muốn.

### Giai đoạn 3 — Cải tiến UX theo màn hình (khoảng 4–5 ngày)
1. **Thanh trạng thái fleet ở topbar:** các chip lớn hơn, bấm được (Đang chạy 2 · Chờ duyệt 1 ·
   Lỗi 0). Bấm vào chip thì lọc danh sách task theo trạng thái đó. Badge số "chờ duyệt" hiện cả trên nav.
2. **Bảng điều khiển:** thêm nút "Kiểm tra tất cả" trên đầu trang. Thẻ agent gọn lại: một dòng trạng thái
   (đã cài / đăng nhập / quota) cùng thanh quota trực quan. Banner hướng dẫn đổi thành
   tooltip/help. Thêm khu "Phiên đang mở" và "Task gần đây".
3. **Màn Công việc:**
   - Khi chưa có task: ẩn inspector, giữ CTA và thêm 3 bước "Chọn repo → Viết brief → Duyệt
     diff".
   - Task detail: tách nhóm hành động. Nút chính (Merge / Dừng) ở bên phải. Huỷ task đưa vào menu "⋯"
     ở màu đỏ. Nút bị khoá thì có tooltip giải thích lý do.
   - Tab Nhật ký / Thay đổi / Brief dùng đúng role tab, có phím tắt 1/2/3, có badge số file.
   - Log: gom nhóm theo bước, nhãn tiếng Việt cho kind (`file_edit` → "Sửa tệp"), có
     bộ lọc chỉ hiện lỗi.
   - Diff: chọn xem unified/split, thu gọn file, virtualize khi diff lớn hơn khoảng 2.000 dòng.
4. **Composer tạo task:** chia 2 bước (Dự án → Giao việc). Nhớ lựa chọn agent/plan lần trước.
   Validate đường dẫn repo ngay khi nhập. Ctrl+Enter để gửi. Có mẫu brief.
5. **Terminal:** nhãn nói rõ hậu quả ("Ẩn" so với "Kết thúc tiến trình"). Tab điều hướng được
   bằng phím mũi tên. Nhớ cỡ chữ. Khi takeover thì hiện cảnh báo "agent sẽ tạm dừng".
6. **Tài nguyên / So sánh:** trạng thái trống có hướng dẫn thay cho biểu đồ phẳng. Bộ lọc
   thời gian dùng chung cho cả hai trang. Cân nhắc gộp thành một mục "Phân tích" có 2 tab.
7. **Command palette (Ctrl+K):** mở rộng ô tìm hiện có thành palette: nhảy tới task, mở
   CLI, tạo task, đổi theme.

### Giai đoạn 4 — Ngôn ngữ & accessibility (khoảng 1–2 ngày, làm song song giai đoạn 3)
- Gom toàn bộ chuỗi giao diện vào `web/src/strings.ts` và thống nhất glossary: *task → công việc*,
  *Log → Nhật ký*, *Diff → Thay đổi*, *Brief → Yêu cầu*, *Copy/Paste → Sao chép/Dán*,
  *Local workspace → Máy cục bộ*. Giữ nguyên Merge và tên agent.
- Thêm `aria-current="page"` cho nav và sửa các aria-label tiếng Anh. Trạng thái có cả icon SVG
  lẫn chữ, không dựa riêng vào màu. Kiểm tra tương phản đạt AA ở cả hai theme.

## 5. Kiểm chứng
- Mở rộng `test/e2e/ui.spec.ts`: chụp ảnh từng màn ở 3 kích thước × 2 theme. Test bàn phím
  cho dialog, tab và nav.
- Chạy `npx vitest run`, `npx tsc --noEmit` và `npm run test:e2e` sau mỗi giai đoạn.
- Build lại desktop (`npm run desktop:build`) để kiểm tra trong WebView2.

## 6. Phân công đề xuất
- Giai đoạn 1 và 2: `sonnet`, mỗi mục là một subagent. Mục 1.1 và 1.2 chạy song song được.
- Giai đoạn 3: leader chốt thiết kế từng màn trước (mockup hoặc ảnh), sau đó giao `sonnet` code.
  Riêng 3.3 (Task detail) và 3.7 (palette) nếu vướng thì dùng `opus`.
- Giai đoạn 4: `sonnet`. Phần quét chuỗi giao cho `haiku`.

## 7. Câu hỏi cần chốt
1. Có cần hỗ trợ cửa sổ hẹp dưới 600 px không, hay chỉ cần chạy tốt từ 900 px trở lên?
2. Glossary: thuần Việt hoàn toàn, hay giữ "task" vì người dùng đã quen?
3. Có muốn gộp So sánh và Tài nguyên thành một mục "Phân tích" không?
