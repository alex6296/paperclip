#!/usr/bin/env node
// CLI port of ai-pipline/backend/src/services/kubectl-poller.ts.
// Self-contained — no workspace deps. Fetches recent Warning events from
// the cluster the active kubeconfig points at, groups duplicates by
// reason:kind:namespace signature, and (optionally) scans running pod logs
// for application errors. Emits JSON on stdout.

import { spawn } from "node:child_process";

const LOG_ERROR_PATTERNS = [
  /\bERROR\b/i,
  /\bFATAL\b/i,
  /\bPANIC\b/i,
  /\bUnhandled(Promise)?Rejection\b/i,
  /\bException\b.*\b(at|in)\b/i,
  /\bHTTP\s+5\d{2}\b/,
  /\bstatus[: ]+5\d{2}\b/i,
  /\bInternal Server Error\b/i,
  /\bsegmentation fault\b/i,
  /\bOOM\b/,
  /\bconnection refused\b/i,
  /\btimeout\b.*\b(expired|exceeded)\b/i,
];

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function parseArgs(argv) {
  const out = {
    namespace: null,
    context: null,
    scanLogs: false,
    tail: 200,
    maxPods: 10,
    timeoutMs: 60_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--namespace": out.namespace = next(); break;
      case "--context": out.context = next(); break;
      case "--scan-logs": out.scanLogs = true; break;
      case "--tail": out.tail = Number.parseInt(next(), 10); break;
      case "--max-pods": out.maxPods = Number.parseInt(next(), 10); break;
      case "--timeout-ms": out.timeoutMs = Number.parseInt(next(), 10); break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: kubernetes-fetch.mjs [options]",
      "",
      "  --namespace <ns>    Scope to one namespace (default: --all-namespaces)",
      "  --context <ctx>     Non-default kubeconfig context",
      "  --scan-logs         Also scan running pod logs for errors",
      "  --tail <n>          Log lines per pod when --scan-logs set (default 200)",
      "  --max-pods <n>      Cap pods scanned per run (default 10)",
      "  --timeout-ms <n>    Hard timeout for whole op (default 60000)",
      "",
    ].join("\n"),
  );
}

// shell:true so cmd.exe can resolve kubectl on Windows when it's a .cmd
// shim. Harmless on POSIX.
function execKubectl(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", args, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      reject(new Error(`kubectl timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr?.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`kubectl spawn failed: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `kubectl exited ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
      ));
    });
  });
}

function severityFromEvent(event) {
  const reason = event.reason?.toLowerCase() ?? "";
  const msg = event.message?.toLowerCase() ?? "";
  if (
    reason.includes("oom") ||
    reason.includes("crashloop") ||
    msg.includes("oomkilled")
  ) return "critical";
  if (
    reason.includes("failed") ||
    reason.includes("backoff") ||
    reason.includes("unhealthy")
  ) return "high";
  return "medium";
}

function eventSignature(event) {
  const reason = event.reason ?? "Unknown";
  const kind = event.involvedObject?.kind ?? "Unknown";
  const ns = event.metadata?.namespace ?? "_cluster";
  return `${reason}:${kind}:${ns}`;
}

function groupEvents(events) {
  const map = new Map();
  for (const event of events) {
    const sig = eventSignature(event);
    const existing = map.get(sig);
    const sev = severityFromEvent(event);
    const resourceName = event.involvedObject?.name ?? "unknown";
    const count = event.count ?? 1;

    if (!existing) {
      map.set(sig, {
        signature: sig,
        reason: event.reason ?? "Unknown",
        kind: event.involvedObject?.kind ?? "Unknown",
        namespace: event.metadata?.namespace ?? "_cluster",
        severity: sev,
        resources: [resourceName],
        totalCount: count,
        latestMessage: event.message ?? "",
        latestTimestamp:
          event.lastTimestamp ?? event.metadata?.creationTimestamp ?? null,
        sampleEvent: event,
      });
      continue;
    }
    if ((SEVERITY_RANK[sev] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
      existing.severity = sev;
    }
    if (!existing.resources.includes(resourceName)) {
      existing.resources.push(resourceName);
    }
    existing.totalCount += count;
    const existingTs = existing.latestTimestamp
      ? new Date(existing.latestTimestamp).getTime()
      : 0;
    const eventTsRaw =
      event.lastTimestamp ?? event.metadata?.creationTimestamp;
    const eventTs = eventTsRaw ? new Date(eventTsRaw).getTime() : 0;
    if (eventTs > existingTs) {
      existing.latestMessage = event.message ?? existing.latestMessage;
      existing.latestTimestamp = eventTsRaw ?? existing.latestTimestamp;
    }
  }
  return Array.from(map.values());
}

async function fetchWarningEvents(opts) {
  const args = ["get", "events", "--field-selector=type=Warning", "-o", "json"];
  if (opts.context) args.push("--context", opts.context);
  if (opts.namespace) args.push("-n", opts.namespace);
  else args.push("--all-namespaces");

  const { stdout } = await execKubectl(args, opts.timeoutMs);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("kubectl returned non-JSON output");
  }
  return parsed.items ?? [];
}

async function scanPodLogs(opts) {
  const podArgs = [
    "get",
    "pods",
    "--field-selector=status.phase=Running",
    "-o",
    "jsonpath={range .items[*]}{.metadata.namespace}/{.metadata.name} {end}",
  ];
  if (opts.context) podArgs.push("--context", opts.context);
  if (opts.namespace) podArgs.push("-n", opts.namespace);
  else podArgs.push("--all-namespaces");

  let pods;
  try {
    const { stdout } = await execKubectl(podArgs, Math.min(opts.timeoutMs, 30_000));
    pods = stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((entry) => {
        const [ns, name] = entry.split("/");
        return { namespace: ns ?? opts.namespace ?? "_all", name };
      })
      .filter((p) => p.name);
  } catch {
    return [];
  }

  const podsToScan = pods.slice(0, opts.maxPods);
  const errors = [];

  for (const pod of podsToScan) {
    const logArgs = [
      "logs",
      pod.name,
      "--since=5m",
      `--tail=${opts.tail}`,
      "-n",
      pod.namespace,
    ];
    if (opts.context) logArgs.push("--context", opts.context);

    try {
      const { stdout } = await execKubectl(logArgs, 10_000);
      const errorLines = [];
      for (const line of stdout.split("\n")) {
        if (LOG_ERROR_PATTERNS.some((pat) => pat.test(line))) {
          errorLines.push(line.trim().slice(0, 500));
          if (errorLines.length >= 10) break;
        }
      }
      if (errorLines.length > 0) {
        errors.push({
          signature: `log:${pod.name}:${pod.namespace}`,
          podName: pod.name,
          namespace: pod.namespace,
          errorLines,
          lineCount: errorLines.length,
        });
      }
    } catch {
      // Pod log fetch failed (container restarting, etc.) — skip silently.
    }
  }

  return errors;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  const deadline = Date.now() + opts.timeoutMs;
  const budget = () => Math.max(1_000, deadline - Date.now());

  let raw;
  try {
    raw = await fetchWarningEvents({ ...opts, timeoutMs: budget() });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const grouped = groupEvents(raw).map((g) => ({
    signature: g.signature,
    severity: g.severity,
    reason: g.reason,
    kind: g.kind,
    namespace: g.namespace,
    resourceCount: g.resources.length,
    totalCount: g.totalCount,
    resources: g.resources,
    latestMessage: g.latestMessage,
    latestTimestamp: g.latestTimestamp,
    sampleEvent: g.sampleEvent,
  }));

  let podLogErrors = [];
  if (opts.scanLogs) {
    try {
      podLogErrors = await scanPodLogs({ ...opts, timeoutMs: budget() });
    } catch (err) {
      process.stderr.write(`pod log scan failed: ${err.message}\n`);
    }
  }

  process.stdout.write(JSON.stringify({ events: grouped, podLogErrors }) + "\n");
}

main().catch((err) => {
  process.stderr.write(`unexpected: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
});
