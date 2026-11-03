# Cách gọi các CLI agent (kinh nghiệm thực tế)

Ghi lại ngày 03/11/2026 trên máy phát triển (Windows 11). Đây là kinh nghiệm leader Claude rút ra khi
dò và gọi các CLI. Codex và các agent khác dùng tài liệu này khi cấu hình `fleet` hoặc tự gọi CLI.
Trước khi dùng, kiểm tra lại version: mỗi version CLI có thể đổi cờ và cách hiển thị.

## 1. Vị trí binary và version

| Agent | Binary | Version | Ghi chú |
|---|---|---|---|
| Codex | `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` | 0.166.0 | Không có `--full-auto` |
| Qoder | `%USERPROFILE%\.qoder\bin\qodercli\qodercli.exe` | 1.1.81 | `qoder.cmd` chỉ là wrapper. Gọi `.exe` trực tiếp |
| Antigravity | `%LOCALAPPDATA%\agy\bin\agy.exe` | 1.4.12 | |
| OpenCode | `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe` | 2.2.5 | **Không có trên PATH.** Gọi `opencode` theo tên sẽ thất bại |

Cách resolve: đọc `agents.<id>.bin` trong config trước, sau đó `where.exe`, cuối cùng các đường dẫn ở bảng trên.
Git Bash không thấy được một số binary mà PowerShell thấy, vì vậy đừng dùng `command -v` để kết luận "không cài".

## 2. Cấu hình fleet (`<FLEET_DATA_DIR>/fleet.config.json`)

```json
{
  "agents": {
    "opencode": {
      "bin": "C:\\Users\\<user>\\AppData\\Local\\Programs\\ai.opencode.desktop\\resources\\opencode-cli.exe",
      "maxParallel": 2,
      "extraArgs": ["--model", "tokenharbor/deepseek-v4.1-flash-1017"]
    }
  }
}
```

- Adapter OpenCode dựng lệnh theo dạng `run --standalone --format json --auto <extraArgs> -- <brief>`
  (`server/adapters/opencode.ts:97`). Vì vậy model được truyền qua `extraArgs`.
  `server/adapters/metadata.ts` cũng đọc `--model` từ đó để ghi model vào thống kê.
- `extraArgs` áp dụng cho mọi task của agent đó. Muốn dùng model khác cho một task riêng: đổi config,
  khởi động lại server khi không còn task nào đang chạy, rồi mới giao task.

## 3. OpenCode + DeepSeek V4.1 Flash 1017

- Model id chính xác: **`tokenharbor/deepseek-v4.1-flash-1017`** ("DeepSeek V4.1 Flash 1017 (Token Harbor plan)",
  context 1M, output 64K). Provider `tokenharbor` gọi thẳng tới `https://tokenharbor.ai/v1`, không đi qua pool.
- Các biến thể dễ nhầm:

  | Model id | Đặc điểm |
  |---|---|
  | `tokenharbor/deepseek-v4.1-flash:free` | Bản free |
  | `harbor-pool/deepseek-v4.1-flash:free` | Đi qua pool cục bộ 127.0.0.1:20130, xoay vòng 13 key |
  | `routeway/deepseek-v4.1-flash:free` | Giới hạn 200 request/ngày/key |
  | `opencode/deepseek-v4.1-flash(-free)` | |
  | `opencode/deepseek-v4-pro` | |

- Liệt kê model: `opencode-cli models`. Lọc DeepSeek: `opencode-cli models | grep -i deepseek`.
- Smoke test đã chạy (thư mục trống, không có repo):
  ```bash
  opencode-cli run --standalone --format json -m tokenharbor/deepseek-v4.1-flash-1017 -- "Reply with exactly one word: OK" </dev/null
  ```
  - Kết quả: exit 0 sau **5 giây**, trả "OK".
  - Usage: `tokens.input` 7.731 (gần như toàn bộ là system prompt), `output` 3, `cost` 0.
  - Output JSONL gồm 3 dòng: `step_start`, `text`, `step_finish`. Usage nằm ở `step_finish`.
- Luôn dùng `--standalone`. Thiếu cờ này, lệnh sẽ bám vào background service của app desktop và có thể treo.
- Luôn đóng stdin (`</dev/null` hoặc `-NonInteractive`). Nếu không, CLI có thể chờ input.
- Model sau `-m` phải có dạng `provider/model`. Biến thể (variant) dùng `#`, ví dụ `provider/model#high`.

## 4. Qoder
- Adapter đã dựng sẵn lệnh `qodercli -p -o stream-json --permission-mode auto -w <cwd> <extraArgs> -- <brief>`
  (`server/adapters/qodercli.ts:102`), nên không cần thêm vào `extraArgs`. Không đổi sang `accept_edits`:
  ở chế độ đó Qoder từ chối Bash dưới `-p`, và lệnh check sẽ không chạy được.
- Lệnh đọc an toàn: `qodercli --version`, `qodercli status -o json`, `qodercli --list-models` (15 model, không kèm giá).
- Credit chỉ có trong stream-json (`credits`, `original_credits`, `total_credits`) hoặc qua PTY `/usage`.
- Hệ số giá theo model: chưa tìm thấy nguồn không tương tác nào. Xem spike ở T2.

## 5. Antigravity (agy)
- `agy models`: in mỗi dòng theo dạng `id<TAB>Tên`, gồm 13 model.
- Hạn mức và credit chỉ có qua PTY: `/usage` và `/credits`. Lần đầu chạy cần `/help`, rồi Esc, mới gõ lệnh tiếp.
- **Exit code 0 không có nghĩa là thành công.** Với `--mode accept-edits`, lệnh bị từ chối vẫn có thể trả 0.
  Phải đọc `errorCategory`. Lệnh check cần được allow qua `--settings {"permissions":{"allow":["command(<lệnh check>)"]}}`.

## 6. Codex
- `codex login status`, `codex --version`, `codex doctor` là các lệnh đọc an toàn.
- Hạn mức 5h và tuần chỉ có qua PTY `/status`. Nếu gặp "data not available yet", gửi lại `/status` tối đa 2 lần.
- Model mặc định nằm trong `~/.codex/config.toml` (`model`, `model_reasoning_effort`).
- Muốn bật mạng trong sandbox: `-c sandbox_workspace_write.network_access=true`. Adapter hiện chưa truyền cờ này.

## 7. harbor-key (pool key cho OpenCode)
- Chỉ dùng các cách đọc:
  - `GET http://127.0.0.1:20130/stats`, `GET http://127.0.0.1:20131/stats`, `/health`
  - `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\harbor-key.ps1" list [-Pool routeway]`
- **Không chạy** `check` (gửi request thật lên upstream) hay `add/remove/date/exhaust/reset/set` (ghi file).

## 8. Quy tắc chung khi gọi CLI
1. Gọi lệnh đọc trước (`--version`, `--help`, list). Chỉ giao việc thật khi các lệnh này chạy bình thường.
2. Chạy smoke trong một thư mục trống với prompt ngắn nhất, để đo thời gian và token trước khi giao task lớn.
3. Đặt timeout cho mọi lệnh. Chạy với `shell:false`. Không gọi trực tiếp `.cmd` hay `.ps1`.
4. Không in key ra màn hình. Khi đọc config có `apiKey`, mask trước khi hiển thị.
5. Ghi version CLI vào fixture và NOTES. Khi CLI lên version, chạy lại smoke trước khi tin parser cũ.
