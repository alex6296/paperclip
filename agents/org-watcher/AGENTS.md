# Org Watcher

**Process-adapter agent — zero AI tokens.** Fires from a cron routine
(recommended every 15 minutes) and posts *new* org health problems as
Paperclip Issues assigned to the COO. Since the adapter is `process`,
this file is documentation only — the actual behavior is the plain Node
script at `bin/watcher.mjs`.

## What it does per tick

1. `GET /api/companies/:companyId/agents` — list all company agents.
2. `GET /api/companies/:companyId/approvals?status=pending` — list pending approvals.
3. Load a local JSON file of event keys it has already filed.
4. For each **new** problem not in that file, `POST` a new Issue to Paperclip
   assigned to the COO:
   - **Agent error state**: any agent with `status === "error"` → priority `high`
   - **Budget overrun**: agent spent ≥ `AIP_BUDGET_WARN_PCT`% of monthly budget → `medium` (or `high` if ≥ 100%)
   - **Pending approval**: any approval awaiting action → priority `medium`
5. Write the updated set of seen keys back to the local file.

**Event-driven by consequence**: the COO only wakes when a real new problem
lands. Overlapping ticks skip cleanly via `skip_if_active`.

## Adapter config (hire once)

```
adapter: process
command: node
args:   ["agents/org-watcher/bin/watcher.mjs"]
cwd:    <paperclip repo root>
env:
  AIP_COO_AGENT_ID:             <required — the COO's agent id>
  AIP_BUDGET_WARN_PCT:          <optional — budget % threshold, default 80>
timeoutSec: 60
```

`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, and
`PAPERCLIP_RUN_ID` are auto-injected by the `process` adapter — do not set
them manually.

## Routine

```
POST /api/companies/{companyId}/routines
{
  "title": "Org Watcher: tick",
  "assigneeAgentId": "<this watcher's agent id>",
  "projectId": "<your project id>",
  "concurrencyPolicy": "skip_if_active",
  "catchUpPolicy": "skip_missed"
}

POST /api/routines/{routineId}/triggers
{ "kind": "schedule", "cronExpression": "*/15 * * * *", "timezone": "UTC" }
```

`skip_if_active` is load-bearing — if a tick is still running when the next
one fires, the new one drops cleanly.

## Local seen-state

File: `agents/org-watcher/.state/seen-events.json`, created on first run.
Shape: `{ "events": ["agent-error:agent-42", "agent-budget:agent-7:warn",
"approval:appr-99", ...], "updatedAt": "<iso>" }`.

**Key format**:
- `agent-error:{agentId}` — re-fires if agent recovers then breaks again (new key next time status differs)
- `agent-budget:{agentId}:warn` — budget crossed warn threshold
- `agent-budget:{agentId}:over` — budget exhausted (100%+)
- `approval:{approvalId}` — pending approval filed once

Wiping the folder causes one burst of re-created duplicates on the next
tick — recoverable by closing them as duplicates.

## Notes

- The approvals fetch degrades gracefully: if the endpoint returns an error
  (e.g. the agent lacks permissions), it logs a warning and continues with
  agent checks only.
- Budget checks are skipped for agents with no `budgetMonthlyCents` set (0
  or missing).
