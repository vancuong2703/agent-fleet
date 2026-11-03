Goal: Verify that Agent Fleet can run codex and collect a real file change.
Create exactly one new file, hello.txt, in the repository root. Its exact UTF-8 content must be the following text followed by one LF newline:
Fleet smoke test OK
Read README.md and check.cjs if needed. Do not change any existing file. Do not install dependencies, access network, commit, create branches, or delegate to other agents.
Run node check.cjs and report the file created and test outcome. Keep your response brief.

