---
name: aip-run-integration-tests
description: Run a shell test command in a target project and capture stdout/stderr/exit code with a hard timeout.
---

# aip-run-integration-tests

Thin wrapper around `node:child_process.spawn` with `shell: true`. Given a
working directory and a shell string, it runs the command, streams both
stdout and stderr into buffers, enforces a timeout, and returns one JSON
blob the caller can inspect or archive on an issue.

Lifted verbatim from `ai-pipline/backend/src/services/test-runner.ts` —
notably the Windows tree-kill (`taskkill /pid <pid> /T /F`). Do **not**
replace it with plain `child.kill("SIGTERM")`: on Windows with `shell:
true`, SIGTERM only reaches `cmd.exe`, leaving the grandchild (pytest,
vitest, jest, etc.) alive and the `close` event stalled.

## Invocation

```bash
node skills/aip-run-integration-tests/bin/run-integration-tests.mjs \
  --cwd <absolute-or-relative-path> \
  --cmd "<shell command>" \
  [--timeout-ms 900000] \
  [--label integration]
```

Flags:
- `--cwd` **required**: working directory for the command.
- `--cmd` **required**: the full shell string, quoted. Quoting is the
  caller's responsibility (the whole string is passed to `cmd.exe` on
  Windows or `/bin/sh` on POSIX).
- `--timeout-ms`: hard kill after this many ms. Default `900000` (15 min).
- `--label`: free-form tag echoed back in the JSON so the caller can tell
  runs apart in a log. Default `"run"`.

## Output (JSON on stdout)

```json
{
  "label": "integration",
  "command": "pnpm test:integration",
  "cwd": "C:\\path\\to\\repo",
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "durationMs": 42317,
  "timedOut": false,
  "passed": true
}
```

`passed` is `true` only when `timedOut === false` **and** `exitCode === 0`.

Exit code: the CLI itself exits 0 on normal completion (pass or fail — the
JSON carries the result). It exits 2 only on missing/invalid flags.

## Typical wiring

For QA and Tester agents, include in `desiredSkills` at hire time. In
prompt snippets:

> To run your tests: `node skills/aip-run-integration-tests/bin/run-integration-tests.mjs --cwd <repo> --cmd "<your test command>"` then read the JSON on stdout. Paste `stdout`/`stderr` (truncated if huge) and `passed`/`exitCode`/`durationMs` into a comment on your issue.

## Notes

- No `--env` flag — the child inherits the adapter's env. If you need a
  different env, wrap your command (`"FOO=bar pnpm test"` on POSIX,
  `"set FOO=bar && pnpm test"` on Windows).
- Stdout/stderr are kept unbounded in memory; if your command emits
  megabytes, truncate before reporting.
- No retry, no flakiness detection. The agent decides whether a single
  pass means the change is good.
