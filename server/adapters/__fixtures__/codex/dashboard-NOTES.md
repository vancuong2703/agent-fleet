# Dashboard fixtures — Codex 0.166.0

`dashboard-status.txt` is the existing read-only PTY `/status` capture from
03/11/2026 (`.tmp/dashboard-fix/codex-probe.json`), copied for parser regression.
Email and Windows username were replaced with synthetic values. Repeated screen
frames are intentional: the parser must not duplicate the two quota windows.

Authentication tests construct synthetic JWT payloads entirely in memory. No
real `auth.json`, JWT, account identity or model configuration is in fixtures.
The plan claim is display information only and is not verified entitlement.
