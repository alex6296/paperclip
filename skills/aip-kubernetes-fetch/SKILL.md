---
name: aip-kubernetes-fetch
description: >
  Fetch recent Warning events from a Kubernetes cluster, grouped by
  reason:kind:namespace signature (so 17 duplicates across nodes become one
  entry). Optionally scans running pod logs for application errors. Single-
  shot, JSON on stdout — the consumer decides what to do with the rows.
---

# aip-kubernetes-fetch

Shell out to `kubectl` — the cluster the active kubeconfig points at — and
return a deduplicated list of recent warning events. The user must have a
working `kubectl` on `PATH` with permission to `list events`. Grouping keeps
the signal-to-noise ratio manageable when a single problem manifests as
many near-identical events.

## Invocation

```bash
node skills/aip-kubernetes-fetch/bin/kubernetes-fetch.mjs [options]
```

### Options

| Flag               | Default            | Notes                                         |
| ------------------ | ------------------ | --------------------------------------------- |
| `--namespace <ns>` | `--all-namespaces` | Scope events to one namespace                 |
| `--context <ctx>`  | current context    | Pick a non-default kubeconfig context         |
| `--scan-logs`      | off                | Also tail running pod logs for error patterns |
| `--tail <n>`       | `200`              | Log lines per pod when `--scan-logs` is set   |
| `--max-pods <n>`   | `10`               | Cap pods scanned per run                      |
| `--timeout-ms <n>` | `60000`            | Hard timeout for the whole operation          |

On Windows the default kubeconfig is at `%USERPROFILE%\.kube\config`.
If that's not found, pass `--context` explicitly or set `KUBECONFIG`.

## Output

JSON to stdout, shape:

```json
{
  "events": [
    {
      "signature": "CrashLoopBackOff:Pod:default",
      "severity": "critical",
      "reason": "CrashLoopBackOff",
      "kind": "Pod",
      "namespace": "default",
      "resourceCount": 3,
      "totalCount": 17,
      "resources": ["pod-a", "pod-b", "pod-c"],
      "latestMessage": "...",
      "latestTimestamp": "2026-04-16T10:12:05Z",
      "sampleEvent": {
        /* raw k8s event */
      }
    }
  ],
  "podLogErrors": [
    {
      "signature": "log:my-pod:default",
      "podName": "my-pod",
      "namespace": "default",
      "errorLines": ["..."],
      "lineCount": 5
    }
  ]
}
```

Severity mapping:

- reason contains `oom` / `crashloop`, or message contains `oomkilled` → `critical`
- reason contains `failed` / `backoff` / `unhealthy` → `high`
- otherwise → `medium`

Exit code 0 on success (even with empty results). Non-zero only for tool
errors (kubectl missing, no permissions, JSON parse fail); stderr carries
the message.

## Recommended schedule

`kubectl get events` is cheap — a single short-lived API-server call. But
there is no upside to polling more often than once per few minutes: the
same warnings just repeat and the consumer ends up deduplicating them.

If you point a Paperclip routine at this, use
`concurrencyPolicy: skip_if_active` and `catchUpPolicy: skip_missed`
so overlapping runs are dropped rather than queued.

## Permissions

For GKE the caller needs the `container.events.list` IAM role. For other
clusters, a Kubernetes RBAC role with `["list"]` on `["events"]`. If you
get `forbidden`, fix the role — don't swallow the error.

## Environment

| Var                                          | Required | Notes                            |
| -------------------------------------------- | -------- | -------------------------------- |
| `KUBECONFIG`                                 | no       | Standard kubectl kubeconfig path |
| Any cluster auth vars kubectl normally reads | no       | Passed through                   |

## Source

Lifted and simplified from the ai-pipline prototype's
`backend/src/services/kubectl-poller.ts`: event grouping (`eventSignature`,
`groupEvents`), severity mapping (`severityFromEvent`), pod log tailing
(`scanPodLogs`), and the regex patterns that flag application errors.
Removed the Fastify/repo/settings glue so this runs as a single-shot CLI.
