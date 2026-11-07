# Calm UI · Kế hoạch cải tiến UI, UX và animation

> **For agentic workers:** Khi người dùng duyệt triển khai, dùng `superpowers:subagent-driven-development` hoặc `superpowers:executing-plans`, thực hiện theo các checkbox. Không coi việc viết plan là phê duyệt sửa ứng dụng.

**Goal:** Làm Agent Fleet dễ đọc, bố cục gọn, dữ liệu token rõ theo ngày; tương tác có phản hồi nhẹ và thống nhất, không thêm chuyển động gây phân tâm hoặc tiêu thụ tài nguyên lúc rảnh.

**Architecture:** Giữ React/Fastify/.NET/WebView2 và các luồng Fleet hiện có. Điều chỉnh hệ CSS đang được import, bổ sung dữ liệu trình bày token theo ngày, lựa chọn diện mạo và trạng thái animation tại các component hiện hữu; không chuyển Rust trong đợt này.

**Tech Stack:** React 18, TypeScript, CSS, SVG, Lucide, Web Animations API khi cần thu/mở nội dung; Vitest, Playwright; C# cho lưu tuỳ chọn Desktop.

**Spec:** Mục 2–8 trong chính tài liệu này là đặc tả thiết kế đề xuất, dựa trên yêu cầu và ba ảnh người dùng cung cấp ngày 06/11/2026.

**Trạng thái:** BẢN ĐỀ XUẤT CHỜ DUYỆT. Chưa triển khai, chưa chạy ứng dụng, chưa nghiệm thu bằng trình duyệt. Đã đọc ảnh/source và tính tương phản của các cặp màu đề xuất.

**Rà soát 06/11/2026:** Bổ sung phạm vi `cli-workspace.ts`, quy tắc phân biệt request hoàn tất với CLI sẵn sàng và kiểm thử kết quả Check. Đã xoá thư mục demo untracked `web/public/cinema/` theo yêu cầu người dùng. Lần chỉnh sửa này chỉ cập nhật tài liệu và dọn demo; chưa triển khai UI.

## Global Constraints

- Chỉ sửa phạm vi UI/UX, presentation state, lưu tuỳ chọn diện mạo và test tương ứng; không thay scheduler, quyền agent, database schema hay parser CLI.
- Không tự commit, push, release, cài thư viện hay chạy agent thật. Không đọc/ghi hồ sơ vận hành để thử nghiệm; dùng dữ liệu/cổng phát triển riêng.
- Dữ liệu thiếu không phải 0. Không suy diễn token từ chữ trong terminal hoặc quy đổi credit thành token.
- Trắng/sáng là mặc định cho hồ sơ mới; giữ lựa chọn sáng/tối/hệ thống và sắc độ người dùng đã lưu.
- Không thay màu ANSI và cơ chế phiên terminal. Ẩn terminal không được dừng, tái tạo hoặc mất lịch sử tiến trình.
- Chữ thường đạt WCAG AA 4.5:1; chữ lớn 3:1; focus và thành phần đồ hoạ thiết yếu đạt 3:1. Pastel dùng chủ yếu cho nền, không phải chữ nhạt trên nền trắng.
- Tôn trọng `prefers-reduced-motion`; không animation trang trí vô hạn. Chỉ spinner/viền báo tác vụ đang chạy được lặp trong thời gian tác vụ còn pending và thành phần đang hiện.
- Không animate từng dòng log, mỗi ký tự terminal, mỗi bản tin WebSocket hay mỗi lần polling.
- Giữ EN/VI; chuỗi điều khiển phải có tên truy cập được; không dùng màu làm tín hiệu trạng thái duy nhất.
- Nghiệm thu UI: 375/768/1440 px × sáng/tối, thêm 1280×640 và Windows scaling 125%/150%; không ẩn dữ liệu thiết yếu để ép vừa màn hình.
- Chạy `npx tsc --noEmit`, `npx vitest run`, `npm run test:e2e`; thay phần Desktop phải chạy thêm build/native test và smoke WebView2.

---

## 1. Hiện trạng đã đối chiếu

| Quan sát | Bằng chứng nguồn | Hệ quả cho kế hoạch |
|---|---|---|
| Token chỉ là 7 cột SVG, thiếu ngày, thang đo và thông tin từng điểm | `web/src/ui/Dashboard.tsx:73–74,88` | Không chỉ thêm animation; phải bổ sung hợp đồng dữ liệu và nhãn |
| Biểu đồ và lời giải thích bị `display:none` khi chiều cao ≤870px | `web/src/styles/reference-dashboard.css:49–53` | Thay quy tắc giấu bằng layout gọn và cuộn dọc |
| Hàng KPI có `.fill`, kéo dài thẻ dù nội dung ít | `web/src/ui/Dashboard.tsx:87`, `web/src/styles/reference.css:90` | Bỏ stretch theo chiều cao cửa sổ riêng ở Dashboard |
| Các CLI ở chung vỏ có border/radius/overflow, mỗi card dùng đường phân cách | `web/src/styles/reference.css:138–149`; dashboard chỉ thêm gap ở `reference-dashboard.css:8` | Tách thành bốn card thực sự, không chỉ tăng khoảng cách |
| Heading 64px, weight 800, chia chữ với phần cam; nhiều nhãn UI dùng mono 10–11px | `web/src/styles/reference.css:118–120,130,190` | Thu heading, bỏ chữ tách màu, đưa UI về sans-serif |
| Màu accent, warning, danger đang bão hoà mạnh | `web/src/styles/reference.css:5–49` | Đổi token và kiểm tra mọi variant, không chỉ sửa nút Check |
| Theme đã mặc định light, nhưng view style mặc định warm | `web/src/theme.ts:5–9`, `web/src/view-style.ts:4–6`, `desktop/DesktopPreferences.cs:8` | Sửa default sắc độ và bootstrap, không ghi đè theme đã lưu |
| File đóng sẽ bỏ DOM của dòng diff, nhưng `.diff-pane` vẫn `flex:1` với nền xám | `web/src/components/DiffView.tsx:192–196`, `web/src/styles/workflow.css:361–375` | Giả thuyết vùng xám tồn tại do container; phải tái hiện và đo computed style trước sửa |
| Jobs có ràng buộc vùng cuộn và chiều cao để log dài không đẩy header khỏi màn hình | `web/src/styles/workflow.css:353–395`, `test/e2e/jobs-layout.spec.ts:15–65` | Không xoá đại trà `flex:1` hoặc `min-height` của Jobs |
| `tasksLoaded` không đồng nghĩa lịch sử run đã tải xong | `web/src/store.ts:491–494,571–583` | Token cần trạng thái tải lịch sử riêng; không hiện empty sớm |
| Desktop lấy cổng mới mỗi lần khởi động; chỉ theme/layout đang lưu qua native | `desktop/FleetRuntime.cs:79–87`, `desktop/DesktopPreferences.cs:46–50` | Font/style chỉ lưu localStorage sẽ không đủ ổn định qua lần mở Desktop |
| Có reduced-motion CSS toàn cục | `web/src/styles/workflow.css:323` | Animation JS mới phải tự xử lý reduced-motion, không chỉ dựa CSS |

Lưu ý: các dòng nguồn phản ánh thời điểm lập kế hoạch; cần đối chiếu lại khi triển khai. Ba ảnh cho thấy vấn đề thị giác, không phải bằng chứng đã tái hiện thao tác đóng file hoặc lỗi runtime. Cảnh báo credit không khớp số còn lại trong ảnh cũng không đủ để kết luận parser sai; không tự sửa dữ liệu nghiệp vụ trong đợt UI này.

## 2. Hướng thiết kế đề xuất

### 2.1 Chọn hướng Calm Workspace

Ba hướng có thể làm:

1. **Calm Workspace — khuyến nghị:** nền trắng, chữ slate/xám xanh, nền nút xanh phấn, card riêng; motion nhanh, biên độ nhỏ. Cân bằng dễ đọc, hiệu năng và lượng thay đổi.
2. Giữ typography hiện tại, chỉ đổi màu và thêm animation: ít thay đổi hơn nhưng không giải quyết độ chật và cảm giác heading quá lớn.
3. Glass/blur toàn trang, card phóng lớn thành modal: tập trung mạnh nhưng tốn GPU, che dữ liệu đối chiếu và dễ làm khó sử dụng bàn phím; không chọn.

Personality đề xuất: **Corporate nhẹ — bình tĩnh, rõ ràng, có phản hồi**. Đây là đề xuất chờ duyệt, không phải lựa chọn đã được người dùng xác nhận.

### 2.2 Màu, typography và hình khối

| Vai trò | Đề xuất light | Cách dùng |
|---|---|---|
| Canvas / card | `#FFFFFF` / `#FFFFFF` | Phong cách trắng, không nền kem mặc định |
| Nền phụ | `#F8FAFC` | Hover, ô nhập, vùng thông tin phụ |
| Viền trang trí / viền control | `#DCE4ED` / `#7A8AA0` | Viền card nhẹ; control cần ranh giới đủ rõ |
| Chữ chính | `#334155` | Tiêu đề, nội dung; không đen tuyệt đối |
| Chữ phụ | `#64748B` | Nhãn, ngày, phụ đề; không tiếp tục giảm opacity |
| Accent chữ / nền | `#4B648C` / `#EEF3FA` | Nút chính, tab active, đường viền focus |
| Success chữ / nền | `#456C5A` / `#EDF5F0` | Có icon và nhãn thành công |
| Warning chữ / nền | `#756245` / `#F6F2EA` | Màu đất dịu; không nền cam chói |
| Destructive/error chữ / nền | `#7A5260` / `#F7EFF2` | Plum/rose trầm + icon/nhãn; không nút đỏ tươi |
| Biểu đồ | xanh phấn và sage; outline `#4B648C` | Pastel fill không tự đủ tương phản; có outline, số và marker |
| Dark | nền `#101620`, card `#151C26`, chữ `#E2E8F0`, phụ `#AAB8CB` | Bảng màu dark riêng, không đảo màu máy móc |

Các cặp đã tính bằng công thức WCAG: chữ chính/trắng **10.35:1**; chữ phụ/trắng **4.76:1**; chữ phụ/nền phụ **4.55:1**; accent **5.38:1**, success **5.34:1**, warning **5.24:1**, destructive **5.80:1** trên nền tương ứng. Đây là tính toán token, chưa thay cho kiểm tra computed style thực tế ở hover/disabled/focus/dim/dark.

- Bỏ headline `DASH` + `BOARD` màu khác nhau; hiển thị một tiêu đề `Dashboard` / `Bảng điều khiển`, tương tự Jobs, Compare, Resources, Terminal.
- Heading trang 28–32px, mobile 24–28px, weight 600–650, line-height 1.15–1.25; không all-caps lớn hoặc gạch đen dày bên dưới.
- Nội dung mặc định 15px/1.5; tên CLI 17–18px; nút 13–14px; caption 12–13px. Nhãn quan trọng không dưới 12px.
- Font UI mặc định **Segoe UI Variable / Segoe UI**, tuỳ chọn **Inter** và **Bricolage Grotesque** đã có sẵn; không tải font qua CDN. Mỗi tuỳ chọn phải có mẫu tiếng Việt.
- Code, path, terminal tiếp tục dùng monospace. Không áp font tỷ lệ của UI vào xterm hoặc số dòng diff.
- Số thống kê dùng `tabular-nums`; bỏ chữ mono khỏi phần lớn caption/nút/navigation.
- Có mức chữ **Tiêu chuẩn 15px / Lớn 16px** cho UI; terminal giữ bộ chỉnh cỡ riêng. Không đổi toàn bộ app thành bold khi người dùng chọn font.
- Card radius 14px, control 8px; khoảng cách theo thang 4/8/12/16/24px. Bóng nhẹ chỉ cho card focus, popover và dialog.

## 3. Bố cục Dashboard và chế độ tập trung thẻ

### 3.1 Bố cục mới

Ở vùng nội dung rộng tối thiểu 1168px:

```text
Bảng điều khiển                Cập nhật lúc …    [Kiểm tra tất cả]

[ Codex ]    [ Qoder ]    [ Antigravity CLI ]    [ OpenCode ]
   card         card             card               card

[ Token hôm nay · 7 ngày          ] [ Công việc hôm nay ] [ Cần chú ý ]
  T7  CN  T2  T3  T4  T5  T6
  31/10 …                 06/11
```

- Dùng bề rộng **nội dung thực sau sidebar**, không chỉ viewport: ≥1168px → bốn cột CLI; 600–1167px → hai; <600px → một. Ngưỡng này cho mỗi CLI khoảng 280px, tránh bóp bảng AGY.
- Hàng dưới: ≥1100px nội dung → Token, Jobs, Attention theo tỷ lệ **1.6 : 1 : 1**; 600–1099px → Token toàn hàng, Jobs và Attention hai cột; <600px → Token, Jobs, Attention xếp dọc. DOM/Tab order và thứ tự thị giác luôn là Token → Jobs → Attention, không đảo bằng CSS.
- CLI vẫn là nhóm đứng trước thống kê. Không masonry hoặc đảo thứ tự agent theo dữ liệu.
- Từng card có border/radius riêng và gap 16px; vỏ grid không còn khung chung/overflow cắt bóng.
- Card CLI cùng hàng có footer thẳng hàng; không ép mọi card toàn ứng dụng có cùng chiều cao.
- Hàng thống kê theo nội dung, mục tiêu card Token khoảng 240–280px; không kéo panel rỗng tới đáy cửa sổ. Khi font lớn hoặc nội dung dài, tăng chiều cao tự nhiên.
- Cửa sổ thấp được cuộn dọc trong Dashboard; luôn giữ nhãn ngày, số tổng và lời giải thích dữ liệu thiếu. Không còn quy tắc ẩn `.spark` theo chiều cao.
- Ngày là dữ liệu, không phải trang trí. Không thu chữ ngày dưới mức đọc được để nhét bảy cột.

### 3.2 Tập trung card: non-modal, không thay thế nút Chi tiết

Áp dụng trước cho **bảy card Dashboard**: bốn CLI, Token, Jobs hôm nay, Cần chú ý. Compare/Resources dùng cùng bề mặt và hover; không tự áp dim vào từng dòng bảng, Jobs split hoặc terminal.

- Nhấn nền/header trống của card hoặc nút `Tập trung thẻ …` → chọn card đó; mỗi lần chỉ một card.
- Card được chọn: viền accent 2px vẽ bằng inset/outline không đổi kích thước, bóng nhẹ, nâng tối đa 2px trong 180–220ms. Không phóng chữ hay reflow lưới.
- Card khác dịu xuống: bỏ bóng, giảm nổi bật nền/đồ hoạ trang trí, thêm tint rất nhẹ nếu cần; **không dùng filter blur/backdrop-filter hoặc hạ opacity toàn card chứa chữ**. Chữ và nút vẫn đạt tương phản.
- Nhấn card khác → chuyển focus trực tiếp; nhấn lại nút tập trung, nút `Bỏ tập trung`, khoảng trống ngoài card hoặc Esc → trả về bình thường.
- Nút Check/Chi tiết/Mở công việc và thao tác chọn/copy văn bản vẫn làm đúng tác vụ; không biến lần nhấn đầu thành thao tác chọn card rồi bắt nhấn lần hai.
- Không dùng `<button>` bọc cả card có nút con. Card là `article/section` có heading; nút focus riêng là button `aria-pressed`.
- Khi Tab đi vào control của card khác, card đó phải rõ hoàn toàn và trở thành card tập trung; không trap focus, không đặt `inert`/`aria-hidden` lên các card còn lại.
- Esc đóng lớp trên cùng trước: dialog/palette/popover → chế độ focus. Một Esc không đồng thời đóng modal và xoá lựa chọn bên dưới.
- Focus chỉ là presentation state, không gọi API, không dừng polling, không tạo bản sao component hoặc đổi React key.
- Chuyển trang hoặc card biến mất → xoá focus; không lưu focus vào profile. Reconnect/cập nhật số liệu không tự đổi card được chọn.
- Mobile: giữ nguyên vị trí card; không scale, không auto-scroll khi chạm. Chỉ cuộn tối thiểu để đưa control đang dùng bàn phím vào khung nhìn.

## 4. Token theo ngày: thông tin đầy đủ và trung thực

### 4.1 Nội dung card

- Header `Token hôm nay`, phụ đề `7 ngày gần nhất` và khoảng ngày `31/10–06/11` theo đồng hồ máy.
- KPI hôm nay; bên dưới có `Input`, `Output`, và `x/y lần chạy có báo cáo`. Nếu chỉ đủ một phần dữ liệu, ghi rõ `Đã ghi nhận … · chưa đầy đủ`, không trình bày như tổng chính xác.
- Bảy ngày liên tiếp, gồm hôm nay, luôn có đủ nhãn **thứ + dd/MM**, kể cả ngày thiếu dữ liệu. Thứ phải theo EN/VI; tooltip có ngày đầy đủ và múi giờ.
- Cột xanh phấn, outline rõ; ngày hôm nay có marker và chữ `Hôm nay`, không dùng cam/đỏ hoặc chỉ thay màu để nhận biết.
- Trục Y gọn gồm 0/mốc giữa/mốc cao, đơn vị token với K/M; không vẽ cột cao tối thiểu giả cho giá trị 0.
- Hover/focus/tap một ngày mở chi tiết input/output/đã ghi nhận/số lần chạy/phần còn thiếu. Chạm lại hoặc Esc đóng tooltip; không để tooltip ra ngoài viewport.
- Có `Xem dữ liệu` mở bảng bảy dòng ngay trong card để đọc bằng keyboard/screen reader. Bảng không bị `aria-hidden` khi được mở.
- Chart dùng cùng dữ liệu với KPI và bảng, không tính ba lần theo các quy tắc khác nhau.
- Animation cột chỉ chạy một lần khi dữ liệu sẵn sàng hoặc đổi khoảng hiển thị thực sự; không reset về 0 rồi chạy lại theo mỗi polling.

### 4.2 Hợp đồng dữ liệu

Thêm hàm thuần vào `web/src/ui/model.ts`, không đổi ý nghĩa `buildTokenBins` đang dùng cho báo cáo rolling của Resources:

```ts
export type DailyTokenBin = {
  key: string;
  start: number;
  end: number;
  input: number | null;
  output: number | null;
  reportedTotal: number | null;
  runs: number;
  reportedRuns: number;
  coverage: 'none' | 'partial' | 'complete';
};

export function buildDailyTokenSeries(
  runs: readonly Pick<Run, 'id' | 'startedAt' | 'inputTokens' | 'outputTokens'>[],
  days: 7,
  now: number,
): DailyTokenBin[];
```

Quy tắc:

1. Cận ngày dùng `new Date(year, month, date + offset)` theo lịch local, khoảng `[start, end)`. Không trừ cố định 86.400.000ms để chia ngày vì ngày DST có thể 23/25 giờ.
2. `key` tạo từ year/month/day local; không lấy `toISOString().slice(0,10)` để tránh đổi ngày theo UTC.
3. Mỗi `run.id` chỉ tính một lần theo bản ghi mới nhất trong store; retry có ID mới thì tính như lần chạy mới. Cập nhật token của cùng run là thay thế snapshot, không cộng thêm snapshot WebSocket.
4. Run có `startedAt:null`, tương lai so với `now`, hoặc ngoài khoảng bị loại khỏi chuỗi. Usage được gán theo **ngày bắt đầu lần chạy**, không phân bổ ước lượng theo giờ; tooltip nêu rõ giới hạn này với run qua nửa đêm.
5. Input/output cộng riêng các số hữu hạn đã báo cáo; toàn bộ một phía thiếu → phía đó `null`. `reportedTotal` là tổng phần đã biết, chỉ `null` khi không có báo cáo nào.
6. `coverage:complete` khi mọi run trong ngày đều có cả input và output hữu hạn; `partial` khi có dữ liệu nhưng còn run/phía thiếu; không dữ liệu → `none`.
7. `0` chỉ xuất hiện khi CLI thực sự báo 0. Ngày không có run: `— · Không có lần chạy`; có run nhưng không báo usage: `— · CLI chưa báo token`. Không dùng 0 cho hai trường hợp này.
8. Tổng hôm nay lấy đúng bin cuối; có một phía thiếu thì dùng nhãn `Đã ghi nhận`, không gọi đó là tổng đầy đủ.
9. Không lấy credit Qoder/hạn mức quota làm token đã dùng.

Mở rộng trạng thái presentation của `FleetStore`:

```ts
runsLoadState: {
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
};
```

- `loaded` chỉ true sau khi một lượt tải lịch sử đã kết thúc, kể cả lỗi; `refreshing` mô tả lượt đang chạy. Giữ `runErrors` để biết lịch sử tải thiếu từng task.
- Lần đầu đang tải: skeleton tĩnh, vẫn dành chỗ nhãn bảy ngày; không hiện `Chưa có dữ liệu` sớm.
- Lỗi toàn bộ: thông báo + Thử lại; nếu còn dữ liệu lần trước, giữ chart với nhãn `Dữ liệu lần trước`, không xoá trắng.
- Lỗi một số task: chart có phần đã tải và banner `Lịch sử chưa đầy đủ`; không biết task lỗi thuộc ngày nào thì đánh dấu thiếu ở cấp cả card, không đoán riêng ngày.
- Mất WebSocket: vẫn xem được dữ liệu cũ; không biến thành 0 hoặc success mới.
- Dùng `fleet.reload`/`retryRuns` hiện hữu; không thêm polling song song hoặc endpoint usage riêng.
- Cập nhật ngày khi Dashboard hiện, app lấy lại focus và qua nửa đêm. Nếu cần timer nửa đêm, chỉ một timeout, huỷ khi hidden/unmount; không tạo interval animation.

Resources giữ nguyên khoảng rolling 7/30 ngày và test hiện tại trong đợt này. Đồng bộ màu/font/tooltip/nhãn đơn vị, nhưng không âm thầm đổi `buildTokenBins` bốn nhóm của báo cáo 30 ngày thành 30 cột hoặc đổi ý nghĩa `/api/stats`.

## 5. Tuỳ chọn diện mạo và mặc định trắng

- Giữ nút Theme hiện tại; bổ sung nút `Diện mạo` mở popover gọn thay vì thêm trang Settings lớn.
- Nội dung: Sắc độ `Trắng / Ấm`; Font `Segoe UI / Inter / Bricolage`; Cỡ UI `Tiêu chuẩn / Lớn`; Chuyển động `Theo hệ thống / Giảm / Tắt`; `Khôi phục mặc định` chỉ reset nhóm này, không reset theme/layout/agent config.
- Default hồ sơ mới: light + plain + Segoe UI + 15px + system motion. Dark/system đã lưu vẫn được tôn trọng.
- Preview ngay trên app khi đổi font, nhưng không remount Workspace/terminal hoặc gửi lệnh PTY resize nếu chỉ UI font đổi.
- Dùng allowlist cho font/style/size/motion, không cho nhập CSS/font URL tuỳ ý.
- Browser lưu `fleet.appearance`; đọc key `fleet.view-style` cũ khi chuyển sang nhóm preference mới, chuyển một lần rồi dùng nhóm mới, không giữ hai nguồn sự thật lâu dài.
- Desktop lưu `appearance` cùng `theme` và `layout` trong hồ sơ native hiện có. Cổng server đổi giữa các lần mở nên native là nguồn ưu tiên, localStorage chỉ là cache theo origin.
- Bổ sung dữ liệu khởi tạo `window.__FLEET_DESKTOP__.appearance` và bridge `fleet:set-appearance`; trả kết quả qua cơ chế `fleet:native-result` hiện có. Khi lưu thất bại, báo `Đã áp dụng tạm thời, chưa lưu được` và cho thử lại; không báo đã lưu giả.
- Ghi native theo thứ tự trên luồng UI, lưu đầy đủ snapshot theme/layout/appearance qua thao tác temp-file hiện có để đổi font không làm mất bố cục. Gửi ack sau khi lưu thành công.
- Áp theme/style/font từ bootstrap trước paint đầu; đọc storage lỗi thì plain/light/system font. Không chớp nền kem/đen rồi mới trắng.
- Khi system reduced-motion bật, lựa chọn `Theo hệ thống` phải giảm motion; `Tắt` mạnh hơn `Giảm`. Không có lựa chọn âm thầm override nhu cầu reduced-motion của OS.

## 6. Hệ animation toàn diện

### 6.1 Quy chuẩn chung

| Token / ngữ cảnh | Thời gian | Quy tắc |
|---|---:|---|
| Hover / focus | 80–120ms | Đổi nền/viền; focus ring xuất hiện ngay |
| Press | 90–120ms | Scale nút tối đa 0.98, không bounce; bỏ scale với control rất nhỏ |
| Đổi icon / tab | 140–180ms | Crossfade/underline; label cập nhật theo trạng thái thật |
| Chọn card | 180–220ms | Nâng 2px + viền + dịu nền các card khác |
| Disclosure/diff | mở 220ms, đóng 180ms | Chevron quay 90°, thân thu từ chiều cao thật |
| Popover / dialog | mở 220ms, đóng 160ms | Opacity + dịch 4px; không zoom toàn trang |
| Chuyển màn | 160–200ms | Fade + dịch tối đa 4px vùng nội dung; shell đứng yên |
| Spinner | 900–1100ms/vòng | Linear chỉ trong pending |
| Viền chạy đuổi | 1400–1800ms/vòng | Hai vệt mảnh xanh/sage, chỉ trên nút pending |

- Easing chính `cubic-bezier(0.2, 0, 0, 1)`; thoát nhanh hơn vào; không dùng linear cho chuyển vị trí.
- Ưu tiên transform/opacity; màu/viền chỉ trên thành phần tương tác. Không animate `filter`, bóng mờ lớn hoặc kích thước toàn grid.
- Ba lớp hiệu ứng ở trạng thái Check: icon là hành động chính, viền mảnh là phụ, nền trạng thái tĩnh là lớp ngữ cảnh. Không thêm ambient loop trang trí.
- Stagger khi mở lần đầu tối đa 30ms/card, tổng ≤120ms; dữ liệu cập nhật không tái chạy entrance. Không trì hoãn click để chờ animation.
- Mọi trạng thái quan trọng đều có label/icon; animation không phải kênh báo kết quả duy nhất.
- Reduced: bỏ scale, dịch chuyển, viền chạy, quay và stagger; giữ đổi màu/label, fade ≤80ms nếu phù hợp. Off: đổi tức thời.
- Không dùng `transition: all`, `will-change` thường trực hoặc thêm thư viện animation/charts nặng.

### 6.2 Check và viền xoay rượt đuổi

```text
Idle → Pending → Ready / Needs attention / Error
       icon quay   icon + nhãn theo kết quả kiểm tra
       viền đuổi   kết thúc vòng ngay, không còn animation nền
```

- Bấm: phản hồi nhấn trong 120ms, bắt đầu request ngay; trạng thái busy đồng bộ với request, không timer giả.
- Nút giữ nguyên chiều rộng khi chuyển `Kiểm tra` → `Đang kiểm tra…`; disabled chống gửi trùng; `aria-busy`/status text được cập nhật.
- Viền chỉ 1–1.5px, màu nhạt, không glow và không gradient chạy trên chữ. Ưu tiên SVG stroke/dash quanh hình bo góc được clip đúng viền; đo paint cost trước khi chọn cách thực thi.
- Icon pending của nút vẫn được phép quay khi chính nút disabled; không làm nhãn busy mờ khó đọc.
- Check all giữ tiến độ `n/4`: viền chạy ở nút Check all; card đang được kiểm tra dùng icon quay; không cho cả bốn card phát sáng/quay cùng lúc. Không tự chuyển spotlight qua từng CLI.
- Request hoàn tất không đồng nghĩa CLI sẵn sàng. Dùng `tool.lastCheck.status` của chính kết quả vừa trả về: `ready` → nhãn sẵn sàng và checkmark khoảng 1.2 giây; `needs-login` → cần đăng nhập; `unavailable` → CLI không khả dụng; `unknown` hoặc thiếu `lastCheck` → chưa xác định; `error` → kiểm tra lỗi. Các trạng thái khác `ready` không nhận checkmark sẵn sàng; giữ nhãn/chi tiết và thao tác phù hợp. HTTP/network lỗi là lỗi request, không ghi đè dữ liệu cũ bằng một kết quả thành công.
- `web/src/cli-workspace.ts` sở hữu pending/kết quả của Check và Check all. Hiện `check()` bắt lỗi bên trong và trả `Promise<void>`, còn `runCheck()` bỏ giá trị `DashboardTool` sau khi cập nhật snapshot; không dùng việc `await cli.check()` hoàn tất làm tín hiệu success. Khi triển khai, cho luồng kiểm tra giữ kết quả có cấu trúc hoặc state kết quả theo agent để UI đọc trực tiếp; giữ các callsite `void cli.check(...)` an toàn, không tạo Promise rejection không được xử lý.
- Check all chạy tuần tự và tiếp tục sau lỗi từng agent. Tiến độ `n/total` đếm số lượt đã kết thúc, kể cả lỗi, tách khỏi số CLI `ready`; tổng kết hiển thị số sẵn sàng và từng công cụ cần chú ý/lỗi. Chỉ báo tất cả sẵn sàng nếu mọi kết quả đều `ready`. Không đổi parser hoặc suy diễn trạng thái từ quota/credit.
- Lỗi giữ thông báo và nút thử lại; không lắc màn hình, không rung đỏ. Animation kết thúc theo trạng thái thật, không dùng timer để quyết định kết quả.
- Nếu tác vụ xong rất nhanh, bỏ qua viền chạy trước frame đầu; không kéo dài spinner để trình diễn.
- Khi component bị ẩn hoặc document hidden: dừng animation CSS/JS, request vẫn theo lifecycle hiện tại; khi quay lại render đúng trạng thái, không phát lại success cũ.
- Nếu benchmark không đạt, bỏ lớp viền trước, giữ icon và label pending. Viền là hiệu ứng phụ, không phải điều kiện đúng của tác vụ.

### 6.3 Danh sách nút hiện có và animation đề xuất

| Nhóm / nút | Phản hồi đề xuất | Bảo toàn UX |
|---|---|---|
| Sidebar: Dashboard, Terminal, Jobs, Compare, Resources, Guide | Nền active dịu + vạch chỉ vị trí 160ms | `aria-current`; không giật shell |
| Menu mobile / đóng drawer | Drawer 200ms, scrim nhẹ | Trap/restore focus phù hợp drawer; Esc trước spotlight |
| EN / VI | Đổi nền chọn 140ms | Không remount page, không animate từng chuỗi |
| Theme Sáng/Tối/Hệ thống; Trắng/Ấm | Crossfade màu ≤160ms | Không flash; không đổi ANSI terminal |
| Phần cứng bật/tắt | Thu/hiện vùng phụ 180ms | Không kéo giãn vùng main bất thường |
| Diện mạo, font, cỡ chữ, motion, reset — mới | Popover 220ms; dấu chọn 140ms | Keyboard, preview thật, lưu có ack, reset giới hạn |
| Dashboard: Kiểm tra tất cả | Press + icon quay + viền chạy nhẹ + n/4 | Pending thật, disable gửi trùng, không đổi spotlight |
| Dashboard/ToolDetail: Kiểm tra, Kiểm tra lại | Press + spinner + viền chạy | Success/error đúng kết quả; không tự check lúc mở page |
| Chi tiết, Mở cảnh báo, Công việc gần nhất, Quay lại Dashboard | Press + mũi tên dịch 2px khi hover | Điều hướng một lần; không cần chờ animation |
| Tập trung thẻ / Bỏ tập trung — mới | Card nâng/viền, sibling dịu 200ms | Non-modal, nested buttons không bị chặn |
| Ngày biểu đồ / Xem dữ liệu — mới | Tooltip fade 100ms; bảng thu/mở 180ms | Hover + focus + tap; null/0 khác nhau |
| ToolDetail: Mở CLI | Busy indicator khi launch, success khi có session | Không báo CLI ready chỉ vì animation hoàn tất |
| Sao chép đường dẫn CLI/worktree/lệnh/guide/tệp | Icon copy → check, nhãn `Đã sao chép` 1.5–2.5s | Chỉ sau Clipboard promise thành công; lỗi có hướng dẫn |
| Probe / chi tiết phần cứng / nhóm log thô | Chevron + disclosure 180–220ms | Không animate từng dòng log; DOM giới hạn |
| Terminal: chọn tab phiên | Active indicator 160ms | Giữ PTY và lịch sử, arrows/Home/End |
| Terminal: Phiên mới / nút chọn agent | Press + trạng thái launch | Không spawn hai phiên khi double-click |
| Terminal: chọn vị trí mở CLI | Nền/focus nhẹ, lựa chọn tức thì | Không tự launch khi chỉ đổi repo |
| Terminal: −/+ cỡ chữ | Press 100ms | Giữ font mono, debounce resize hiện có; không tween font |
| Terminal: Tìm tiếp | Press, highlight kết quả ngắn | Không cuộn mượt dài làm mất vị trí |
| Terminal: Sao chép / Dán | Copy theo promise; Paste nhấn nhẹ | Không báo lệnh đã chạy khi mới gửi paste |
| Terminal: Ẩn/Hiện, cột thông tin, Phóng to/Khôi phục | Vùng chrome 180ms | Không animate canvas xterm từng frame; giữ PID |
| Terminal: Kết nối lại | Spinner khi socket connecting | Connected/error từ socket thật |
| Terminal: Kết thúc tiến trình | Press + dialog xác nhận | Plum dịu, nhãn rõ, không nhầm với Ẩn |
| Jobs: bộ lọc trạng thái / Xoá bộ lọc | Nền chọn 140ms; danh sách cập nhật tức thì | Không stagger toàn bộ danh sách dài |
| Jobs: chọn một công việc | Nền selected 140ms | Giữ scroll; không dim toàn bộ pane và không remount ngoài yêu cầu |
| Jobs: Công việc mới / Tạo công việc đầu tiên | Press + mở composer 220ms | Focus ô đầu, Esc theo quy tắc form |
| Composer: Tạo plan mới, kiểm tra repo/agent, Thử lại | Disclosure ngắn, spinner tại đúng tác vụ | Giữ khoảng thông báo ổn định, lỗi không bị che |
| Composer: Tiếp tục / Quay lại | Chuyển bước 160ms, 4px | Giữ input; focus heading/ô lỗi; không xoá form |
| Composer: Giao việc / Huỷ / đóng | Pending thực hoặc exit 160ms | Ctrl+Enter không submit trùng; không mất yêu cầu do animation |
| Jobs: Nhật ký / Thay đổi / Yêu cầu | Underline + panel fade 160ms | Phím 1/2/3, arrows/Home/End; preserve scroll |
| Jobs: Phóng to / Thu nhỏ | Icon đổi 140ms, pane chuyển nhanh | Giữ tỷ lệ kéo/scroll đã lưu, Esc phục hồi |
| Jobs: Tiếp quản / Mở terminal | Press + confirm nếu đang chạy | Dừng agent theo nghiệp vụ hiện tại, không tự lấy quyền |
| Jobs: Thử lại / Chạy lại agent | Form mở 180ms, busy ở nút submit | Giữ ghi chú và quyền AGY |
| Jobs: Dừng / Đánh dấu xong / Merge | Press + pending + kết quả | Giữ nguyên xác nhận và điều kiện enabled; không success sớm |
| Jobs: Thao tác khác / Huỷ công việc | Menu fade 120ms, dialog 220ms | Nhãn `Xoá worktree và thay đổi`, focus Huỷ trước |
| Jobs: Tải lại thay đổi / lỗi danh sách/lịch sử/log | Spinner cục bộ + retry | Không blank dữ liệu còn dùng được |
| Diff: Thu/mở từng file / Thu/mở tất cả | Chevron và chiều cao thân file | Hết vùng xám dư; file đóng bỏ dòng DOM |
| Diff: Reveal / Mở worktree | Press + pending nếu native có ack | Thành công nghĩa native nhận/xử lý thành công, không cam kết Explorer đang focus |
| Compare: 7/30 ngày, repo | Nền chọn; giữ bảng cũ trong refresh | Không đổi nghĩa khoảng thống kê |
| Compare: Xuất CSV / Resources: Xuất báo cáo | Press + icon xác nhận thao tác tạo tải xuống | Không báo file đã lưu xong ở hệ điều hành |
| Resources: Làm mới / Thử lại | Spinner gắn request; cập nhật chart một lần | Giữ unknown, không chart chạy lại theo mọi sample CPU |
| Palette Ctrl+K, tìm, chọn lệnh | Mở 180–220ms, active-row ngay | Ctrl+K không lọt vào xterm, Esc đóng mọi vị trí focus |
| ConfirmDialog: Huỷ / xác nhận | Press; enter/exit ngắn | Busy chặn thao tác hiện có; danger không backdrop-dismiss |
| ResizeHandle Jobs/Terminal | Focus/hover đổi màu 100ms, drag tức thì | Không transition kích thước lúc kéo; arrows/Home/End/double-click giữ nguyên |

Nguồn inventory: `web/src/ui/Workspace.tsx:25–78`, `Dashboard.tsx:80–89`, `ToolDetail.tsx:13–16`, `Terminal.tsx:47–70`, `Jobs.tsx:178–197`, `Compare.tsx:39–48`, `Resources.tsx:27–35`, `Guide.tsx:9–12`; các component `TerminalPanel.tsx:179–190`, `TaskActions.tsx:162–238`, `TaskComposer.tsx:316–339`, `LogView.tsx:103–126`, `DiffView.tsx:133–194`, `CommandPalette.tsx:63–104`, `ConfirmDialog.tsx:91–107`, `ResizeHandle.tsx:3–7`.

## 7. File diff: thu gọn thật và animation có cleanup

Kết quả mong muốn: đóng file còn **một header file gọn**; dưới header không còn hộp xám cao bằng pane. Có thể vẫn còn khoảng trắng của khung Jobs, nhưng không còn cảm giác một vùng code rỗng.

- Giữ chiều cao và một vertical scroller của khu vực Changes hiện tại; làm scroller ngoài trong suốt, không mang background/border code.
- Chuyển nền/border/radius về từng `.diff-section`/thân có nội dung. Section natural height; closed chỉ header + error thực sự còn tồn tại. Không sửa min-height 160px của toàn pane Jobs để xử lý chuyện màu nền.
- Giữ horizontal scrolling của dòng code trong file; không tạo thêm vertical scrollbar trong từng file.
- Đóng: đo chiều cao đang thấy, animate về 0 trong 180ms; che overflow; khi kết thúc mới unmount `DiffLines`. Mở: mount rồi đo, animate 0 → chiều cao thật 220ms, trả về auto.
- Ưu tiên Web Animations API cho vùng cần unmount; theo dõi animation hiện hành, huỷ và bắt đầu từ chiều cao hiện tại nếu người dùng đổi ý nhanh. Không dùng `max-height:99999px`, delay giả hoặc chờ mỗi `transitionend` không có đường cleanup.
- Reduced/Off, component unmount, đổi task, điều hướng, animation cancel: luôn có đường về trạng thái cuối đúng, không giữ wrapper height cũ hoặc DOM đóng vô hạn.
- Polling update của cùng task không đổi lựa chọn mở/đóng theo path. Refresh patch trong lúc animating không được bung lại file vừa đóng.
- Mở rộng tất cả patch lớn: đổi trạng thái nhất quán, không stagger hàng trăm file. Chỉ animate file trong viewport, tối đa bốn vùng; còn lại về trạng thái cuối ngay.
- Chevron dùng cùng một icon quay 90°; `aria-expanded`, `aria-controls` và visibility thân đúng với trạng thái đích. Nếu focus đang trong thân sắp đóng, đưa về header trước.
- Reveal/Copy path là nút anh em với toggle; bấm không làm file thu/mở. Mọi path/error vẫn giữ như hiện tại.
- Giữ mặc định ≤3 file mở tất cả, >3 chỉ file đầu mở, trừ khi người dùng yêu cầu đổi riêng.

## 8. Hiệu năng, accessibility và trạng thái

- Dùng một nguồn token và CSS motion chung; không thêm canvas, shader, Lottie, Framer Motion hoặc GSAP cho các hiệu ứng này.
- Spotlight chỉ thay class/state; không duplicate card/terminal, không giữ layer GPU cho mọi card.
- `will-change` nếu thực sự cần chỉ tồn tại khi animation chạy và được gỡ sau đó. Không thêm timer chạy 60 lần/giây để điều khiển CSS.
- Giữ tạm DOM diff tối đa thời gian exit; sau đó loại bỏ dòng của file đóng. Cần kiểm thử heap không tăng theo mỗi chu kỳ thu/mở.
- Mục tiêu đo trước/sau cùng fixture: không thêm tác vụ JS >50ms chỉ vì một lần focus/press, không tăng dần retained DOM/listener qua 100 chu kỳ; idle không có animation do tính năng mới tạo ra. Đây là tiêu chí cần đo, không phải kết quả đã đạt.
- Nút thiết yếu tối thiểu 36px desktop; 44px vùng chạm mobile; tránh làm toolbar terminal quá cao, có thể tăng hit area mà giữ icon 16px.
- Focus-visible không bị border chạy che; tooltip không thay accessible name của nút.
- Dialog giữ trap/restore focus trong suốt exit; chỉ trả focus khi node modal đã đóng. Composer/palette/popover phải kiểm tra Tab/Escape riêng, không giả định CSS animation tự xử lý focus.
- Loading/empty/error/partial/stale/data phải có mẫu kiểm thử. Error không tự biến mất trước khi người dùng đọc; success dùng thông báo ngắn, không nhấp nháy.
- Các chart đọc được khi không phân biệt màu; nhãn, outline, dấu hôm nay và bảng dữ liệu là đường thay thế.

## 9. Bản đồ file và thứ tự triển khai

Không tạo cây design system mới song song. Sửa các stylesheet đang được import trong `web/src/theme.css`; không quay lại CSS/token cũ không còn hoạt động.

| Task | Sửa file hiện có | File mới cần thiết khi triển khai | Phụ thuộc |
|---|---|---|---|
| T0 — Baseline và tái hiện | Các test E2E phù hợp | Không bắt buộc | — |
| T1 — Palette, type scale, nền trắng | `reference.css`, `reference-dashboard.css`, `reference-pages.css`, `reference-compare.css`, `reference-resources.css`, `reference-terminal.css`, `reference-jobs.css`, `workflow.css`, `ui/Common.tsx` và các page heading | Không bắt buộc | T0 |
| T2 — Diện mạo/persistence | `view-style.ts`, `theme.ts`, `desktop.ts`, `ui/Workspace.tsx`, `web/index.html`, `desktop/DesktopPreferences.cs`, `desktop/DesktopWindow.cs`, native tests | `web/src/appearance.ts`, `web/src/ui/AppearanceMenu.tsx`, `test/web/appearance.test.ts`, `test/e2e/appearance.spec.ts` | T1 |
| T3 — Token theo ngày | `ui/model.ts`, `ui/Dashboard.tsx`, `ui/Workspace.tsx`, `store.ts`, `reference-dashboard.css`, test store/reference | `web/src/ui/DailyTokenChart.tsx`, `test/web/daily-tokens.test.ts`, `test/e2e/dashboard-tokens.spec.ts` | T1 |
| T4 — Card riêng + focus | `ui/Dashboard.tsx`, `ui/Common.tsx`, `reference-dashboard.css`, test reference | `test/e2e/dashboard-focus.spec.ts` | T2, T3 |
| T5 — Diff collapse | `components/DiffView.tsx`, `workflow.css`, test diff/jobs | `test/e2e/diff-collapse.spec.ts` | T2 |
| T6 — Motion/feedback toàn ứng dụng | `cli-workspace.ts`, các UI/component trong inventory, `theme.css`, các style tương ứng và test CLI workspace hiện có | `web/src/styles/motion.css`, `test/e2e/motion.spec.ts` | T2, T4, T5 |
| T7 — Nghiệm thu tích hợp | Tests, sửa nhỏ trong file thuộc task trên | Không bắt buộc | T1–T6 |

Các đường dẫn style trong bảng thuộc `web/src/styles/`; UI/component thuộc `web/src/`. File test mới được nêu là đề xuất, chưa tồn tại tại thời điểm viết plan. T2/T3 đều chạm Workspace, T1/T4 đều chạm Dashboard CSS, T5/T6 đều chạm workflow: thực hiện tuần tự hoặc giao owner rõ ràng, không cho hai worker sửa cùng file.

### T0 — Baseline, tái hiện trước khi sửa

- [ ] Xem `git status`; giữ nguyên thay đổi ngoài phạm vi. Thư mục demo `web/public/cinema/` đã được xoá theo yêu cầu người dùng, không tạo lại để triển khai plan.
- [ ] Đọc playbook; khởi động môi trường tạm riêng; không đụng server/CLI đang dùng.
- [ ] Chụp Dashboard sáng/tối, 1440×900 và 1280×640; ghi font/computed style/geometry của chart và card.
- [ ] Tái hiện đóng một file và đóng tất cả; đo `.diff-pane`, `.diff-section`, background và vertical scroller; ghi kết quả trước sửa.
- [ ] Ghi baseline khi rảnh, đang Check giả lập và terminal fake chạy; phân biệt RAM host/Node/WebView2/agent, không dùng tổng một thời điểm để kết luận leak.
- [ ] Viết và chạy regression chứng minh chart thiếu ngày/bị ẩn, và section đóng vẫn có khung xám kéo dài. Test phải fail vì đúng hành vi, không vì môi trường hỏng.

### T1 — Nền thị giác

- [ ] Thêm assertion cho màu mặc định, heading nguyên từ và các cỡ chữ; chạy fail trên giao diện cũ.
- [ ] Đổi token và variant nút/chip/tier/badge; loại màu accent cam ở heading/link/selected, không đổi logo agent gốc hoặc ANSI.
- [ ] Đổi page title/label sang sans đọc được; caption không mono tràn lan; giữ code/path mono.
- [ ] Scope bỏ `.fill`/ẩn chart chỉ cho Dashboard; không làm hỏng fill của Terminal/Jobs.
- [ ] Chạy `npx vitest run test/web/reference-ui.test.ts test/web/layout.test.ts test/web/strings.test.ts` và E2E reference/foundation; kiểm tra computed style, không chỉ snapshot source.

### T2 — Diện mạo và lưu qua Desktop restart

- [ ] Viết test hồ sơ mới/plain, dữ liệu storage sai/bị chặn, hồ sơ dark cũ, migration view-style cũ; chạy fail.
- [ ] Thêm `AppearancePreferences = { style: 'plain' | 'warm'; font: 'system' | 'inter' | 'bricolage'; size: 'standard' | 'large'; motion: 'system' | 'reduced' | 'off' }` và default rõ ràng trong `appearance.ts`.
- [ ] Thêm `useAppearance()` cung cấp preference/setter, áp CSS dataset/variables; dùng nguồn native ưu tiên, browser storage khi không có native. Chuyển callsite `useViewStyle` sang nguồn chung, không để hai hook cùng ghi `data-style`.
- [ ] Thêm AppearanceMenu bằng native controls có label; giữ Theme riêng, không đưa tất cả vào một menu khó tìm.
- [ ] Mở rộng bootstrap/native marker/bridge và lưu chung snapshot settings; kiểm tra ack lỗi và không mất theme/layout.
- [ ] Test font tiếng Việt, reload web, Desktop restart qua cổng mới, OS dark nhưng hồ sơ mới light/plain, không reset session terminal.
- [ ] Chạy native test `dotnet run --project desktop/tests/PathPolicy.Tests.csproj -c Release` và `npm run desktop:check`; chỉ dùng thư mục test, không hồ sơ thật.

### T3 — Dữ liệu và chart token

- [ ] Viết unit tests `buildDailyTokenSeries` theo mẫu và các case bên dưới, chạy fail trước khi thêm hàm.

```ts
const now = new Date(2026, 10, 6, 12).getTime();
const bins = buildDailyTokenSeries([
  { id: 'r-a', startedAt: new Date(2026, 10, 6, 9).getTime(), inputTokens: 120, outputTokens: null },
], 7, now);
expect(bins).toHaveLength(7);
expect(bins[0].key).toBe('2026-10-31');
expect(bins[6]).toMatchObject({ key: '2026-11-06', input: 120, output: null,
  reportedTotal: 120, runs: 1, reportedRuns: 1, coverage: 'partial' });
```

- [ ] Test thêm: không run; run cả hai null; báo 0/0; đủ 100/20; một run đủ cộng một run không usage; run update trùng ID; retry ID khác; 23:59/00:00; cuối tháng/năm; run tương lai; hai timezone có/không DST; không sửa input array.
- [ ] Mở rộng runsLoadState mà không phá replay/buffer WebSocket. Test delay history sau tasks, lỗi một task, lỗi toàn bộ, stale refresh và retry.
- [ ] Thay phép cộng inline trong Dashboard bằng hàm thuần + DailyTokenChart; truyền trạng thái tải/error/retry từ Workspace.
- [ ] Render đủ ngày/trục/tooltip/bảng và copy partial như đặc tả; không thêm endpoint hay fetch lịch sử riêng.
- [ ] Fixture E2E phải mock **cả `/api/runs` lẫn fallback `/api/tasks/:id/runs`** và cố định đồng hồ; không chỉ mock fallback rồi vô tình lấy run thật của test server.
- [ ] Test ở 1280×640 chart còn hiện, đủ bảy label, null không thành cột giả; hover/Tab/tap mở dữ liệu cùng giá trị.
- [ ] Chạy `npx vitest run test/web/daily-tokens.test.ts test/web/reference-ui.test.ts test/web/store.test.ts` và `npx playwright test test/e2e/dashboard-tokens.spec.ts`.

### T4 — Tách card và spotlight

- [ ] Viết browser test click card A/B, Esc, click Check/Details một lần, text selection và keyboard; chạy fail.
- [ ] Tách border/background khỏi grid; bố cục theo bề rộng nội dung; thống nhất header/footer và min-width card.
- [ ] Dùng một `focusedCardId` tại Dashboard với type `'cli:codex' | 'cli:qodercli' | 'cli:agy' | 'cli:opencode' | 'tokens' | 'jobs' | 'attention' | null`; không lưu profile. Focus pointer không chặn nút con.
- [ ] Thêm nút focus accessible và Bỏ tập trung; lớp selected/sibling, scope dim không ảnh hưởng chữ/nút; tránh overlay phủ hit target.
- [ ] Kiểm thử tất cả bảy card, chuyển trang/quay lại, card bị gỡ, reconnect, font lớn và tooltip; selected không đổi kích thước grid.
- [ ] Chạy `npx playwright test test/e2e/dashboard-focus.spec.ts test/e2e/reference-ui.spec.ts` và kiểm tra contrast cả trạng thái dim.

### T5 — Collapse diff thật

- [ ] Thêm regression sau tái hiện: đóng một file/đóng tất cả chỉ còn header/error, không background xám trong phần trống; kiểm tra bounding box và computed background.
- [ ] Sửa quyền sở hữu nền/border ở scroller và section theo mục 7; giữ Jobs bounded scrolling.
- [ ] Thêm lifecycle mở/đóng có cancel/cleanup và che overflow; không làm `DiffLines` sống mãi ở file đóng.
- [ ] Test double-click nhanh, đóng/mở giữa animation, polling patch đổi, chuyển task lúc đang đóng, reduced/off, nhiều file và đường dẫn dài.
- [ ] Dùng assertion tự chờ trạng thái/geometry thay vì `waitForTimeout(500)`; test hình học sau đóng:

```ts
const section = page.locator('.diff-section').first();
await section.locator('.diff-toggle').click();
await expect(section.locator('.diff-toggle')).toHaveAttribute('aria-expanded', 'false');
await expect(section.locator('.diff-line')).toHaveCount(0);
const box = await section.boundingBox();
const head = await section.locator('.diff-section-head').boundingBox();
expect(box!.height - head!.height).toBeLessThanOrEqual(2);
```

- [ ] Chạy `npx vitest run test/web/diff.test.ts` và `npx playwright test test/e2e/diff-collapse.spec.ts test/e2e/jobs-layout.spec.ts test/e2e/jobs-divider.spec.ts`.

### T6 — Phản hồi nút và motion hệ thống

- [ ] Viết test request Check bị giữ pending để xác nhận spinner/viền chỉ hoạt động khi request chưa xong; success/error/retry không gửi trùng.
- [ ] Viết test HTTP 200 cho từng `lastCheck.status`: `ready`, `needs-login`, `unavailable`, `unknown`, `error`, thêm kết quả thiếu `lastCheck` và HTTP/network lỗi. Chỉ `ready` nhận checkmark sẵn sàng; Promise hoàn tất sau khi bắt lỗi không được báo success. Chạy regression fail đúng hành vi trước sửa.
- [ ] Bổ sung state/kết quả Check tại `cli-workspace.ts` theo mục 6.2; UI dùng kết quả của lần kiểm tra vừa kết thúc, không snapshot cũ hoặc Promise `void`. Test Check all có kết quả trộn và lỗi request: vẫn thử mọi agent, tiến độ kết thúc đủ `total`, tổng kết số sẵn sàng và lỗi/cần chú ý chính xác; giữ chống gửi trùng và retry.
- [ ] Tập trung duration/easing/keyframe và selector trạng thái trong `motion.css`; các layout tiếp tục ở stylesheet hiện có. Không tạo hệ Button abstraction mới nếu lớp hiện tại đủ dùng.
- [ ] Gắn busy state vào tác vụ thật của từng nhóm inventory; hành động fire-and-forget chỉ báo điều có thể xác nhận, không giả success.
- [ ] Thêm Check all progress + viền đuổi, single Check spinner/viền, copy success và menu/tab feedback.
- [ ] Thêm entrance/exit popover/dialog/composer/palette, quản lý focus xuyên suốt exit; không dùng unmount tức thời rồi mong CSS exit chạy.
- [ ] Terminal chỉ animate chrome, giữ resize debounce 120ms hiện có; không animate font/canvas hoặc spawn lại PTY.
- [ ] Test reduced/off và hidden bằng CSS lẫn JS; mọi animation loop mới dừng khi rời page hoặc document hidden.
- [ ] Chạy `npx playwright test test/e2e/motion.spec.ts test/e2e/terminal.spec.ts test/e2e/terminal-a11y.spec.ts test/e2e/composer.spec.ts test/e2e/task-actions.spec.ts test/e2e/nav.spec.ts`.

### T7 — Nghiệm thu và bàn giao triển khai

- [ ] Chạy `npx tsc --noEmit`, `npx vitest run`, `npm run test:e2e` và ghi số test thật, không tái sử dụng số liệu release cũ.
- [ ] Nếu có sửa native, chạy native test/build và smoke WebView2 với profile riêng; giả lập browser bridge không thay cho Desktop test thật.
- [ ] Dùng UI bằng browser: chuỗi chính Dashboard → Check → focus card → token day → Jobs → Diff thu/mở → Terminal → font/theme → reload.
- [ ] Chụp 375/768/1440 × light/dark ở Dashboard và Jobs Diff; thêm font lớn, 1280×640, selected card, Check pending, error, dữ liệu partial. Giữ ảnh fixture tách khỏi dữ liệu vận hành.
- [ ] Theo dõi console/network, request trùng, PTY/session còn nguyên, scroll positions, focus trap/restore, Ctrl+K/Esc, clipboard failure và reduced motion.
- [ ] Đo CPU/RAM/DOM/listener trước/sau cùng fixture, 100 lần focus và thu/mở; kiểm tra không retained node tăng tuyến tính. Không hứa mức RAM tiết kiệm nếu chưa có số đo.
- [ ] `git diff --check`, `git diff --stat`, `git status --short`: chỉ file phạm vi duyệt; không thêm lại demo cinema hoặc token/profile. Không commit/release nếu chưa có yêu cầu riêng.

## 10. Checklist duyệt thiết kế và định nghĩa hoàn tất

Trước khi code, cần người dùng duyệt hướng **Calm Workspace**, spotlight không làm mờ chữ, bảng màu dịu và nhóm tuỳ chọn font/motion. Mặc định được đề xuất đầy đủ để có thể duyệt một lần; không cần quyết từng easing nhỏ.

| Yêu cầu người dùng | Kết quả bắt buộc | Task |
|---|---|---|
| Token day thiếu thông tin | Bảy ngày rõ, thứ/ngày, thang đo, tooltip/bảng, input/output, loading/null/partial đúng | T3 |
| Sắp xếp bố cục chuẩn | Card riêng, khoảng cách đồng nhất, chart có không gian, không panel trống bị kéo dài | T1, T4 |
| Nhấn thẻ làm nổi thẻ, dịu phần còn lại | Spotlight bảy card, Esc/ngoài card/keyboard, không chặn nút con | T4 |
| Trắng mặc định | Plain/light trên hồ sơ mới, không flash, giữ preference cũ | T1, T2 |
| Đổi font dễ nhìn | Ba lựa chọn có tiếng Việt, UI size, giữ mono code, nhớ qua Desktop restart | T2 |
| Bỏ màu cam/đỏ chói | Accent xám xanh, pastel nền, warning/error dịu nhưng rõ nghĩa | T1 |
| Liệt kê nút và đề xuất animation | Inventory mục 6.3, trạng thái async đúng và viền Check có kiểm soát | T6 |
| File thu vẫn vùng xám + cần animation | Section chỉ còn header, exit rồi unmount, cancel/reduced-motion đúng | T5 |
| Cải tiến animation toàn diện → UI → UX | Motion chung, accessibility, font/layout/data, kiểm thử xuyên luồng và hiệu năng | T0–T7 |

**Chưa nằm trong kế hoạch này:** chuyển Rust/Tauri; redesign logo; thêm tính năng quản lý agent mới; sửa số quota/credit từ parser; nâng cấp dependencies; thay đổi điều kiện Merge/xoá/quyền; phát hành bản mới. Các phần đó chỉ mở khi có yêu cầu riêng.
