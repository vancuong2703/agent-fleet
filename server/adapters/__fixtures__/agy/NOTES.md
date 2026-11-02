# agy (Antigravity CLI)
- Command: `agy --output-format stream-json --mode accept-edits -p <brief>` — `-p` TAKES the prompt as its value; putting another flag after `-p` makes that flag the prompt (exit 2, error on stderr). Run with cwd = worktree (no cwd flag; `--add-dir` exists).
- Output: NDJSON with key `event`: `init{conversation_id,init{cwd,tools}}`, `step_update{step_index,state:ACTIVE|DONE,step_type:user_input|agent_response|tool, tool_name, tool_info{name,parameters}, text_delta, usage{input_tokens,output_tokens,thinking_tokens}}`, final `result{conversation_id,status:SUCCESS|...,response,duration_seconds,usage}`.
- agent_response text arrives as many `text_delta` chunks → parser must accumulate per step_index and emit one `message` when state DONE.
- Final answer: `result.response`. Tool write_file → file_edit (`tool_info.parameters.Path`).
- Resume interactively: `agy --conversation <conversation_id>`.
