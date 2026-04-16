---
name: aip-rollout-backend
description: Run a sequential list of deploy shell steps from a JSON config. Continue-on-failure, 5-min per-step timeout, 10 KB output cap.
---

# aip-rollout-backend

Given a JSON config file of deploy steps, runs them in order and returns a
structured report. Adapted from
`ai-pipline/backend/src/services/deploy-runner.ts` — same 5-min per-step
timeout, 10 KB stdout/stderr cap per step, and the same continue-on-failure
semantics (one failing step does not abort the rest; the report lists every
step's outcome).

## Invocation

```bash
node skills/aip-rollout-backend/bin/rollout-backend.mjs --config <path-to-deploy.json>
```

## Config shape

```json
{
  "targetProjectPath": "C:/path/to/repo",
  "steps": [
    { "name": "docker build",   "command": "docker build -t myapp:latest .", "cwd": ".",            "enabled": true  },
    { "name": "docker push",    "command": "docker push myapp:latest",        "cwd": ".",            "enabled": true  },
    { "name": "gcloud rollout", "command": "gcloud run deploy myapp --image myapp:latest", "cwd": ".", "enabled": true },
    { "name": "smoke test",     "command": "curl -f https://myapp.example.com/health",     "cwd": ".", "enabled": false }
  ]
}
```

- `cwd` is resolved relative to `targetProjectPath` if not absolute.
- Steps with `enabled: false` are skipped entirely (not reported).
- Order matters. Steps run **sequentially** — a step starts only after the
  previous one exits (success or failure).

## Output (JSON on stdout)

```json
{
  "targetProjectPath": "C:/path/to/repo",
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    {
      "name": "docker build",
      "command": "docker build -t myapp:latest .",
      "cwd": "C:/path/to/repo",
      "exitCode": 0,
      "stdout": "...(≤10KB)",
      "stderr": "",
      "durationMs": 45321,
      "success": true
    },
    { "name": "docker push", "...": "..." },
    { "name": "gcloud rollout", "...": "..." }
  ]
}
```

Exit code: CLI exits `0` if **all enabled steps succeeded**, `1` if any
failed (the JSON report still carries full per-step details). Exits `2`
on missing/invalid flags or malformed config.

## Typical wiring

Pin into the Deployer's `desiredSkills` at hire time. The Deployer stores
a `deploy.json` alongside the target project (or on an issue document) and
calls the CLI with its path.

## Notes vs. the prototype

- No event bus — the prototype published `deploy.started` / `deploy.completed`
  / `deploy.failed` events on an internal bus. Here, the caller (Deployer
  agent) posts a comment on the Paperclip issue with the JSON.
- No settings-repo lookup. The list of steps is explicit in the config.
- `execCommand` uses `exec` (not `spawn`) exactly like the prototype, so
  `maxBuffer` is what prevents OOM on chatty builds — `exec` also sets
  `timeout: 5*60*1000` natively.
