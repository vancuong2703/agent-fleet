# Kế hoạch Agent Fleet Desktop 2.0

Ngày: 03/11/2026. Trạng thái: **hoàn tất bản portable 2.0.0**.

## Nền tảng

Dùng C#/.NET WinForms + Microsoft Edge WebView2 làm vỏ Windows, tiếp tục dùng
React/TypeScript và server Node.js hiện có. Máy đã có SDK .NET và Windows
Desktop runtime; không cần cài Rust/MSVC. WebView2 dùng runtime hệ thống thay
vì đóng gói thêm một Chromium. Đóng gói kèm Node và dependency cần chạy để
người dùng mở `AgentFleet.exe`, không cần CMD hoặc trình duyệt riêng.

## Phân công và thứ tự

1. Desktop: cửa sổ EXE, khởi động server ẩn, vòng đời tiến trình, WebView2,
   mở thư mục/tệp, icon, đóng gói portable, tài liệu build.
2. Giao diện: bố cục sidebar/workspace/inspector lấy cảm hứng từ Claude/Codex,
   sáng/tối/hệ thống, tìm task, logo nhận diện agent, terminal, bảng tài nguyên,
   token/chi phí, tạo plan/task ngay trong app.
3. Quan sát: API snapshot tài nguyên, lịch sử/tổng hợp tiêu thụ, hoạt động/model,
   trạng thái sẵn sàng của agent; giữ số liệu không có nguồn ở trạng thái chưa rõ.
4. Realtime: đồng bộ lại sau reconnect, bù sự kiện bị mất, cập nhật diff/so sánh
   và tiến độ khi agent đang làm; giới hạn bộ nhớ log.
5. Review qua CLI/model phụ, kiểm thử hồi quy, E2E và smoke test EXE thực tế;
   sửa lỗi tìm thấy rồi xuất bản portable trong `dist/`.

Các phần độc lập được làm song song. Việc nhỏ dùng model nhỏ khi CLI hỗ trợ;
model không có quyền truy cập hoặc hết quota sẽ được ghi rõ, không giả kết quả.

## Tiêu chí nghiệm thu

- Mở EXE ra một cửa sổ ứng dụng, không hiện CMD; đóng app dọn server do app sở hữu.
- Chuyển dự án/task trong cùng cửa sổ; có tìm kiếm, sáng/tối và ghi nhớ lựa chọn.
- Thấy agent/model (khi agent cung cấp), việc gần nhất, thời gian và kết nối.
- Log và trạng thái tự cập nhật; mất mạng/reconnect không phải tải lại trang.
- Terminal có font, màu, resize, copy/paste, tìm kiếm và trạng thái kết nối rõ ràng.
- Mở vị trí repo/worktree/tệp qua cầu nối desktop có kiểm tra đường dẫn.
- Hiện CPU/RAM thực đo, phạm vi đo và lịch sử; GPU chỉ hiện khi lấy được dữ liệu.
- Tổng token/chi phí theo dự án, số lần chạy và mức phủ dữ liệu; credit thuê bao
  không suy diễn từ token hoặc USD khi nhà cung cấp không báo.
- Test hiện có tiếp tục đạt; bổ sung kiểm thử cho reconnect, thống kê, native bridge
  và các luồng mới có ảnh hưởng đáng kể.

## Bổ sung trong đợt này

Tạo task/plan bằng UI; tìm kiếm task; sao chép đường dẫn; xuất báo cáo sử dụng;
trạng thái dữ liệu chưa có; cảnh báo task im lặng; chỉ báo offline/reconnect;
ghi nhớ giao diện; single instance; dữ liệu desktop riêng; kiểm tra prerequisite.

## Hướng mở rộng sau bản này

Thông báo Windows, hàng đợi ưu tiên, đặt ngân sách/cảnh báo token, giới hạn tài
nguyên, cài đặt agent/model theo task, đăng nhập/quota theo tài khoản, tự cập nhật
có chữ ký, bộ cài MSI/MSIX có ký số, đồ thị tài nguyên nâng cao và xuất OTLP.
Các tính năng phụ thuộc API của nhà cung cấp cần tích hợp riêng.

## Kết quả nghiệm thu

- Đã xuất `dist/AgentFleet/AgentFleet.exe` và ZIP portable Windows x64.
- Unit/integration: **347/347 PASS**; E2E: **10/10 PASS**; native: **15/15 PASS**.
- TypeScript, web build và .NET publish đạt. Đã đối chiếu 47 hash nguồn/bản build
  trong `runtime-manifest.json`, không có sai khác.
- Hai lần mở EXE trên cùng profile nhưng khác cổng đều đạt; theme tối được giữ.
- Shutdown bình thường và dọn server khi cưỡng bức kết thúc host đều được kiểm tra.
- Qoder Efficient review realtime; Codex CLI review native; Qoder Efficient kiểm
  tra lại năm finding sau sửa. Đã xử lý các lỗi được xác nhận.
- Đã mở app thực tế bằng Computer Use, kiểm tra kết nối, tài nguyên, GPU và
  chuyển theme bằng UI. App mặc định được để mở cho người dùng.

Chi tiết, giới hạn số liệu và hướng nâng cấp tiếp ở [ghi chú 2.0](releases/2.0.0.md).
