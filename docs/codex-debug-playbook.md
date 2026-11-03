# Playbook debug cho agent (Codex, Qoder, OpenCode)

Rút ra từ quá trình rà soát Agent Fleet 2.2.0 ngày 03/11/2026. Đọc trước khi nhận task.

## 1. Quy trình bắt buộc
1. **Tái hiện trước, sửa sau.** Ghi lại lệnh/thao tác tái hiện và kết quả thực tế. Chưa tái hiện được
   thì chưa được sửa.
2. **Mỗi lần chỉ thử một giả thuyết.** Viết rõ "tôi nghĩ X gây ra Y vì Z", làm thí nghiệm nhỏ nhất để
   xác nhận hoặc bác bỏ. Không đổi nhiều thứ cùng lúc.
3. **Có test hồi quy trước khi sửa.** Test phải fail với code cũ và pass với code mới.
   Parser thì dùng fixture lấy từ output thật.
4. **Báo cáo trung thực.** Ghi rõ những gì đã chạy, kết quả, những gì *chưa* kiểm chứng.
   Không viết "đã sửa" khi chưa chạy lại check.
5. **Chặn thời gian cho spike.** Khi không chắc có nguồn dữ liệu, cho phép tối đa 1 giờ để tìm. Hết giờ thì ghi
   kết luận "có/không có" kèm bằng chứng, rồi chuyển sang phương án dự phòng.

## 2. UI / CSS
- **Kiểm tra computed style trong browser, đừng chỉ đọc source.** Bài học thật: `App.tsx:85` đặt
  `--sidebar-width` dạng inline style, đè luôn media rule ở 720 px, nên sidebar không bao giờ thu hẹp.
  Đọc CSS thì thấy đúng, nhưng phải mở DevTools hoặc chạy `getComputedStyle` mới thấy lỗi.
- Biến CSS inline > class > media query cùng độ ưu tiên. Nếu cần giá trị động mà vẫn responsive, đặt biến
  dưới tên khác (`--sidebar-user-width`) rồi dùng `width: min(var(--sidebar-user-width), 40vw)`
  hoặc ghi đè trong media query bằng một biến riêng.
- **Thay đổi UI nào cũng phải xem ở 3 độ rộng × 2 theme** (375 / 768 / 1440, sáng / tối).
  Kiểm tra `document.documentElement.scrollWidth <= innerWidth` để bắt lỗi cuộn ngang.
- **Kiểm tra màu trên theme tối:** logo hoặc icon màu tối trên nền tối là lỗi hay gặp (logo Qoder và OpenCode).
- **Trạng thái nào cũng phải có:** loading, rỗng, lỗi (có nút thử lại), có dữ liệu. Lỗi hay gặp: trong lúc
  đang tải lại hiện "Chưa có thay đổi" hoặc "Diff (0)".
- **`null` khác `0`.** Thiếu dữ liệu thì hiển thị "Chưa có dữ liệu". Không được tính ra 0%.
- Thông báo thành công không dùng class `banner-error`. Xem kỹ class trước khi tái sử dụng component.
- Chữ dính nhau ("CLIKiểm tra") là do thiếu khoảng cách giữa hai inline element. Hãy dùng `gap` của flex.

## 3. Scrape CLI qua PTY
- Strip ANSI trước khi match. Nên match theo **marker kết thúc** (ví dụ `Weekly limit:`,
  `Add-on Credits Used:`) thay vì chờ hết timeout.
- Regex chỉ chạy trên từng dòng (`[^\r\n]`), không dùng `.*` vượt qua nhiều dòng.
- Lưu fixture output thô kèm version CLI vào `server/adapters/__fixtures__/<agent>/`. Mask email và
  token trước khi commit.
- Màn hình CLI thay đổi theo version. Nếu marker không khớp, trả `null` kèm `reason`, không throw.
- Trust prompt và màn chào có thể xuất hiện. Gửi phím có độ trễ và giới hạn số lần thử lại.
- Không chạy lệnh có tác dụng phụ để "kiểm tra": login/logout, `harbor-key.ps1 check/add/reset`,
  hay các lệnh ghi config.

## 4. Windows
- Đừng giả định binary có trên PATH. Ví dụ `opencode` chỉ tồn tại dưới dạng
  `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`. Hãy resolve theo
  config → `where.exe` → các đường dẫn đã biết.
- `execFile` với `shell:false` không chạy trực tiếp được file `.cmd`/`.ps1`. Phải gọi qua `cmd.exe /d /s /c`
  hoặc `powershell.exe -NoProfile -NonInteractive -File`.
- Git Bash và PowerShell khác cú pháp. Trong script `.ps1` không dùng `&&`, `$?` (PS 5.1).
- Đường dẫn có dấu cách hoặc dấu tiếng Việt: luôn quote, và test với một repo có tên chứa dấu cách.

## 5. Fleet / worktree
- **Worktree mới chỉ có những gì đã commit.** Nếu task phụ thuộc vào thay đổi chưa commit thì sẽ không thấy được.
- AGY có thể exit 0 dù lệnh bị từ chối, nên phải đọc `errorCategory`, đừng tin exit code.
- Qoder dưới `-p` phải dùng `--permission-mode auto`, vì `accept_edits` từ chối Bash.
- OpenCode chạy cần `--standalone`.
- Check của task (`--check`) phải chạy được trong worktree sạch: không phụ thuộc `.tmp/`, cổng cố định hay
  dữ liệu của người dùng.

## 6. Bảo mật
- Không log, snapshot hay commit token. `~/.codex/auth.json` chỉ được decode claim cần thiết và bỏ phần còn lại.
  Thêm test khẳng định output không chứa `eyJ` hay `sk-`.
- Chỉ gọi HTTP tới loopback cho các pool cục bộ (harbor 20130, routeway 20131).

## 7. Checklist trước khi báo xong
- [ ] `npx tsc --noEmit` pass
- [ ] `npx vitest run` pass (dán số test)
- [ ] Task UI: `npm run test:e2e` pass, kèm ảnh ở 3 độ rộng × 2 theme
- [ ] `git diff --stat` chỉ chứa file trong phạm vi task
- [ ] Ghi rõ những gì chưa kiểm chứng được
