# Kubernetes Watcher

**Process-adapter agent — zero AI tokens.** Fires from a cron routine
(recommended every 1 minute) and posts *new* Kubernetes warnings as
Paperclip Issues assigned to the Product Owner. Since the adapter is
`process`, this file is documentation only — the actual behavior is the
plain Node script at `bin/watcher.mjs`.

## What it does per tick

1. Shell out to `skills/aip-kubernetes-fetch/bin/kubernetes-fetch.mjs`.
2. Load a local JSON file of signatures it has already filed.
3. For each signature **not** in that file, `POST` a new Issue to Paperclip
   assigned to the PO (severity → priority, signature in the description).
4. Write the updated set back to the file.

**Event-driven by consequence**: the PO only wakes when a real new signature
lands. Overlapping fetches do nothing expensive.

## Adapter config (hire once)

```
adapter: process
command: node
args:   ["agents/kubernetes-watcher/bin/watcher.mjs"]
cwd:    <paperclip repo root>
env:
  AIP_PO_AGENT_ID:              <required — the PO's agent id>
  AIP_KUBE_NAMESPACE:           <optional — default is --all-namespaces>
  AIP_KUBE_CONTEXT:             <optional — non-default kubeconfig context>
  KUBECONFIG:                   <optional — standard kubectl env var>
timeoutSec: 90
```

`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, and
`PAPERCLIP_RUN_ID` are auto-injected by the `process` adapter — do not set
them manually.

## Routine

```
POST /api/companies/{companyId}/routines
{
  "title": "Kubernetes Watcher: tick",
  "assigneeAgentId": "<this watcher's agent id>",
  "projectId": "<your project id>",
  "concurrencyPolicy": "skip_if_active",
  "catchUpPolicy": "skip_missed"
}

POST /api/routines/{routineId}/triggers
{ "kind": "schedule", "cronExpression": "* * * * *", "timezone": "UTC" }
```

`skip_if_active` is load-bearing — if a tick is still running when the next
one fires, the new one drops. That prevents slow kubectl responses from
piling up.

## Local seen-state

File: `agents/kubernetes-watcher/.state/seen-signatures.json`, created
on first run. Shape: `{ "signatures": ["reason:kind:namespace", ...],
"updatedAt": "<iso>" }`.

If you wipe the folder you get **one burst of re-created duplicates** on
the next tick. That's recoverable (you close them as dups) — trade for
not coupling the watcher to a remote state store.

If you need survivability across machines later: swap the file for a
Paperclip issue-document on a "Kubernetes Watcher State" issue — same
load/save shape, different storage.
