# opencode v2.2.5 (CLI bundled with desktop app)
- Bin: `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe` (not on PATH).
- Command: `opencode-cli run --standalone --format json --auto -m <provider/model> <brief>`, cwd = worktree. User's chosen model: `harbor-pool/deepseek-v4.1-flash:free`.
- Output: JSONL with `type`: `step_start`, `tool_use{part{tool,state{status,input{path,...}}}}`, `text{part{text}}`, `step_finish{part{reason,cost,tokens}}`; every line has `sessionID`.
- Final answer: last `text` part. Cost: `step_finish.part.cost` (0 for free model).
- Resume interactively: `opencode-cli --session <sessionID>` (verify) / `run -s <id>`.
- `--standalone` is REQUIRED: without it `run` goes through a shared background service whose working directory is wherever that service started, so files land in the wrong repo (seen 2026-11-02).
