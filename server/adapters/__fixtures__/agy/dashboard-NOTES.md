# Dashboard fixtures — AGY 1.4.12

`dashboard-status.txt` is the existing read-only `/help → /usage → /credits`
PTY capture from 03/11/2026 (`.tmp/dashboard-fix/agy-probe.json`). Email and Windows
username were replaced with synthetic values. Repeated quota frames verify
deduplication; five independent quota buckets must survive parsing.

`models.txt` was captured with the read-only `agy models` command on 03/11/2026.
It reports thirteen ids and labels separated by a tab, without price data.
Sandbox access to the Windows credential store failed; the successful capture
was run outside the sandbox. No login, permission or account setting was changed.
