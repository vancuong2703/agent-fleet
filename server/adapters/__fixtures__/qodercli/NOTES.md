# qodercli 1.1.81
- Command: `qodercli -p <brief> -o stream-json --permission-mode accept_edits -w <worktree>` ; brief as the `-p` argument value is NOT required — `-p` is a boolean flag, prompt is the positional query. (`--input-format stream-json` exists for stdin.)
- Output: Claude-Code-style stream-json: `system{subtype:init,session_id,...}`, `assistant{message{content:[thinking|text|tool_use]}}`, `user{message{content:[tool_result]}}`, final `result{subtype:success,result,is_error,duration_ms,total_cost_usd,usage,session_id}`.
- Final answer: `result.result`. Errors: `result.is_error=true`.
- Cost: `total_cost_usd` (was 0 for this account); usage tokens were 0.
- Resume interactively: `qodercli -r <session_id>`.
