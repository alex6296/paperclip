# Crashlytics Watcher

**Process-adapter agent — zero AI tokens.** Fires from a cron routine
(recommended once a day) and posts *new* Firebase Crashlytics issues as
Paperclip Issues assigned to the Product Owner. The free-tier BigQuery
export only updates once a day, so a faster cron is money-wasted: the
same rows come back unchanged.

Since the adapter is `process`, this file is documentation only — the
actual behavior is the plain Node script at `bin/watcher.mjs`.

## What it does per tick

1. Shell out to `skills/aip-crashlytics-fetch/bin/crashlytics-fetch.mjs`.
2. Load a local JSON file of `issueId`s already filed.
3. For each `issueId` **not** in that file, `POST` a new Paperclip Issue
   assigned to the PO (FATAL → critical, ANR → high, otherwise medium).
4. Write the updated set back.

## Adapter config (hire once)

```
adapter: process
command: node
args:   ["agents/crashlytics-watcher/bin/watcher.mjs"]
cwd:    <paperclip repo root>
env:
  AIP_PO_AGENT_ID:              <required — the PO's agent id>
  FIREBASE_PROJECT_ID:          <required — Firebase project id>
  AIP_CRASHLYTICS_DAYS:         <optional — lookback window in days, default 7>
  AIP_CRASHLYTICS_LIMIT:        <optional — max rows, default 50>
timeoutSec: 180
```

`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, and
`PAPERCLIP_RUN_ID` are auto-injected by the `process` adapter — do not set
them manually.

The BigQuery CLI (`bq`) needs to be on `PATH` and authed — see
`skills/aip-crashlytics-fetch/SKILL.md` for `gcloud auth login` setup. The
Crashlytics → BigQuery integration must be enabled in Firebase Console.

## Routine

```
POST /api/companies/{companyId}/routines
{
  "title": "Crashlytics Watcher: daily tick",
  "assigneeAgentId": "<this watcher's agent id>",
  "projectId": "<your project id>",
  "concurrencyPolicy": "skip_if_active",
  "catchUpPolicy": "skip_missed"
}

POST /api/routines/{routineId}/triggers
{ "kind": "schedule", "cronExpression": "0 6 * * *", "timezone": "UTC" }
```

`0 6 * * *` = 06:00 UTC — past the typical Firebase daily batch landing
time so there's fresh data to scan. Adjust to your timezone if you want the
issues to land during your working hours.

## Local seen-state

File: `agents/crashlytics-watcher/.state/seen-issue-ids.json`. Shape:
`{ "issueIds": ["a1b2c3", ...], "updatedAt": "<iso>" }`. Same trade-offs
as the Kubernetes Watcher — local file, resets on wipe, one burst of
re-created duplicates in exchange for zero coupling to a remote store.
