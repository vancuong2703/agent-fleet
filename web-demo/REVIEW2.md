# REVIEW2 — web demo chấm lại sau WD-F1 + WD-F2 · grader độc lập

- Người chấm: wd-g2. Chỉ đọc và chấm; **không sửa file nào ngoài `web-demo/REVIEW2.md`**.
- Phạm vi đọc: 7 trang + `assets/app.css`, `assets/app.js`, `assets/pages.css`, `assets/{terminal,jobs,compare,resources}.css`.
- Source-of-truth lần trước: `web-demo/REVIEW.md` (mục 1 = điểm cũ, mục 6 = top 5 lỗi).
- Phạm vi commit của 2 bản sửa (đã nghiệm thu theo `--stat`): `c8c91fa` (WD-F1) chỉ đụng `app.css`, `app.js`, `dashboard.html`, `index.html`, `tool.html`; `0da082b` (WD-F2) chỉ đụng 4 trang + 5 CSS. **Đúng ràng buộc brief.**
- Lệnh kiểm tra: `node web-demo/check.mjs index.html dashboard.html tool.html terminal.html jobs.html compare.html resources.html REVIEW2.md` → **pass, exit 0**, 8/8 `OK`.
- Bằng chứng động: phục vụ `web-demo/` bằng HTTP cục bộ (`file://` bị chặn trong môi trường chấm), mở thật 7 trang bằng Playwright, đo ở **1440 / 768 / 414 / 375 px**; bấm từng control và đọc DOM trước/sau; `getComputedStyle` trên **23/23 donut**; tính hệ số tương phản WCAG từ chính màu computed (không tính tay từ token); kiểm tra hit-test (`elementFromPoint`) cho từng control ở 375 px. Font Google đã load thật (`document.fonts.check` = true cho `Bricolage Grotesque` và `JetBrains Mono`), nên số đo typography là số của bản chốt.

**Kết luận nhanh: 5 lỗi nặng → 3 Đã sửa, 2 Một phần.** Điểm trung bình 7 trang: **6.4 → 8.2**. Không trang nào phải làm lại.

---

## 1. Xác minh 5 lỗi nặng nhất của `REVIEW.md` mục 6

### 1.1 Cột tên model Antigravity — **ĐÃ SỬA** ✅

| Dẫn chứng | Lần trước | Lần này (đo thật) |
|---|---|---|
| CSS | `max-width:0` + `overflow:hidden` + `text-overflow:ellipsis` làm sập cột | `app.css:140` `.mtx{table-layout:fixed}`, `:142` `.mtx th:first-child{width:38%}`, `:145` `td:first-child{white-space:normal;overflow-wrap:anywhere}` |
| Computed của `td:first-child` | `width:0px`, `max-width:0px` | `max-width:none`, `overflow:visible`, `text-overflow:clip` |
| Bề rộng cột ở 1440 px | 0 px → vô hình | **96 px**, `scrollWidth 96 == clientWidth 96` (không cắt), cả 3 tên render tại `x=846` |
| 768 px / 375 px | — | cột **117 px** / **101 px**, `clip=false` cả 3 dòng |
| `tool.html?t=agy` | dùng `.mtx` nên cũng hỏng | 3 tên hiển thị, `w=101 clip=false` ở 375 px |

`dashboard.html:132,137,142` = "Gemini 4 Argon / Gemini models / Claude & GPT" hiện đầy đủ; hàng cao 73 px vì donut 56 px, không vì tên bị gấp dòng quá mức. Yêu cầu 5 giờ đã đúng cả trong source lẫn trên màn hình.

### 1.2 `tool.html` đúng dữ liệu theo `?t=` — **ĐÃ SỬA** ✅

Kiến trúc mới: 5 khối `<template data-tool>` — `codex` (`tool.html:58`), `qoder` (`:126`), `agy` (`:178`), `opencode` (`:243`), `__none__` (`:296`) — nạp theo `?t=` tại `tool.html:319-325`. Nghiệm thu thật từng trạng thái:

| `?t=` | Tên/version/logo | Khối quota (đo thật) | Có ring "5 giờ"? |
|---|---|---|---|
| `codex` | Codex · codex-cli 0.166.0 · Cx | `Hạn mức theo cửa sổ` — 2 donut 80 px `--pct:22`/`34`, caption `5 giờ`/`Tuần`, reset `↻ 1h 49p`/`↻ 6 ngày`, gói **PLUS** | có, đúng loại |
| `qoder` | Qoder · qodercli 1.1.81 · Q | `Credits` — `1,240 / 2,000`, bar **62 %** (= 1240/2000 ✓), `760 used`, **0 donut**, gói PRO TRIAL | không (đúng) |
| `agy` | Antigravity CLI · agy 1.4.12 · Ag | `Quota by model` — ma trận 3 model × 2 cột + `Credits remaining 1,120/2,000` + chú thích "Reset times are shared per column" | ring 2 cột theo model (đúng yêu cầu 5) |
| `opencode` | OpenCode · opencode 2.2.5 · oc | `Token đã dùng` `1.56M/3.4M` + `Model miễn phí` (id đầy đủ, có `title`) + `Pool key` 3 dòng, trong đó `key-13 EXPIRED` | không (đúng — BYOK/token) |

`?t=xyz` → **không còn âm thầm rơi về Codex**: title "Tool not found", `ver` rỗng, logo `?`, `document.title` đổi, khối `.empty` hiện kèm 4 link `tool.html?t=…` (đo thật); đổi EN↔VI trong trạng thái này vẫn dịch đúng (`tool.html:341-343`). Nút "Open location" nói mơ hồ đã thay bằng **"Open config folder"** có `title` đường dẫn riêng từng tool (`~/.codex`, `~/.qoder`, `~/.antigravity`, `~/.config/opencode`) và toast bilingual.
*Còn sót:* nav của `tool.html` vẫn không có `aria-current="page"` (đo: cả 5 link = `-`).

### 1.3 Hình học donut — **MỘT PHẦN** ⚠️

Đã sửa (đo trên 23/23 donut: dashboard 8, compare 6, terminal 1, tool 8):

- **`stroke-linecap`**: `app.css:131` = `butt`; computed **butt trên cả 23/23**. `stroke-dasharray` khớp `--pct` tuyệt đối (`--pct:22` → `22px, 100px`), không còn +6 điểm giả tạo: 22 % đọc là 22 %, 91 % không còn gần khép kín như 100 %.
- **Nhãn `%`**: **23/23** `.pct` có `%` (grep: không còn số trần). Đã đối chiếu từng giá trị với `--pct`.
- **Khe viền**: chuẩn mới `edge r=21` + `trk r=15` cho **16/23** donut → khe đo được **4.55 px** (bản 80 px) và **3.82 px** (bản 56 px), vượt mốc ≥2 px mà bản cũ chỉ đạt 0.91–1.27 px. Mép ngoài `27.36 px < 28 px` bán kính hộp → không bị cắt.
- **Một biến cỡ**: `--donut` (`app.css:16,126`) + `.donut.sm{--donut:56px}` (`app.css:133`) — đúng hướng sửa đề xuất.
- Nhãn 3 chữ số vẫn trong lỗ tròn: "100 %" @56 px = chữ 29.7 px trong lỗ 31.8 px (còn 2.2 px, không clip).

Chưa sửa:

1. **7/23 donut vẫn dùng cặp cũ `r=20`/`r=16`** → `compare.html:75,83,111,140,148,176` và `terminal.html:147`. Khe đo thật **1.27 px** — đúng mức mà mục 6 lỗi #3 đã kết luận "gần như dính ring". WD-F1 đổi trong HTML của dashboard/tool, WD-F2 không đổi trong HTML của compare/terminal; `app.css` không nắm hình học (nó nằm trong markup SVG), nên lệch này không thể tự khỏi.
2. **Vẫn 2 cỡ cho cùng một dữ liệu**: Codex 22 %/34 % = **80 px** ở `dashboard.html:72,80` và `tool.html:65,73`, nhưng **56 px** ở `compare.html:74,82`. Trong chính hàng 4 card của dashboard cũng mix: Codex 80 px (đo) vs Antigravity 56 px (đo).
3. **Không có quy tắc ngưỡng màu**: `grep -i "ngưỡng|threshold|legend|chú thích"` → **0 kết quả**. Ánh xạ `--pct → --col` đo từ source: `bad 12, bad 22, warn 34, bad 40, ok 46, ok 62, ok 78, ok 91, ok 95, ok 100` → **34 = warn nhưng 40 = bad**, và 46 = ok. Màu vẫn không dùng để so sánh được.

### 1.4 Control chết — **ĐÃ SỬA cả 5 mục con** ✅ (còn một lớp lỗi nhẹ hơn, xem mục 4)

| Control (lỗi cũ) | Cách sửa | Kết quả đo thật |
|---|---|---|
| **System** ở terminal/jobs là nút chết (`app.js:66` return sớm) | WD-F2 cho **cả hai trang một `#resStrip` thật** (`terminal.html:52-57`, `jobs.html:56-61`) thay vì ẩn nút; `app.js:117-120` vẫn ẩn nút nếu trang nào thiếu strip | Bấm 1 phát: `aria-pressed` `true→false` **và** `#resStrip.hidden=true`. Bấm lại: trả về đúng. Áp dụng cho cả 5 trang có strip |
| **Lọc Jobs không lọc** (`jobs.html:240` chỉ đổi class) | `data-status` trên từng `<tr>` (`jobs.html:88,101,114,127,140,153`) + `applyFilter()` thật (`:378-392`) | All=6, Running=1, Waiting=1, Queued=1, Review=1, Done=1, Failed=1; `#jobCount` theo ("1 of 6 jobs"), single-select (chip khác tự trả `aria-pressed=false`), All khôi phục 6 |
| **Chọn dòng không đổi panel chi tiết** | `DATA` 6 job thật (`jobs.html:225-318`) + `renderJob()`/`select()` (`:330-376, 405-414`) | Bấm dòng #4817: header `Add jobs page → Migrate auth store`, meta `#4817 · FAILED · Codex · harbor/fix/auth`, log 6→5 dòng, Changes 2→4 tệp (dòng đầu `server/auth/store.py`), Request đổi; `.sel` + `aria-pressed=true` dời đúng dòng |
| **7/30 ngày chỉ đổi "Tasks run"** | `applyWindow()` (`compare.html:270-282`, `resources.html:234-246`) + chú thích `compare.html:195` nói rõ chỉ số nào theo cửa sổ | Compare: **12/12 stat thẻ + 8/8 giá trị bảng tổng hợp + `#winNote`** ("Last 7 days"→"Last 30 days") cùng đổi. Resources: KPI `42.8M→153.0M`, `501→2,122`, `46s→45s`, chart 7 ngày↔4 tuần; KPI credit được ghi nhãn "current plan · not window-scoped" (`resources.html:79`) |
| **"Check all" phá icon + nhãn dịch** | `app.js:80-99` chỉ ghi vào `<span>` (`:81,87,92`), `data-steps`, `:disabled` (`app.css:69`) | `children` trước/giữa/sau = **2/2/2**, `i.ic` còn nguyên cả 3 lần; nhãn `Check all → Checking 1/4 → Check all`; bản VI: `Kiểm tra tất cả → Đang kiểm tra 1/4 → Kiểm tra tất cả` (`data-vi` giữ nguyên); `#stamp` 18:41 → 13:36 (giờ thật); toast "Hoàn tất (demo)" |
| Nút "Empty state" của designer ở header Jobs | đã xoá khỏi header (grep chỉ còn khối `.empty` thật `jobs.html:203`) | Header Jobs giờ gồm: stamp "6 jobs" + "New job". Không còn control QA |

### 1.5 Tương phản `--faint` + tràn ngang 375 px + i18n — **MỘT PHẦN** ⚠️

**(a) `--faint`** — đã đổi token: `app.css:7` `#a3a399 → #7b7b70`, dark `app.css:20,27` `#8a8a80`. Hệ số **tính từ màu computed** trên nền trang thật:

| chỗ dùng (cỡ chữ) | cũ | mới (light) | mới (dark) |
|---|---|---|---|
| `.foot .when` 10.5 px · `.res .unit` 10.5 px · `.g-reset` 10 px · `.mtx th` 9.5 px | **2.45:1** | **4.13:1** | **5.42:1** |

→ đã vượt mốc 3:1, **nhưng vẫn dưới 4.5:1** cho text nhỏ (9–10.5 px) ở theme sáng. Chưa đạt AA cho đúng nhóm chữ mà yêu cầu 7 & 8 bắt phải hiện.

Chi tiết tương phản **không đụng tới** (số đo lần này giống hệt lần trước): `--accent #e8551f` làm chữ nhỏ = **3.52:1** (`.btn.ghost:hover` 11.5 px, `.tbtn[aria-pressed]`); `.tier` chữ trắng: **PRO TRIAL 3.42:1**, **BYOK 3.87:1**, FREE 4.41:1 (9 px). `--trial/--byok/--free` cũng không định nghĩa lại trong dark nên hai giá trị sai trên tồn tại ở cả hai theme.
**Lỗi mới phát hiện:** `.mult.free` (`app.css:155`) lấy nền `var(--ok)`, mà `--ok` đổi thành `#34d07f` trong dark (`app.css:22`) → chữ trắng trên nền đó đo được **2.00:1** (light: 4.41:1). Chip "FREE" của Qoder/OpenCode gần như không đọc được ở theme tối.

**(b) Tràn ngang 375 px** — đã sửa phần overflow: media `h1.title{font-size:40px}` chuyển từ CSS từng trang vào `app.css:80-83` nên index/dashboard được hưởng. Đo `documentElement.scrollWidth == clientWidth` (360 = 360) trên **cả 7 trang ở 375 px**; `h1` index giờ 40 px / 225 px rộng. Bảng dài nhốt trong `.tablewrap`/`.tscroll` (`jobs.css:11`, `pages.css:31-34`) — jobs@375: `scrollWidth 940 > clientWidth 298` nhưng `overflow-x:auto`, trang không cuộn ngang.

**Nhưng sinh ra lỗi mới, nặng hơn cả overflow: mất đường đổi ngôn ngữ trên mobile.** `.toggle{overflow:hidden}` (`app.css:56`) + topbar `nowrap` (`app.css:50`) → ở chiều rộng nhỏ, flex **nén pill EN/VI** thay vì tràn trang:

| trang | 375 px | 414 px |
|---|---|---|
| `dashboard.html` | pill **19 px** (cần 77 px), `#lang-vi` còn **0 px nhìn thấy**, `elementFromPoint` tại tâm VI trả về **`#resToggle`** → **bấm không đổi được tiếng Việt** | pill 58 px, VI còn 19 px, vẫn không bấm được |
| `tool.html` | pill **41 px**, VI còn **1 px**, `viClickable=false` | — |
| `index/terminal/jobs/compare/resources` | pill 79 px, `viClickable=true` ✅ | — |

Nguyên nhân: rule cứu topbar `@media(max-width:640px){.topbar .tbtn span{display:none}}` nằm trong **`terminal.css:55` và `jobs.css:44`** (phạm vi WD-F2), còn hai trang của WD-F1 (`dashboard.html`, `tool.html`) chỉ nạp `app.css` nên không có. Một bản sửa shared đáng ra phải đặt ở `app.css`.

**(c) i18n sót** — đã sửa: `app.js:31-32` set cả `document.documentElement.lang` (đo: `lang="vi"` thật); nhãn theme dịch (`app.js:12-15`, đo "Tối/Sáng/Theo hệ thống"); toast thêm `role=status`+`aria-live=polite` (`app.js:112-115`); banner `role="alert"` trực sẵn ở terminal thay bằng notice `role="status"` + `hidden`, chỉ hiện sau khi End process (`terminal.html:119`); `check 18:41:50` có `data-vi` (`dashboard.html:88,111,148,168`); OpenCode id có `title` ở dashboard/tool; "3 sessions" → **"2 sessions"** (`terminal.html:47`); **lưu theme/ngôn ngữ** (đo: reload vẫn `data-theme="dark"`, `lang="vi"`, `af-theme=dark`).
Còn sót: `compare.html:79,87,144,152,181` — **5/6 nhãn `.g-reset` không có `data-vi`** (`↻ 1h49p`, `↻ 6d`, `↻ 2h`, `↻ 4d`, `↻ 3d`), trong khi dashboard/tool đã dịch (`↻ 1h 49p`, `↻ 6 ngày`); chuỗi `↻ 1h49p` còn sai ngay ở bản tiếng Anh ("p" là viết tắt của *phút*). Ô `760 / 2,000 credits` (`compare.html:230`) và `1.56M / 3.4M tokens` (`:248`) không dịch. `harbor-pool/…flash:free` vẫn cắt cứng và **không `title`** ở `compare.html:172,246` và `resources.html:210`.
Đo sweep VI trên dashboard: sau khi đổi, text tiếng Anh còn lại chỉ là tên riêng model ("Gemini 4 Argon", "Claude & GPT") — trang sạch.

---

## 2. Bảng điểm mới từng trang (so với `REVIEW.md` mục 1)

| Trang | Cũ | **Mới** | Δ | Lý do |
|---|---|---|---|---|
| `index.html` | 7.0 | **8.0** | +1.0 | Hết tràn 375 px (đo 360=360); mô tả đủ 4 trạng thái `?t=` (`:58`) — đúng gợi ý cũ; 6 card đều là link thật, pill VI bấm được. Trừ: `h1` vẫn "DASHBOARD" trùng trang dashboard, không có `aria-current` (chấp nhận được vì index không nằm trong nav), chưa có empty/loading. |
| `dashboard.html` | 7.0 | **8.0** | +1.0 | Yêu cầu 5 hiển thị đúng thật; 8/8 donut butt + `%` + khe 3.8–4.55 px; id OpenCode có `title`; dot giờ có khác trạng thái; Check all/Check/System/theme/lang đều chạy và lưu. **Trừ nặng**: ở ≤414 px không đổi được sang tiếng Việt (pill bị nén, `#lang-vi` 0 px); 4 card trộn cỡ 80/56 px; tương phản accent/tier/dot-free chưa đổi; CPU bar vẫn sai; dot Contradiction với compare (mục 3.2). |
| `tool.html` | 3.0 | **8.5** | **+5.5** | Trang bị coi là "phải làm lại" giờ dựng lại đúng nghĩa: 4 template theo 4 loại quota + empty state cho `?t=` sai + `document.title` + nút config có đường dẫn, tất cả bilingual và tự re-render khi đổi ngôn ngữ. Trừ: không `aria-current`; mobile mất pill VI (như dashboard); `.mult.free` 2.00:1 ở dark; nav trái vẫn ẩn <900 px (topbar đã có "Back to Dashboard" nên không kẹt). |
| `terminal.html` | 6.0 | **8.0** | +2.0 | System giờ là nút **thật** (có `#resStrip`); banner lỗi không còn trực sẵn (`role=status`, `hidden`, hiện đúng lúc sau End); "2 sessions" khớp 2 tab; tab ARIA đổi đúng `aria-selected`/`tabindex`; A−/A+ đổi `--fs` 12.5→14.5 px (computed 14.5 px); End process **disabled** Hide/End + badge ENDED + notice, Reconnect khôi phục — không còn nút bấm trong trạng thái vô nghĩa; context ghi "context used" thay cho "resets in". Trừ: icon Hide vẫn `eye-off` khi nhãn đã là "Show"; donut `r=20` khe 1.27 px; "New session" chỉ toast; không có đường về Dashboard ở mobile; tab không điều hướng bằng phím mũi tên. |
| `jobs.html` | 6.0 | **8.5** | +2.5 | Lọc thật (6/1/1/1/1/1/1), chọn dòng thật (header + meta + log + 4 tệp + request), 7 chip đủ bộ trạng thái kể cả Done/Review, `.rowbtn` là `<button>` thật → focus được bằng phím (đo `activeElement === btn`), lý do FAILED hiện trong log #4817, nút QA "Empty state" đã bỏ, cột Changes có sub-line `#4821 · +128 −0` nên không còn mơ hồ, dữ liệu song ngữ. Trừ: Dừng/Hợp nhất/Chạy/Thử lại chỉ toast; empty state `#jobsEmpty` **không tới được** vì 6 status đều ≥1 job; mobile không còn link nào về Dashboard. |
| `compare.html` | 6.0 | **8.0** | +2.0 | Cửa sổ 7/30 giờ chạy trên **20 giá trị** + `winNote` + có chú thích ("The gauges … do not move with it") nên không còn "lọc nửa vời"; bảng tổng hợp **không còn tự mâu thuẫn**: 46 % (không phải 54 %), Antigravity "included in PRO plan" (không còn bị cấp credit), model đúng từng dòng, cột Credit/token có giải thích nghĩa (`:255`); `Qoder` tách `.g-num` (1,240/2,000) khỏi `.g-reset` (↻ renews 28/11) — đúng chỗ thiếu thời gian hồi cũ. Trừ: **6 donut `r=20`** khe 1.27 px; cỡ 56 px cho cùng dữ liệu 80 px ở dashboard; 5/6 `.g-reset` thiếu `data-vi` + chuỗi `1h49p`; dot Qoder warn trái dashboard; id cắt không `title`; mobile không về Dashboard. |
| `resources.html` | 7.5 | **8.5** | +1.0 | Bỏ được mâu thuẫn "30 ngày = No data yet": chart 30 ngày thật (4 tuần) và KPI theo cửa sổ. **Cộng gộp vẫn khớp tuyệt đối, đo lần này ở cả 2 cửa sổ**: 7 ngày `3.1+1.2+6.9+31.6 = 42.8` = 7 cột chart (5.2+6.9+4.4+7.8+6.1+8.4+4.0 = 42.8) = KPI; 30 ngày `11.6+4.4+24.1+112.9 = 153.0` = 4 cột chart = KPI; `Jobs run 2,122 = 541+318+402+861` của compare; `Avg 45s` = trung bình có trọng số 30 ngày của compare; KPI credit ghi rõ "not window-scoped" (đúng gợi ý cũ). Empty state chuyển thành block `#chartEmpty` có chủ đích. Trừ: OpenCode "31.6M/112.9M tokens đã dùng" vô lý so với trần 3.4M ở 3 trang khác; dot/badge trạng thái khác với tool; mobile không về Dashboard. |

**Trung bình: 6.4 → 8.2/10.** `tool.html` (3.0) không còn là trang ngoại lệ; trang thấp nhất hiện nay là dashboard/terminal/compare (8.0) và **không trang nào dưới 8.0**.

---

## 3. Lỗi còn lại, xếp theo mức ảnh hưởng

1. **[Cao] Mất khả năng đổi ngôn ngữ trên điện thoại ở 2 trang** — `dashboard.html` và `tool.html`: pill EN/VI bị flex nén (`app.css:56` `overflow:hidden`, `app.css:50` `nowrap`) → đo tại 375 px: `#lang-vi` còn **0 px** nhìn thấy, hit-test trả `#resToggle`; tại 414 px còn 19 px, vẫn không bấm được. 5 trang kia OK nhờ rule ở `terminal.css:55`/`jobs.css:44`. Đây là regression của bản sửa overflow.
2. **[Cao] Ba trang cho ba/trạng thái khác nhau cho cùng một tài khoản** (đo class thật):
   - Qoder: `.dot` xanh `dashboard.html:99` vs `.dot warn` `compare.html:105`.
   - Antigravity: `.dot warn` `dashboard.html:122` vs `.dot` xanh `compare.html:134`.
   - OpenCode: `.dot` xanh `dashboard.html:159` + badge `OK` `resources.html:214` vs badge `DEGRADED` `tool.html:288` (vì `key-13 EXPIRED`).
   `.dot` không có chú thích nào (0 kết quả grep legend) → điểm trạng thái vẫn không suy ra được gì, và giờ thì **mâu thuẫn trực tiếp giữa các trang**. Hệ quả của việc F1 sửa dashboard và F2 sửa compare độc lập.
3. **[Trung bình] 7/23 donut vẫn hình học cũ `r20/r16`** → khe viền 1.27 px: `compare.html:75,83,111,140,148,176`, `terminal.html:147`. Nên đưa cặp `r21/r15` (hoặc抽出 thành một component) cho đồng nhất.
4. **[Trung bình] Tương phản còn thiếu**: `--faint` 4.13:1 cho text 9–10.5 px (dưới 4.5); `--accent` 3.52:1 khi làm chữ nhỏ; `.tier` PRO TRIAL 3.42:1, BYOK 3.87:1 (9 px, cả 2 theme); `.mult.free` trong dark **2.00:1** (`app.css:155` dùng `--ok` đổi màu theo theme).
5. **[Trung bình] Thanh CPU vẫn sai số của chính nó** — đo `.res` trên jobs/terminal/dashboard/compare/resources: `3.8 / 5.2 GHz` = 73 % nhưng bar `width:38 %`, sub-label `8/24` = 33 %; trong khi RAM (19.8/32 → 62 % = bar 62 %) và GPU (4.6/12 → 38 % = bar 38 %) khớp tuyệt đối. Bar CPU không có nhãn cho biết nó đo cái gì.
6. **[Trung bình] Sản lượng token OpenCode vô lý chéo trang**: 31.6M (7 ngày) / 112.9M (30 ngày) ở `resources.html:213` so với trần "1.56M / 3.4M" ở `dashboard.html:167`, `compare.html:180`, `tool.html:248`. Chú thích `resources.html:219` chỉ nói cột trước là "cap của gói", không giải thích được mức dùng gấp ~9 lần cap.
7. **[Thấp] i18n còn rỉ** ở compare: 5/6 `.g-reset` thiếu `data-vi`, chuỗi `↻ 1h49p` sai cả trong EN; `760 / 2,000 credits` / `1.56M / 3.4M tokens` không dịch; id cắt `harbor-pool/…flash:free` thiếu `title` tại `compare.html:172,246`, `resources.html:210`.
8. **[Thấp] Mobile bị kẹt một trang**: ở 375 px, `.side` computed `display:none` (`app.css:39`) và `jobs.html` chỉ còn **một link nhìn thấy được là `terminal.html`**; terminal/compare/resources cũng không có "Back to Dashboard" ở topbar (chỉ `tool.html:28` có).
9. **[Thấp] ARIA chưa đúng APG cho tablist**: 3 tablist (terminal sessions, jobs details, jobs tabs) không có điều hướng phím mũi tên, chỉ `onclick` (`terminal.html:64,67`; `jobs.html:175-177`); chip lọc single-select vẫn dùng `aria-pressed` thay vì `role="radiogroup"`/`aria-checked` (`jobs.html:65-71`, `compare.html:48-49`, `resources.html:49-50`); donut không có `role="img"`/`aria-label`.
10. **[Thấp] Không có quy tắc ngưỡng màu** (`bad 12, bad 22, warn 34, bad 40, ok 46…`) — 34 warn nhưng 40 bad; không legend.
11. **[Thấp] Trạng thái rỗng của Jobs không tới được**: vì 6 job phủ đủ 6 status, `#jobsEmpty` không bao giờ hiện (đo: mọi filter đều ≥1 dòng). Empty state "thật" duy nhất chạm được là "No files changed yet" (job 4818/4816).
12. **[Thấp] Nhỏ lẻ**: `h1` index và dashboard trùng "DASHBOARD"; compare.css:19/resources.css:10 vẫn override `h1.title{font-size:38px}` trong khi `app.css:82` đã chốt 40 px (hai thang song song); dashboard trộn cỡ donut 80/56 trong cùng hàng; `.res` lặp nguyên văn 5 lần, `.tbtn` icon-only ở ≤640 px chỉ 2/5 trang có.

---

## 4. Còn control nào bấm mà không có kết quả không?

**Không còn control "bấm rồi im lặng"** (lỗi cũ: aria-pressed lật mà chẳng có gì xảy ra). Nhưng còn **một lớp mới nhẹ hơn: bấm → chỉ có toast, trạng thái thật không đổi.** Toàn bộ control đã bấm và đo:

| Control | Trang | Kết quả đo được | Trạng thái |
|---|---|---|---|
| EN / VI | 7 trang | `data-lang` + `html lang` đổi, nội dung đổi, `localStorage af-lang` | ✅ chạy |
| Theme | 7 trang | dark → light → system, `data-theme` + `af-theme`, nhãn "Tối/Sáng/Theo hệ thống", **giữ sau reload** | ✅ chạy |
| EN / VI **trên mobile ≤414 px** | **dashboard, tool** | `#lang-vi` 0–19 px, hit-test rơi vào nút khác | ❌ **không dùng được** |
| System (toggle) | dashboard, terminal, jobs, compare, resources | `aria-pressed` lật **và** `#resStrip` ẩn/hiện thật | ✅ chạy |
| System (toggle) | index, tool | nút không tồn tại (`app.js:117-120` ẩn nếu thiếu strip) | ✅ không có nút chết |
| Check all | dashboard | icon giữ, label đếm 1/4→4/4, `disabled` trong lúc chạy, `#stamp` đổi, toast | ✅ chạy |
| Check ×4 | dashboard | spin icon + `disabled` + toast "Đã kiểm tra (demo)" | ✅ chạy |
| Re-check | tool | như Check all, `data-steps=4` | ✅ chạy |
| Refresh | resources | `#stamp` 18:41 → 13:34 + toast | ✅ chạy |
| Filter 7 chip | jobs | số dòng 6/1/1/1/1/1/1 + count + single-select | ✅ chạy |
| Chọn dòng / `.rowbtn` | jobs | header, meta, log, changes, request **đổi theo**, `.sel` dời | ✅ chạy |
| Tab Log/Changes/Request | jobs | pane đổi `hidden`, `aria-selected`, `tabindex` | ✅ chạy (thiếu phím mũi tên) |
| Tab phiên Codex/Qoder | terminal | pane + ARIA hoán vị đúng | ✅ chạy (thiếu phím mũi tên) |
| A− / A+ | terminal | `--fs` 12.5 → 14.5 px, computed `.term` = 14.5 px, chặn trong [10,18] | ✅ chạy |
| Hide / Show | terminal | `#termbody.hidden` lật, nhãn lbl-on/lbl-off lật | ✅ chạy (icon sai, xem mục 5) |
| End process | terminal | badge `LIVE/ok` → `ENDED/badge bad`, notice hiện (`role=status`), Hide+End `disabled` | ✅ chạy |
| Reconnect | terminal | ẩn notice, LIVE/RUNNING, 2 nút bật lại, nội dung hiện | ✅ chạy |
| Lọc 7 / 30 ngày | compare | 12 stat + 8 ô bảng + `winNote` + toast | ✅ chạy |
| Lọc 7 / 30 ngày | resources | KPI ×3 + chart 7↔30 + `winNote` | ✅ chạy |
| Open config folder | tool ×4 | toast "Demo: open ~/.codex"… có `title` đường dẫn | ⚠️ hợp lệ cho demo (không có gì để mở thật) |
| **Dừng / Hợp nhất / Chạy / Thử lại** (12 nút) | jobs | **chỉ toast**; badge vẫn `RUNNING`, dòng vẫn 6, count vẫn 6/6 | ⚠️ **không đổi trạng thái** |
| **New job** | jobs | toast "Trình tạo công việc (demo)", số dòng giữ 6 | ⚠️ không tạo |
| **New session** | terminal | toast "Đã tạo phiên (demo)", vẫn 2 tab, stamp vẫn "2 sessions" | ⚠️ không tạo |
| **Export** | compare | toast "Đã xuất CSV (demo)", không có file/download | ⚠️ không xuất |
| Details → | dashboard/compare ×8 | link thật `tool.html?t=…`, vào đúng trang tool | ✅ |
| 6 card pcard | index | link thật tới 6 trang | ✅ |
| Back to Dashboard | tool | link `dashboard.html` (topbar, hiện cả mobile) | ✅ |

Chẩn đoán: nhóm ⚠️ cuối là "demo honesty" — tất cả đều gắn chữ *(demo)* nên không *nói dối*, nhưng với một bản demo chốt để trình bày thì nút "Dừng" để badge RUNNING đứng yên vẫn là chỗ người xem sẽ trỏ tay vào. Ưu tiên thấp hơn 2 lỗi mục 3 vì không phá yêu cầu nào.

---

## 5. Icon

Đếm lại bằng script trên cả 7 trang: **88 lượt dùng, 18 hình độc bản** (lần trước 82/17), toàn bộ là SVG data-URI mask (`app.css:70`), không emoji/bitmap ✅.

**Đã sửa trong đợt này**

| # | Vấn đề cũ | Trạng thái hiện tại |
|---|---|---|
| 2 | icon `list` bị dùng cho nút "Empty state" ở header Jobs | nút đó đã bị xoá → `list` (x7) giờ chỉ còn cho nav Jobs ✅ đúng nghĩa |
| — | "Open location" chỉ toast `demo`, không icon | thành **folder** (`tool.html:113,165,230,283`, x4) + `title` đường dẫn ✅ đúng nghĩa |
| — | `triangle-alert` dùng cho banner trực sẵn | icon giữ, nhưng giờ đi với notice `hidden` + `role=status`, chỉ hiện khi mất kết nối thật → icon đã nói đúng ngữ cảnh |

**Còn sai / không đổi theo trạng thái**

1. **`eye-off` trên nút Hide/Show — sai nặng nhất vì nhãn đã biết đổi, icon thì không.** Đo computed `mask-image` của `#hideBtn i.ic` ở cả 2 trạng thái: **giống hệt nhau** (336 ký tự, `iconMasksDiffer=false`). Khi nội dung đã ẩn, nút hiện `eye-off` + chữ "Show" → glyph phủ định chính label (`terminal.html:85-89`, JS `terminal.html:183-189` chỉ lật `<span>`, không lật `--u`).
2. **Cùng một hành động "Check" dùng 2 glyph khác nhau trên cùng một trang**: `check-all` (`dashboard.html:47`) và Re-check/Reconnect/Retry/Refresh dùng `refresh-cw` **4 path đầy đủ** (x5), còn 4 nút Check của 4 card (`dashboard.html:89,112,149,169`) dùng bản **cụt 2 path** (x4) — y hệt lỗi #9 của `REVIEW.md`, không sửa.
3. **Icon nav Compare vẫn là mũi tên chéo bắt nhau** (`M16 3h5v5M4 20 21 3…`, x7 — cả 7 trang): đọc thành *shuffle/diagonal-move*, không phải "so sánh". Đề xuất cũ (`columns-2` / `git-compare-arrows` / `scale`) chưa áp dụng.
4. **Icon nút Theme không đổi theo trạng thái**: một hình `circle r=9` + `M12 3v18` cho cả 3 trạng thái System/Dark/Light (x7), trong khi label đã dịch và đổi (`app.js:22-27`). Nhãn đổi – icon không đổi đúng khuôn mẫu lỗi ở #1.
5. **`file-text` cho 6 nút "Details" của bảng Jobs** (`jobs.css`/`jobs.html:96,109,…`, x6): nghĩa là "tệp", action thật là mở panel chi tiết job. Đề xuất cũ `panel-right-open`/`list-checks` chưa áp dụng.
6. Ghi chú nhỏ: `assets-logo/` không được dùng; `.logo` vẫn là chữ `Cx/Q/Ag/oc` — ổn cho demo nhưng nên có note để không bị hiểu là logo chính thức.

---

## 6. Kết luận

**Đã đủ để chốt phần lớn:** các khung yêu cầu 1–11 giờ đều đạt *trên màn hình* chứ không chỉ trong source — cột tên model hiện thật (96–117 px), `tool.html` nói đúng từng công cụ + có empty state, donut `butt`/`%`/khe ≥2 px cho 16/23 vòng, mọi control cũ bị coi là chết đều đã có tác dụng đo được, theme+ngôn ngữ lưu được, `html lang` đổi, và cả 7 trang không cuộn ngang ở 375 px. Điểm 8.2 trung bình, trang thấp nhất 8.0, không trang nào phải dựng lại. **Vì vậy: chưa chốt được** — lý do không nằm ở thẩm mỹ mà ở hai chỗ mà người chấm bản demo sẽ phát hiện trong 60 giây: (a) trên điện thoại, dashboard và trang chi tiết công cụ **không đổi sang tiếng Việt được**; (b) cùng một tài khoản nhưng 3 trang báo 3 trạng thái khác nhau.

**Tối đa 3 việc bắt buộc trước khi chốt**

1. **Sửa topbar mobile trong `app.css`** (không phải CSS từng trang): thêm `@media(max-width:640px){.topbar .tbtn span{display:none}}` + `.topbar{flex-wrap:wrap}` hoặc đặt `flex:none` cho `.toggle`. Nghiệm thu: ở **375 px và 414 px**, trên cả 7 trang, `#lang-vi` có `visible width ≥ 34 px` và `elementFromPoint(tâm VI) === #lang-vi`, bấm xong `html lang="vi"`.
2. **Thống nhất một nguồn trạng thái cho 4 tool** (một bảng: Codex OK, Qoder warn, Antigravity warn, OpenCode warn vì key-13 hết hạn) rồi áp cùng giá trị cho `dashboard.html:67,99,122,159`, `compare.html:69,105,134,170`, `resources.html:187,196,205,214`, `tool.html:118,170,235,288` — hoặc bỏ `.dot` nếu không định nghĩa được. Kèm 1 chú thích ngắn giải thích ý nghĩa màu (dot + ngưỡng `%` của donut), vì hiện `grep legend = 0`.
3. **Dọn 7 donut `r20/r16` về `r21/r15`** (`compare.html:75,83,111,140,148,176`, `terminal.html:147`) để khe ≥2 px trên toàn demo, đồng thời chốt **một cỡ cho cùng một dữ liệu** (dashboard so với compare) hoặc ghi rõ trong `assets` vì sao `.sm` được dùng ở Compare.

Không nằm trong 3 việc bắt buộc nhưng nên nhân tiện làm (rẻ, cùng file): icon trạng thái của Hide/Show (`terminal.html:85-89`) và bản `refresh-cw` đầy đủ cho 4 nút Check (`dashboard.html:89,112,149,169`); `--faint` thêm ~15 % đậm để vượt 4.5:1, đổi `.mult.free` sang nền không theo theme (`--free`) để hết mức 2.00:1 trong dark; `data-vi` cho 5 `.g-reset` của compare và `title` cho id cắt ở `compare.html:172,246` / `resources.html:210`; thanh CPU hoặc đổi `38%` thành `73%` hoặc ghi nhãn cho nó.
