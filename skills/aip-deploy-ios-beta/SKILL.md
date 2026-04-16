---
name: aip-deploy-ios-beta
description: Trigger an iOS beta GitHub Actions workflow via `gh workflow run` and poll for completion. Windows-friendly stub.
---

# aip-deploy-ios-beta

iOS beta builds don't run on Windows. This stub dispatches a GitHub Actions
workflow that does the build on a macOS runner, then polls the run to
completion so the caller can surface a pass/fail back to Paperclip.

Uses the GitHub CLI (`gh`). Needs `gh auth status` to be green, or
`GH_TOKEN` in the env.

## Invocation

```bash
node skills/aip-deploy-ios-beta/bin/deploy-ios-beta.mjs \
  --ref <branch-or-sha> \
  [--workflow ios-beta.yml] \
  [--repo owner/name] \
  [--poll-interval-ms 15000] \
  [--timeout-ms 2700000]
```

Flags:
- `--ref` **required**: branch or SHA to build.
- `--workflow`: workflow filename (default `ios-beta.yml`). Must already
  exist in the repo's `.github/workflows/`.
- `--repo`: `owner/name`. Omit to infer from the current git checkout.
- `--poll-interval-ms`: how often to poll `gh run view` (default 15s).
- `--timeout-ms`: overall budget (default 45 min).

## Output (JSON on stdout)

```json
{
  "ref": "main",
  "workflow": "ios-beta.yml",
  "runId": 9182736452,
  "runUrl": "https://github.com/owner/repo/actions/runs/9182736452",
  "conclusion": "success",
  "status": "completed",
  "durationMs": 1342890,
  "timedOut": false
}
```

`conclusion` is one of `success`, `failure`, `cancelled`, `timed_out`,
`skipped`, `neutral`, `action_required`, or `null` (if we timed out
locally before the run finished). Exit code: `0` on `success`, `1`
otherwise.

## How it works

1. `gh workflow run <workflow> --ref <ref>` dispatches the workflow.
2. Wait ~3s for the run to appear, then `gh run list --workflow <workflow>
   --branch <ref> --limit 1 --json databaseId,url,status,conclusion,createdAt`
   to find the freshly-created run.
3. Poll `gh run view <runId> --json status,conclusion,updatedAt` every
   `--poll-interval-ms` until `status === "completed"` or the total
   wall-clock hits `--timeout-ms`.

## Typical wiring

Pin into the Deployer's `desiredSkills` at hire time. In the Deployer's
prompt:

> For iOS beta: `node skills/aip-deploy-ios-beta/bin/deploy-ios-beta.mjs --ref <branch>`; paste the JSON result (especially `runUrl` and `conclusion`) as a comment on the deploy issue.

## Caveats

- You must create the `ios-beta.yml` workflow in the target repo yourself.
  This CLI only dispatches it.
- `gh run list` is not immediately consistent — we wait and retry a few
  times before giving up. If dispatch succeeds but the run never appears,
  the CLI exits with `conclusion: null, status: "pending"` so the operator
  can investigate.
- Windows paths are fine — `gh` is happy on Windows as long as the
  terminal finds the binary on PATH.
