---
name: aip-crashlytics-fetch
description: >
  Query a Firebase Crashlytics BigQuery export and return the top crash
  issues from the last 7 days as JSON on stdout. Requires a gcloud-authed
  `bq` CLI on PATH and the Crashlytics → BigQuery integration enabled in
  the Firebase Console. Single-shot, no dedup, no side effects — the
  consumer decides what to do with the rows.
---

# aip-crashlytics-fetch

Shell out to `bq` and return crash issues from
`firebase_crashlytics.*` on the user-specified project.

## Why a 7-day window

The **free (Spark) tier** Firebase → BigQuery export is a **once-per-day
batch**. A naive 24-hour window misses days where the batch landed late. The
query pulls 7 days and lets the consumer dedup — matches the prototype's
behaviour and costs pennies per scan.

## Why BigQuery and not the Firebase Alerting webhook

The webhook fires per crash. BigQuery lets us rank by `event_count` and pull
the **top 50 grouped issues** instead of a firehose of individual events.
Good for "what's actually hurting users" versus "a thing crashed once".

## Invocation

```bash
node skills/aip-crashlytics-fetch/bin/crashlytics-fetch.mjs --project-id <firebase-project-id> [options]
```

### Options

| Flag | Default | Notes |
|---|---|---|
| `--project-id <id>` | **required** (or `FIREBASE_PROJECT_ID` env) | Firebase project id |
| `--days <n>` | `7` | Lookback window |
| `--limit <n>` | `50` | Max issues returned |
| `--timeout-ms <n>` | `120000` | Hard timeout for the `bq` call |

## Output

JSON to stdout:

```json
{
  "projectId": "my-firebase-project",
  "windowDays": 7,
  "issues": [
    {
      "issueId": "a1b2c3",
      "severity": "critical",
      "issueTitle": "NullPointerException",
      "issueSubtitle": "MainActivity.onCreate",
      "eventCount": 812,
      "latestEventTimestamp": "2026-04-15T23:10:11Z",
      "crashlyticsEventType": "FATAL",
      "deviceModel": "Pixel 7",
      "operatingSystem": "14",
      "applicationDisplayVersion": "1.4.2",
      "blameFrameFile": "MainActivity.kt",
      "blameFrameLine": 48
    }
  ]
}
```

Severity mapping (from the prototype):

- `FATAL` → `critical`
- `ANR` → `high`
- anything else (`NON_FATAL`, unknown) → `medium`

Exit code 0 on success (even with empty results). Non-zero only for tool
errors (`bq` missing, not authed, Crashlytics export not linked, etc.);
stderr carries the message.

## Recommended schedule

Because the data only updates daily, a **once-a-day cron** matches the data
cadence and keeps BQ spend negligible. Running more often wastes money and
returns the same rows. Suggested cron: `0 6 * * *` (06:00 UTC — after most
timezones' batch exports have landed). If you point a Paperclip routine at
this, use `concurrencyPolicy: skip_if_active` and `catchUpPolicy:
skip_missed`.

## Auth

Uses the existing `gcloud auth login` session — no extra credentials. The
active account must have BigQuery read on the Firebase project. First-time
setup:

```bash
gcloud auth login
gcloud config set project <firebase-project-id>
# (Firebase Console → Project settings → Integrations → BigQuery → Link)
```

## Environment

| Var | Required | Notes |
|---|---|---|
| `FIREBASE_PROJECT_ID` | no | Fallback if `--project-id` is omitted |
| Any `gcloud` auth vars | no | Passed through |

## Source

Lifted from the ai-pipline prototype's
`backend/src/services/crashlytics-poller.ts`: the `bq` invocation
(`execBq`), the 7-day wildcard `firebase_crashlytics.*` SQL (`buildQuery`),
and the event-type → severity mapping (`severityFromType`). Fastify/repo/bus
glue removed.
