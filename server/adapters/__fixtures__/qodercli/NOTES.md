# qodercli 1.1.81
- Command: `qodercli -p <brief> -o stream-json --permission-mode auto -w <worktree>` ; brief as the `-p` argument value is NOT required — `-p` is a boolean flag, prompt is the positional query. (`--input-format stream-json` exists for stdin.)
- Output: Claude-Code-style stream-json: `system{subtype:init,session_id,...}`, `assistant{message{content:[thinking|text|tool_use]}}`, `user{message{content:[tool_result]}}`, final `result{subtype:success,result,is_error,duration_ms,total_cost_usd,usage,session_id}`.
- Final answer: `result.result`. Errors: `result.is_error=true`.
- Cost: `total_cost_usd` (was 0 for this account); usage tokens were 0.
- Resume interactively: `qodercli -r <session_id>`.
- Use `--permission-mode auto`: with `accept_edits` the agent can edit files but every Bash command (e.g. running tests) is refused in -p mode (seen 2026-11-02).

## Model picker — `model-picker.txt` (T2)

- Provenance: captured 03/11/2026 on the dev machine by driving `qodercli` 1.1.81 in a PTY
  (cols 160), sending `/usage` then `/model`, snapshotting the `@xterm/headless` screen and
  stripping ANSI. Sanitized before freezing: no email, no username, no token, no machine path.
  Account-specific credit numbers are left as-is because they are not identifiers.
- **Kết luận spike: CÓ hệ số xN và CÓ nhãn khuyến mãi.** Màn `/model` in mỗi model một dòng,
  đuôi dòng là `<hiện> x Credit`, hoặc `<giá gốc> <giá hiện> x Credit` khi đang giảm giá.
  Bản thô (chưa strip ANSI, xem `promo-ansi.txt` do spike tạo) bọc giá gốc bằng SGR 9
  (strikethrough): `\e[9m0.10x \e[29m0.00x Credit`. Vì vậy quy ước parse là
  **giá gốc đứng trước, giá hiện tại đứng cuối**, và `originalMultiplier` chỉ đặt khi có 2 mức giá.
- Không có **hết hạn khuyến mãi** trong output. Đừng suy diễn `promo` kiểu "Miễn phí đến 10/11";
  chỉ ghi nhãn giảm giá chung khi `originalMultiplier > multiplier`.
- Nhóm tab: `Model ·  Default (4)   New (11)   Custom (0)`. Tab đầu mở màn là nhóm đang được chọn
  (lần capture này là `New`), mỗi lần bấm `Tab` chuyển sang nhóm khác. Fixture gồm 2 nhóm có giá
  (14 dòng model, 14 tên phân biệt). `Custom (0)` trả "No models in this group." — không phải lỗi.
- **Chính sách duyệt nhóm (`server/terminal-status.ts` → `createQoderPickerWalk`):** `terminalStatus`
  bấm `Tab` và chụp lại **từng** nhóm cho đến khi đủ 3 nhóm hoặc hết ngân sách hop (6). Màn rỗng
  `No models in this group` chỉ là **một nhóm đã ghé**, KHÔNG kết thúc vòng lặp. Vì vậy mở màn ở `New`
  vẫn gom được giá của `Default` (lỗi cũ: dừng ngay ở `Custom` rỗng → mất `Default`); mở ở `Custom`
  vẫn tiếp tục sang 2 nhóm có giá. Chỉ màn có giá được giữ (mỗi nhóm 1 lần, khử trùng lặp).
- Màn hình là viewport: nhóm `New (4/11)` chỉ hiện 10/11 dòng vì dòng cuối bị cắt. Parser không
  tự bù; khi số dòng đọc được nhỏ hơn số model CLI công bố thì ghi cảnh báo vào `highlights`.
- Dòng model còn mang: effort (`■■■□□ High` / `Extra High` / `Max`), context (`▦ 200K`, `▦ 1M`),
  con trỏ `❯`, `▼` (cuộn), `✓` (đang dùng), `◑` (đa phương thức). Các glyph này không phải tên model.
- Overview của `/model` có `Current Model`, `Subscription Plan`, `Available Credits`; `/usage` có
  `Qoder Plan`, `Plan Expires At`, `Plan Credits Used`, `Add-on Credits Used`. `Plan Expires At`
  là **hết hạn gói**, không phải kỳ gia hạn, nên không đưa vào `plan.renewsAt`.
- `qodercli --list-models` (15 model, theo `docs/dashboard-v3-plan.md` mục 1) **chưa được capture lại
  trong lần spike này**, nên định dạng từng dòng chưa xác minh. Parser chỉ trích token đầu tiên có dạng
  id trên mỗi dòng và coi mọi model chưa có hệ số là `multiplier: null` — không nội suy giá.
