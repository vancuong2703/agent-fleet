# REVIEW — web demo (bản chốt Editorial) · grader độc lập

- Người chấm: wd-g (đọc, không sửa code).
- Phạm vi đọc: `web-demo/index.html`, `dashboard.html`, `tool.html`, `terminal.html`, `jobs.html`,
  `compare.html`, `resources.html`, `assets/app.css`, `assets/app.js`, `assets/{terminal,jobs,compare,resources}.css`.
- Lệnh kiểm tra: `node web-demo/check.mjs index.html dashboard.html tool.html terminal.html jobs.html compare.html resources.html` → **pass, exit 0**
  (`OK` cả 7 trang; không trang nào `< 800` byte).
- Bằng chứng động: mở thật 7 trang bằng Playwright trên `file://`, đo ở **1440 / 768 / 375 px**,
  bấm từng control, đọc `getComputedStyle` của 15 donut, đo `scrollWidth`/`clientWidth` từng phần tử,
  tính hệ số tương phản WCAG từ token trong `assets/app.css`.
- Đối chiếu reference: `docs/mockups/dashboard-v4-c-editorial.html`, `docs/briefs/wd-1.md`, `docs/briefs/wd-2.md`.
- Phạm vi commit của 2 task trước: `1bcbefc` chỉ đụng 4 file terminal/jobs, `7e0eaa0` chỉ đụng 4 file compare/resources → **đúng ràng buộc brief**.

---

## 0. Đối chiếu 11 yêu cầu đã chốt

| # | Yêu cầu | Status | Bằng chứng |
|---|---|---|---|
| 1 | Bỏ dải "Nên dùng ngay"; tiêu đề **DASHBOARD**; đậm + 1 màu nhấn | ✅ | `grep "Nên dùng ngay" web-demo` → 0 kết quả (cụm này chỉ còn trong `docs/`). Tiêu đề `dashboard.html:42` `DASH<em>BOARD</em>`, `app.css:76-77` chỉ `em` dùng `--accent`. Một màu nhấn duy nhất (`app.css:8`). |
| 2 | Dashboard chia **4 vùng công cụ đều nhau** | ✅ | `app.css:91` `grid-template-columns:repeat(4,minmax(0,1fr))`; đo thật mỗi card 294 px ở 1440 px. |
| 3 | Codex: 2 vòng tròn (5 giờ / tuần) | ✅ | `dashboard.html:70-87` — 2 `.donut`, caption `5 hours` / `Week`, reset `1h49p` / `6d`. |
| 4 | Qoder: credit còn lại + tối đa 2 model | ✅ | `dashboard.html:101-110` — `1,240 / 2,000` + đúng 2 model (`:108-109`). |
| 5 | Antigravity CLI: quota vòng tròn, tách 2 cột 5 giờ / tuần **cho từng model** | ⚠️ **hỏng khi render** | Markup đúng 2 cột (`dashboard.html:124-147`), **but tên model ẩn hoàn toàn** — xem mục 6, lỗi #1. Ảnh render thực tế: 6 vòng tròn không có nhãn dòng. |
| 6 | OpenCode: chỉ 2 model + số token đã dùng | ⚠️ | `dashboard.html:161-167` đúng 2 model + `1.56M / 3.4M`. Nhưng id model bị cắt bằng ký tự `…` **cứng trong chuỗi** (`harbor-pool/…flash:free`, `opencode/…flash-free`), không có `title` → user không bao giờ thấy tên thật. |
| 7 | Vòng tròn chuẩn, **có viền**, hiện **% và thời gian hồi** | ⚠️ một phần | Đủ 3 lớp `.edge/.trk/.val pathLength=100` ở **cả 15/15** donut. Nhưng 6 donut Antigravity hiện số trần không `%` (`dashboard.html:133-144`); Qoder/OpenCode ở Compare không có thời gian hồi (`compare.html:114,178` — ô `.g-reset` bị dùng cho số credit/token). |
| 8 | Hàng CPU · RAM · GPU **giá trị thật**, bật/tắt được | ⚠️ | Giá trị thật đủ (`3.8 / 5.2 GHz · 8/24`, `19.8 / 32 GB`, `4.6 / 12 GB · 52°C`). Nút toggle chỉ hoạt động ở dashboard/compare/resources; **terminal.html:35 và jobs.html:35 là nút chết** (`app.js:66` return sớm vì không có `#resStrip`). Thanh CPU còn mâu thuẫn số của chính nó — mục 6, lỗi #3. |
| 9 | EN/VI, mặc định English, theme theo hệ thống | ✅ nền tảng, ❌ chi tiết | `data-lang="en"` mặc định cả 7 trang; theme mặc định không set `data-theme` → ăn `prefers-color-scheme` (`app.css:23-30`), đo thật: reload → `data-theme=null` ✅. Nhưng nhãn/toast vẫn tiếng Anh lẫn tiếng Việt — mục 6, lỗi #4. |
| 10 | Có trang chi tiết công cụ | ❌ **hỏng** | `tool.html` tồn tại và nhận `?t=`, nhưng **mọi số liệu vẫn là của Codex** cho cả 4 tool — mục 6, lỗi #2. |
| 11 | Terminal/Jobs/Compare/Resources đủ thông tin, tối giản, không bấm thừa | ⚠️ | Đủ khối thông tin, nhưng có **4 control bấm rồi không xảy ra gì** (System ở 2 trang, filter Jobs, nút "Empty state" ở header) và **nút Details/row click không đổi panel chi tiết**. |

---

## 1. Bảng điểm từng trang

| Trang | Điểm | Lý do |
|---|---|---|
| `index.html` | **7.0** | Launcher sạch, đúng shell, dịch tốt. Trừ điểm: **tràn ngang 14 px ở 375 px** (`h1.title` 64 px, `app.css:76`) và nav không có `aria-current` cho trang nào. |
| `dashboard.html` | **7.0** | Khung 4 vùng + donut 3 lớp + hàng System giá trị thật là đúng bản chốt, bố cục không vỡ ở 1440/768. Nhưng trang quan trọng nhất lại có nhiều lỗi nhất: **tên model Antigravity ẩn hoàn toàn**, id OpenCode cắt cứng `…`, thanh CPU mâu thuẫn với số GHz, 6 vòng không có `%`, và cùng tràn 14 px ở 375 px. |
| `tool.html` | **3.0** | Chỉ thay logo/tên/version theo `?t=` (`tool.html:115-129`); bảng quota, model, gói `PLUS`, lịch sử, email đều là dữ liệu Codex cứng (`tool.html:55-106`). Mở `?t=opencode` vẫn hiện "5-hour window 22% · 1h 49p" — trang chi tiết **nói sai về công cụ**, nên không thể dùng làm bản chốt. |
| `terminal.html` | **6.0** | Tab phiên ARIA chuẩn (`role=tab`/`aria-selected`/`tabindex` hoán vị đúng), Hide/End process/Reconnect hoạt động thật, khung terminal giữ nền tối độc lập theme (`terminal.css:31-43`) — rất tốt. Trừ điểm nặng: nút **System là nút chết**, banner `role="alert"` luôn hiện nên trang vừa "LIVE" vừa "Connection lost", stamp "3 sessions" nhưng chỉ 2 tab, và **không có đường về Dashboard**. |
| `jobs.html` | **6.0** | Dày thông tin nhất (6 dòng, 5 trạng thái, 3 tab Log/Changes/Request, empty state 3 bước) và không tràn ngang ở 375 px. Nhưng **chip lọc không lọc** (bấm "Failed" vẫn 6 dòng), **chọn dòng không đổi panel chi tiết** (header luôn "Add jobs page"), dòng bảng không focus được bằng bàn phím, và header có nút "Empty state" — công cụ của designer, không phải của user. |
| `compare.html` | **6.0** | Đúng brief WD-2: 4 cột → 2 cột, donut `.sm`, stats, bảng tổng hợp, toggle System hoạt động, responsive tốt nhất nhóm (không tràn ở cả 3 width). Nhưng bộ lọc 7/30 ngày **chỉ đổi mỗi "Tasks run"** (Avg time/Success đứng yên, bảng tổng hợp không đổi), và bảng cuối trang **tự mâu thuẫn với card phía trên** (54% vs 46%, cấp credit cho Antigravity, hệ số gán nhầm model). |
| `resources.html` | **7.5** | Trang đáng tin nhất: cộng gộp nội bộ khớp tuyệt đối — 7 cột chart = 42.8M = KPI; theo agent 3.1+1.2+6.9+31.6 = 42.8M; "Jobs run 501" = 128+74+96+203 ở Compare; "Avg duration 46s" = trung bình có trọng số 4 stat ở Compare. Chart đúng tỉ lệ trục (đã nghiệm thu hình học). Trừ điểm: chọn **30 ngày → "No data yet" trong khi Compare lại có số 30 ngày**, KPI không theo cửa sổ thời gian, toast tiếng Anh. |

**Trung bình 7 trang: 6.4/10.** Không trang nào phải làm lại vì bố cục; **`tool.html` phải làm lại vì dữ liệu.**

---

## 2. Thiếu thông tin — theo từng trang

**`dashboard.html`**
- Không có trạng thái "chưa đăng nhập / không đọc được quota" cho từng tool; `.dot` (`:67,99,122,159`) luôn xanh `--ok` ở cả 4 card → điểm trạng thái **không truyền tải gì**.
- Không có giới hạn tuyệt đối sau %: "22%" của cái gì (yêu cầu? dollar? request?) — user không suy ra được "còn bao nhiêu lượt".
- Dòng thời gian hồi không có mốc tuyệt đối (`g-reset` chỉ `↻ 1h49p`), trong khi Qoder lại dùng mốc ngày (`renews 28/11`) — hai kiểu cho cùng một nhu cầu.
- Hàng System (`:54-59`) thiếu nhiệt độ CPU và ổ cứng/mạng; đơn vị GHz/GB/°C đặt trong `.unit` màu `--faint` 10.5 px — đúng cái chữ user cần đọc lại mờ nhất trang.
- OpenCode `12/13 keys` (`:167`) không cho biết key nào lỗi, ở đâu.
- Không có "bản đang dùng để so là bản nào/lúc mấy" ngoài `stamp` giờ — không có ngày.

**`tool.html`**
- Toàn bộ nội dung theo tool (xem mục 1). Ngoài ra thiếu: đường dẫn CLI/version đầy đủ, repo cấu hình, log lỗi khi probe fail, và **nút quay lại** (topbar `:28` có "Back to Dashboard" ✅ nhưng nav trái thì không).
- "Actions" (`:95-101`) có "Open location" chỉ `AF.toast('demo')` — không nói mở cái gì.

**`terminal.html`**
- Không có input line/cách gửi lệnh mới; output là ảnh chụp tĩnh, không có "cuộn xuống dưới"/copy.
- Thiếu: quota tiêu thụ trong phiên (đang tốn bao nhiêu của cửa sổ 5 giờ), chi phí, và **đường về Dashboard** — nav trái ẩn hoàn toàn dưới 900 px (`app.css:38`) nên trên mobile user bị kẹt.
- Panel Session (`:122-131`) có PID, Duration nhưng không có "đã dùng X token / Y credit".
- Chỉ 2/4 tool có phiên; Antigravity và OpenCode không vào được Terminal từ Dashboard.

**`jobs.html`**
- Lý do FAILED không hiển thị ở bảng (`:135` chỉ badge) — phải đoán qua tab Log của job khác.
- Cột "Changes" (`:74`) là **số file** hay số commit? Header không đơn vị; `+128 −0` nằm ở sub-line gây nhầm.
- Không có thời lượng/ETA của job RUNNING, không có model đã dùng, không có chi phí.
- Bộ lọc thiếu `Done`/`Review` dù bảng có đúng 2 trạng thái đó (`:96,109`).
- Panel chi tiết không tự cập nhật khi đổi dòng (mục 6, lỗi #4) → user không biết mình đang xem job nào.

**`compare.html`**
- Không có cột **chi phí** (VND/USD) và không có "kịch bản nên dùng" — nhưng phải giữ yêu cầu 1 (không dải "Nên dùng ngay"), nên thiếu ở đây là **có chủ đích**; thay vào đó cần chú thích đơn vị.
- Không nói cửa sổ 7/30 ngày áp dụng cho những chỉ số nào (xem lỗi #5).
- Bảng tổng hợp không có "Resets in", trong khi đây là bảng so sánh — chỗ hợp lý nhất để đặt mốc thời gian.

**`resources.html`**
- 30 ngày: hoặc có dữ liệu hoặc nói rõ "demo chỉ dựng 7 ngày"; hiện tại hai trang trả lời trái nhau.
- KPI "Credits remaining 1,240/2,000" (`:67-71`) là **credit riêng của Qoder** nhưng nhãn chung cho toàn workspace → user hiểu nhầm là hạn mức tổng.
- Thiếu: phân bổ token theo ngày cho từng agent (chart chỉ có tổng), disk, và chi phí tiền.

**`index.html`**
- Không mô tả `tool.html` ở 4 trạng thái `?t=` (user không biết có 4 trang chi tiết).

---

## 3. Kiểm tra icon (đọc `--u:url(...)`; 82 lượt dùng, 17 hình độc bản)

| # | Path signature | Bộ Lucide | Dùng ở | Đúng nghĩa? | Đề xuất |
|---|---|---|---|---|---|
| 1 | `m4 17 6-6-6-6` + `M12 19h8` | `terminal` | nav Terminal (7 trang), "Open CLI" (`jobs.html:89`, `tool.html:98`) | ✅ | giữ |
| 2 | `M8 6h13M8 12h13M8 18h13M3 6h.01…` | `list` | nav Jobs ✅ — **và nút "Empty state" `jobs.html:48`** | ❌ ở `jobs.html:48`: icon "danh sách" cho hành động "xem trạng thái rỗng" | `inbox` (empty state) hoặc `eye`/`flask-conical` nếu là nút QA |
| 3 | 4 × `rect 7×7 rx1.5` | `layout-dashboard` | nav Dashboard | ✅ | giữ |
| 4 | `M3 3v18h18` + `M7 15l4-5 3 3 5-7` | `chart-line` | nav "Resources & usage" | ✅ (trang là usage trend) | giữ; nếu đổi trọng tâm sang phần cứng thì `activity` |
| 5 | `M16 3h5v5 / M4 20 21 3 / M21 16v5h-5 / M15 15l6 6 / M4 4l5 5` | mũi tên chéo **bắt nhau** (họ `shuffle`/`move-diagonal`) | nav Compare (7 trang) | ❌ đọc thành "ngẫu nhiên/hỗn/tráo", không phải "so sánh" | `columns-2` (rõ nhất cho 4 cột cạnh nhau), hoặc `git-compare-arrows`, `scale` |
| 6 | `circle r=9` + `M12 3v18` | gần `contrast`/`circle-half` | nút Theme (7 trang) | ⚠️ bán đúng: hình không phân biệt được System/Dark/Light, mà nhãn lại đổi (`app.js:23`) | `monitor` khi System, `moon`/`sun` theo trạng thái; icon phải đổi cùng nhãn |
| 7 | `rect 6 6 12 12 rx2` + 8 chân | `cpu` | nút "System" bật/tắt hàng tài nguyên | ✅ | giữ |
| 8 | `M3 12a9…L21 8 / M21 3v5h-5 / M21 12a9…L3 16 / M8 16H3v5` | `refresh-cw` (đủ 2 vòng) | "Check all" `dashboard.html:47`, "Re-check" `tool.html:47`, "Retry" `jobs.html:140`, "Reconnect" `terminal.html:114` | ✅ | giữ |
| 9 | `M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5` | **`refresh-cw` chỉ còn nửa trên** | 4 nút "Check" của 4 card (`dashboard.html:89,112,149,169`) | ❌ cùng một hành động "check" trên cùng một trang dùng 2 icon khác nhau (đủ vs cụt) → trông như 2 lệnh khác nhau | dùng lại bản #8 |
| 10 | `rect 5 5 14 14 rx2` | `square` | "End process" `terminal.html:82`, "Stop" `jobs.html:88,153` | ✅ (glyph stop chuẩn) | giữ; nếu muốn rõ hơn: `oct-x`/`circle-stop` |
| 11 | `M12 5v14` + `M5 12h14` | `plus` | "New session" `terminal.html:63`, "New job" `jobs.html:52,208` | ✅ | giữ |
| 12 | `circle 18,18 r3` + `circle 6,6 r3` + `M6 21V9a9 9 0 0 0 9 9` | `git-merge` | "Merge" `jobs.html:101,114` | ✅ | giữ |
| 13 | `m5 3 14 9-14 9V3z` | `play` | "Run" `jobs.html:127` | ✅ | giữ |
| 14 | `m21.7 18-8-14a2…` + `M12 9v4` + `M12 17h.01` | `triangle-alert` | banner mất kết nối `terminal.html:111` | ✅ | giữ |
| 15 | `m2 2 20 20` + 2 cung mắt | `eye-off` | nút Hide `terminal.html:77` | ⚠️ **sai khi đã ẩn**: nhãn đổi sang "Show" (`:79`) nhưng icon vẫn là `eye-off` | đổi icon cùng trạng thái (`eye` khi đang ẩn) |
| 16 | `M12 3v12M7 10l5 5 5-5M5 21h14` | `download` | "Export" `compare.html:50` | ✅ | giữ |
| 17 | `M14 2H6a2…` + `M14 2v6h6` + 2 dòng | `file-text` | 6 nút "Details" trong bảng Jobs | ⚠️ nghĩa là "tệp", còn action thật là mở panel chi tiết job; và nút này không làm gì hơn việc click vào dòng | `panel-right-open` hoặc `list-checks` |

Không có icon nào là emoji hay ảnh bitmap; toàn bộ là SVG data-URI mask (`app.css:69`) ✅.
`asset-logo/` có logo thật của 4 tool nhưng demo dùng chữ `Cx/Q/Ag/oc` trong `.logo` — chấp nhận được cho demo, nhưng cần ghi chú rõ để không bị hiểu là logo chính thức.

---

## 4. Kiểm tra vòng tròn donut (đo thật trên 15/15 donut)

Cấu trúc: **15 donut** (dashboard 8, compare 6, terminal 1). **15/15** có đủ `.edge` + `.trk` + `.val pathLength="100"` → đúng markup brief WD-1 bắt buộc, không trang nào tự vẽ kiểu khác ✅.

1. **`stroke-dasharray` theo `--pct`: ĐÚNG.** `app.css:125` `stroke-dasharray:var(--pct) 100`; computed thật = `22px, 100px` cho `--pct:22`, `91px, 100px` cho `--pct:91`… Không có donut nào lệch `--pct` so với nhãn `.pct` (đã đối chiếu từng cái: 22/34/91/78/100/95/12/40 ở dashboard, 22/34/62/91/78/46 ở compare, 46 ở terminal).
2. **Viền ngoài: CÓ nhưng gần như dính ring.** Ring ngoài cùng = `r16 + strokeWidth/2` = **19** (bản 80 px) / **18.5** (`.sm` 56 px); `.edge` ở `r20`, `stroke-width:1` → mép trong 19.5. Khe hở thực đo = **0.5 đơn vị ≈ 0.91 px** ở 80 px và **1.0 ≈ 1.27 px** ở 56 px. Yêu cầu "viền ngoài **tách** khỏi ring" mới đạt ở mức hình thức. Sửa: `.edge` `r=21` hoặc ring `r=15`, để khe ≥ 2 px.
3. **Đầu mũi tròn làm phồng giá trị — lỗi hình học thật.** `app.css:125` `stroke-linecap:round`; với `stroke-width:6`, mỗi đầu cung dài thêm 3 đơn vị ≈ **3 điểm %**, hai đầu ≈ **+6 điểm**. Hệ quả: 22 % → mắt thấy ~28 %; 12 % → ~18 %; 91 % → ~97 % (gần như khép kín, không phân biệt được với 100 %). Ảnh render card Antigravity xác nhận: vòng "12" mở to như 1/5 vòng. Reference `dashboard-v4-c-editorial.html:102` dùng `stroke-linecap:butt` — bản demo đã tự ý đổi. Sửa: `butt`, hoặc `--pct` trừ 6.
4. **Nhãn `%`: thiếu ở 6/15 donut.** `dashboard.html:133,134,138,139,143,144` in số trần (`91`, `78`, `100`, `95`, `12`, `40`) không có `%`, trong khi 9 donut còn lại có. Yêu cầu 7 nêu rõ "hiển thị %". Cùng trang, hai quy ước.
5. **Thời gian hồi: thiếu/cấu trúc sai chỗ.** Codex ✅ (`g-reset` `↻ 1h49p`, `↻ 6d`). Antigravity chỉ có reset **gộp theo cột** (`dashboard.html:127,128` `↻ 2h`/`↻ 4d`) chứ không theo model — chấp nhận được nhưng phải nói rõ là chung. Compare: Qoder (`:114`) và OpenCode (`:178`) dùng ô `.g-reset` cho **số lượng** (`1,240 / 2,000`, `1.56M / 3.4M`) → **không còn chỗ cho thời gian hồi**. Terminal `:143` ghi `↻ resets in 3h 20m` cho **cửa sổ ngữ cảnh 92K/200K** — context window không "reset" theo đồng hồ, đây là nhãn sai bản chất.
6. **Kích thước KHÔNG đồng nhất.** Cùng một dữ liệu (Codex 22 %/34 %) vẽ **80 px** ở `dashboard.html:72,80` nhưng **56 px** ở `compare.html:73,81`. Trong một trang dashboard cũng có 2 cỡ (Codex 80 px, Antigravity 56 px). Cần một biến cỡ (`--donut: 56px`) và chỉ dùng `.sm` khi thật sự cần nén.
7. **Màu theo ngưỡng không có quy tắc.** `--pct:40 → --bad` (`dashboard.html:144`) nhưng `--pct:46 → --ok` (`compare.html:173`, `terminal.html:137`); `34 → --warn` (`dashboard.html:80`) trong khi `40 → --bad`. Không định nghĩa ngưỡng ở đâu cả → color không dùng để so sánh được.
8. **Nhãn `.pct`** đặt `position:absolute;inset:0;place-items:center` ✅ giữa tâm; 16 px/80 px và 12 px/56 px — số 3 chữ số "100" ở 56 px vẫn đủ chỗ (đã nhìn ảnh).

---

## 5. Nhất quán

**Màu**
- Một màu nhấn `--accent` (`app.css:8`) dùng đúng chỗ: `em` trong title, `nav a[aria-current]` border (`app.css:46`), `.btn.ghost:hover`, `.chip.sel`… ✅ yêu cầu 1.
- Tier color nhất quán tuyệt đối giữa 4 trang cho cùng tool (`PLUS #6d4bf0`, `PRO TRIAL`, `PRO`, `BYOK`) ✅.
- ❌ **Nhãn `.dot` trạng thái trái nhau**: Qoder `.dot` xanh ở `dashboard.html:99` nhưng `.dot warn` ở `compare.html:104`; cả 4 dot dashboard đều xanh nên không mang tin.
- ❌ **Thanh `.bar` đổi nghĩa trong cùng một trang**: Qoder `dashboard.html:104` vẽ 62 % = **còn lại** (1 240/2 000), OpenCode `:166` vẽ 46 % = **đã dùng** (1.56/3.4). Hai card cạnh nhau, cùng component `.bar`, hai ngữ nghĩa ngược.
- ❌ Ở `compare.html` cột "Credit / token" trộn 3 loại thanh: Codex 7 % là **tỉ trọng tổng token** (`:214`, 3.1/42.8), Qoder 38 % và OpenCode 46 % là **đã dùng/cap** (`:223,241`). Không có chú thích nào.
- ❌ Tương phản (tính từ token, WCAG): `--faint #a3a399` trên `--bg #fbfbf9` = **2.45:1** — trượt cả mốc 3:1; mà `--faint` lại đang gánh **chữ quan trọng và nhỏ nhất**: `.g-reset` (thời gian hồi, 10 px), `.mtx th`/`.colreset` (9–9.5 px), `.res .unit` (GHz/GB/°C, 10.5 px), `.foot .when`, `.ver`, `.panel h4`. `--accent` làm chữ nhỏ = **3.52:1** (trượt 4.5:1) ở `.btn.ghost:hover` 11.5 px và `.tbtn[aria-pressed]`. `.tier` chữ trắng trên `--trial` **3.42:1**, `--byok` **3.87:1**, `--free` **4.41:1** (9 px). `.badge.warn` **3.13:1**. Dark theme khá hơn nhưng `--faint` vẫn **3.56:1**.

**Khoảng cách / cỡ chữ**
- `.zones` và `.cmp` cùng công thức (grid + border trong, `gap:0`) ✅; `.panel` 20 px, `.stack`/`.grid2` 18 px, `.res` `margin-bottom:24px` khớp `.head` `margin-bottom:24px` ✅.
- ❌ Tiêu đề trang có **hai thang không theo quy tắc**: 64 px (index, dashboard, compare, resources) vs `.title.sm` 38 px (terminal, jobs, tool). Không có trang nào có `h2`; mọi section dùng `.panel h4` 10 px mono — bậc thang quá dốc (64 → 17 → 10).
- ❌ `.btn.sm` khai báo trùng nguyên văn ở `terminal.css:11` và `jobs.css:8` (nên thành 2 bản sao, không phải token); `.tscroll`/`button.chip` trùng ở `compare.css:29-32,42` và `resources.css:21-24,36`.
- ❌ `tool.html:40` hard-code `width:52px;height:52px;border-radius:13px` thay vì class cỡ logo; 4 gradient logo lặp chuỗi hex ở 5 file.

**Trạng thái rỗng**
- Có: `jobs.html:202-212` (empty + 3 bước + CTA ✅ tốt nhất), `resources.html:127-132` (empty 30 ngày).
- Không có: dashboard (khi tool chưa login/không đọc được), compare, terminal (0 phiên), tool (`?t=sai` âm thầm rơi về Codex, `tool.html:123`). Không trang nào có skeleton/loading thật — `.spin` (`app.css:70`) chỉ quay icon.

**ARIA**
- `aria-current="page"` ✅ ở 5/7 trang; ❌ thiếu ở `index.html` và `tool.html` (đang xem chi tiết tool nhưng nav không sáng mục nào).
- `role="tab"`/`role="tabpanel"`/`aria-selected`/`aria-controls`/`tabindex` **đúng và đủ** ở `jobs.html:164-197` và `terminal.html:54-105` ✅ — hai trang này làm chuẩn hơn mức demo.
- ❌ Tab không có điều hướng phím mũi tên (chỉ `onclick`), nên chưa đúng APG cho `tablist`.
- ❌ `jobs.html:79` dòng bảng click được nhưng `tabindex=null`, `role=null` (đo thật) → không chọn được job bằng bàn phím.
- ❌ `<html lang="en">` **không bao giờ đổi sang `vi`** (`app.js:5-15` chỉ set `data-lang`) → screen reader đọc tiếng Việt bằng quy tắc tiếng Anh.
- ❌ `.toast` (`dashboard.html:177` và 6 trang) không có `role="status"`/`aria-live` → mọi phản hồi "Checked (demo)", "Reconnected" vô hình với screen reader; ngược lại `terminal.html:110` dùng `role="alert"` cho banner **hiện thường trực** từ lúc tải trang → thông báo lỗi giả.
- ⚠️ Bộ lọc dùng `aria-pressed` trên `.chip` (`jobs.html:60-63`, `compare.html:47-48`, `resources.html:89-90`) trong khi bản chất là single-select → `role="radiogroup"`/`aria-checked` hoặc tablist đúng hơn.
- ⚠️ `.donut` không có `role="img"`/`aria-label`; `.pct` chỉ là text nên "91" (không %) đọc ra số trần.

---

## 6. Top 5 việc nên sửa (theo mức ảnh hưởng)

1. **Tên model Antigravity biến mất hoàn toàn — yêu cầu 5 hỏng khi render.**
   `assets/app.css:139` `.mtx td:first-child{…overflow:hidden;text-overflow:ellipsis;max-width:0}`.
   Đo thật ở 1440 px: `td` có `width: 0 px`, `overflow:hidden`, `max-width:0px` → "Gemini 4 Argon / Gemini models / Claude & GPT" **không nhìn thấy** (ảnh card: chỉ còn 6 vòng tròn). Mẹo ellipsis này cần `table-layout:fixed` + `width` phần trăm, `max-width:0` một mình làm sập cột.
   Sửa: `.mtx{table-layout:fixed}` + `.mtx td:first-child{width:46%;max-width:none}` (bỏ ellipsis, cho `overflow-wrap`), hoặc cột tên ra khỏi table.

2. **`tool.html` nói sai về cả 4 công cụ — yêu cầu 10 chưa đạt.**
   `tool.html:115-129` map chỉ gán `t-title`, `t-ver`, `t-logo`; 5 panel còn lại (`:53-106`) là số liệu Codex cứng.
   Nghiệm thu: `?t=agy` → "Antigravity CLI" + bảng "5-hour window 22% / Week 34%" + model `gpt-6.1-sol` + gói `PLUS`; `?t=opencode` → vẫn "5-hour window 22% · 1h 49p" (OpenCode là BYOK/token, không có cửa sổ 5 giờ).
   Sửa: mỗi tool một khối `<template data-tool="…">` (quota theo đúng loại: ring 2 cột cho AGY, credit cho Qoder, token+key cho OpenCode) và `?t=sai` → empty state, không âm thầm về Codex.

3. **Hình học donut: mũi tròn phồng giá trị + 6 vòng thiếu `%` + 2 cỡ cho cùng dữ liệu.**
   `assets/app.css:125` `stroke-linecap:round` (+≈6 điểm %: 22→~28, 12→~18, 91→~97); `dashboard.html:133-144` thiếu `%`; `dashboard.html:72,80` 80 px vs `compare.html:73,81` 56 px cho cùng 22 %/34 %; khe viền `app.css:123-124` chỉ 0.9–1.3 px.
   Sửa: `stroke-linecap:butt` (như reference `dashboard-v4-c-editorial.html:102`), thêm `%` cho mọi `.pct`, chốt một cỡ (hoặc một biến), `.edge` `r=21`.

4. **Control bấm không xảy ra gì / nói dối — vi phạm yêu cầu 11.**
   - Nút System chết: `terminal.html:35`, `jobs.html:35` gọi `AF.toggleRes()` nhưng 2 trang này không có `#resStrip` → `app.js:66` return, `aria-pressed` vẫn lật thành `false` (đo thật: `resStripExists=false/pressed=true`).
   - Filter Jobs không lọc: `jobs.html:240-247` `JOB.filter()` chỉ đổi class; bấm "Failed" vẫn 6 dòng (đo thật).
   - Chọn dòng không đổi chi tiết: `jobs.html:233-239` chỉ thêm `.sel`; header vẫn "Add jobs page" khi chọn "Refactor quota parser" (đo thật).
   - "Check all" phá huỷ icon + nhãn dịch: `app.js:52,55` gán `btn.textContent` → đo thật `children=0` sau khi bấm, và trong VI label quay về tiếng Anh `"Check all"` (`dashboard.html:46` truyền `label` tiếng Anh cứng; `tool.html:47` truyền `'Re-check'`).
   - Lọc 7/30 ngày chỉ đổi một chỉ số: `compare.html:256-262` chỉ phần tử có `data-7` đổi (Avg time giữ 39.8 s, Success giữ nguyên, bảng tổng hợp `:198-246` bất động); `resources.html:197-204` đổi chart nhưng KPI vẫn 7 ngày (`:63-81`) và **30 ngày = "No data yet"** (`:127-132`) trong khi Compare có số 30 ngày (`:92,120,156,184`) → hai trang phủ định nhau.
   - Nút "Empty state" `jobs.html:47-50` là cần-câu-thử của designer, đặt ở header trang user.

5. **Tương phản + mobile + i18n sót.**
   - `app.css:7` `--faint` **2.45:1** cho `.g-reset`/`.mtx th`/`.res .unit` (9–10.5 px) — đúng các chữ yêu cầu 7 & 8 bắt phải hiện; `app.css:8` `--accent` 3.52:1 khi làm chữ nhỏ; `.tier` trắng trên `--trial/--byok/--free` <4.5 (`app.css:109-110`).
   - Tràn ngang 14 px ở 375 px trên `index.html` và `dashboard.html` (thủ phạm đo được: `h1.title`, `right=374` > `clientWidth=360`) — thiếu override ≤560 px mà `compare.css:19` và `resources.css:10` đã có (`h1.title{font-size:38px}`); vi phạm tiêu chí "375 px không cuộn ngang" trong `wd-1.md`/`wd-2.md`.
   - Chuỗi Anh lẫn trong trang Việt: `dashboard.html:88,111,148,168` `check 18:41:50` không có `data-vi` (Compare đã dịch, `compare.html:94`), `terminal.html:142` `/ 200K tokens`, `jobs.html:119,145` `#4818 · queued` / `#4816 · waiting slot`, `tool.html:62-63` `1h 49p` (h + p lai) và `6 days`; toast Anh cứng ở `compare.html:50,269`, `resources.html:47,203`, `tool.html:99`; nhãn `Dark/Light/System` không dịch (`app.js:23`).
   - `<html lang>` không đổi (`app.js:5-15`), `.toast` thiếu `aria-live`, `role="alert"` dùng sai (`terminal.html:110`), dòng bảng không focus được (`jobs.html:79`).
   - Không lưu lựa chọn theme/ngôn ngữ (đo thật: reload → `data-theme=null`, `data-lang=en`) — user chọn Dark xong mất.
   - `terminal.html:46` "3 sessions" nhưng chỉ 2 tab (`:55-60`).
   - `terminal.html` và `jobs.html` không có "Back to Dashboard" (chỉ `tool.html:28` có), mà nav trái ẩn dưới 900 px (`app.css:38`).

---

## 7. Kết luận

**Đạt (chỉ sửa lists ở mục 6, không dựng lại):**
- `resources.html` — **7.5**: dữ liệu nội bộ khớp nhau tuyệt đối (chart 42.8 M = KPI = tổng theo agent; 501 jobs = tổng Compare; 46 s = trung bình có trọng số), chart đúng tỉ lệ trục, empty state có chủ đích, toggle System hoạt động. Đây là trang chuẩn nhất để các trang khác soi lại số.
- `dashboard.html` — **7.0**: đúng 11/11 khung yêu cầu, bố cục 4 vùng không vỡ; nhưng **phải sửa lỗi #1 (nhãn model)** trước khi trình bày, vì yêu cầu 5 hiện chỉ đúng trong source, sai trên màn hình.
- `compare.html` — **6.0** và `terminal.html` — **6.0** và `jobs.html` — **6.0**: đạt về mặt thiết kế/bao phủ thông tin, **chưa đạt về hành vi** (lọc, chọn dòng, cửa sổ 7/30, nút System chết). Với một demo "chốt Editorial", các control này phải hoặc chạy được hoặc bỏ.
- `index.html` — **7.0**: dùng được, sửa overflow 375 px.

**Phải làm lại:**
- `tool.html` — **3.0**: không phải lỗi thẩm mỹ mà là lỗi nội dung — trang chi tiết hiển thị số liệu Codex cho Antigravity/OpenCode/Qoder. Yêu cầu 10 coi như chưa hoàn thành; cần dựng dữ liệu theo `?t=` cho từng loại quota (ring 2 cột / credit / token+key) và thêm trạng thái `?t=` không hợp lệ.

**Một câu tổng quát:** phần nhìn đã bám đúng bản Editorial (1 nhấn màu, 4 vùng đều, donut 3 lớp, giá trị thật), nhưng **độ tin của số** là chỗ phải quay lại — một nhãn model bị ẩn 0 px, một trang chi tiết sai cả 4 tool, và hai trang phủ định nhau về "30 ngày" đều là lỗi mà user chấm bản chốt sẽ bắt được ngay.
