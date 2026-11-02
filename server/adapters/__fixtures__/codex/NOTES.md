# codex (codex-cli 0.166.0)
- Command: `codex exec --json -s workspace-write -C <worktree> -` ; brief via **stdin** (`-` = read stdin). `--full-auto` does NOT exist in this version (exit 2).
- Network: add `-c sandbox_workspace_write.network_access=true` when the task needs npm installs.
- Output: JSONL on stdout, stderr empty on success. Exit 0 on success.
- Events: `thread.started{thread_id}` → session id; `turn.started`; `item.started|item.completed{item}` where item.type ∈ `agent_message{text}`, `command_execution{command,aggregated_output,exit_code,status}` (also file_change/reasoning/etc. in other runs); `turn.completed{usage{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}}`.
- Final answer: text of the last `agent_message`.
- No cost field (tokens only).
- Resume interactively: `codex resume <thread_id>`.
