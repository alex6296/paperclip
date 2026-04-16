#!/usr/bin/env node
// Kubernetes watcher — event-driven glue between `aip-kubernetes-fetch` and
// Paperclip. Zero AI tokens: runs the fetch CLI, diffs against a local
// seen-file, and creates one Issue per *new* signature assigned to the PO.
// Exits 0 on empty runs. The PO wakes only when a real new signature lands.
//
// Env expected (auto-injected by the `process` adapter unless marked):
//   PAPERCLIP_API_URL
//   PAPERCLIP_API_KEY
//   PAPERCLIP_COMPANY_ID
//   PAPERCLIP_RUN_ID           (optional, used as X-Paperclip-Run-Id header)
//   AIP_PO_AGENT_ID            REQUIRED — the Product Owner's agent id
//   AIP_KUBE_NAMESPACE         optional
//   AIP_KUBE_CONTEXT           optional

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(AGENT_DIR, "..", "..");
const FETCH_SCRIPT = path.join(
  REPO_ROOT,
  "skills",
  "aip-kubernetes-fetch",
  "bin",
  "kubernetes-fetch.mjs",
);
const STATE_DIR = path.join(AGENT_DIR, ".state");
const STATE_FILE = path.join(STATE_DIR, "seen-signatures.json");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function severityToPriority(sev) {
  return sev === "critical" || sev === "high" || sev === "medium" || sev === "low"
    ? sev
    : "medium";
}

function buildIssuePayload(group, poAgentId) {
  const count = group.resourceCount;
  const title =
    count > 1
      ? `Kubernetes: ${group.reason} ${group.kind} (×${count})`
      : `Kubernetes: ${group.reason} ${group.kind}/${group.resources[0]}`;

  const resourceList =
    count <= 5
      ? group.resources.join(", ")
      : `${group.resources.slice(0, 5).join(", ")} +${count - 5} more`;

  const description = [
    `**Signature**: \`${group.signature}\``,
    `**Severity**: ${group.severity}`,
    `**Namespace**: ${group.namespace}`,
    `**Affected**: ${resourceList}`,
    `**Total events**: ${group.totalCount}`,
    group.latestTimestamp ? `**Last seen**: ${group.latestTimestamp}` : null,
    "",
    "## Latest message",
    "",
    "```",
    (group.latestMessage || "(no message)").slice(0, 2000),
    "```",
    "",
    "_Filed automatically by the Kubernetes Watcher._",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: title.slice(0, 200),
    description,
    priority: severityToPriority(group.severity),
    status: "todo",
    assigneeAgentId: poAgentId,
  };
}

function runFetch() {
  return new Promise((resolve, reject) => {
    const args = [FETCH_SCRIPT];
    if (process.env.AIP_KUBE_NAMESPACE) {
      args.push("--namespace", process.env.AIP_KUBE_NAMESPACE);
    }
    if (process.env.AIP_KUBE_CONTEXT) {
      args.push("--context", process.env.AIP_KUBE_CONTEXT);
    }
    const child = spawn("node", args, {
      cwd: REPO_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      reject(new Error("kubernetes-fetch timed out"));
    }, 90_000);
    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `kubernetes-fetch exited ${code}: ${stderr.trim() || stdout.trim()}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`kubernetes-fetch returned non-JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

async function loadSeen() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.signatures)) return new Set(parsed.signatures);
  } catch (err) {
    if (err.code !== "ENOENT") {
      process.stderr.write(`seen-file unreadable, starting empty: ${err.message}\n`);
    }
  }
  return new Set();
}

async function saveSeen(seen) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const body = JSON.stringify(
    { signatures: Array.from(seen).sort(), updatedAt: new Date().toISOString() },
    null,
    2,
  );
  await fs.writeFile(STATE_FILE, body, "utf8");
}

async function createIssue(apiUrl, apiKey, runId, companyId, payload) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (runId) headers["X-Paperclip-Run-Id"] = runId;
  const res = await fetch(`${apiUrl}/api/companies/${companyId}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`create issue ${res.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function main() {
  const apiUrl = requireEnv("PAPERCLIP_API_URL").replace(/\/$/, "");
  const apiKey = requireEnv("PAPERCLIP_API_KEY");
  const companyId = requireEnv("PAPERCLIP_COMPANY_ID");
  const poAgentId = requireEnv("AIP_PO_AGENT_ID");
  const runId = process.env.PAPERCLIP_RUN_ID ?? null;

  const fetched = await runFetch();
  const events = Array.isArray(fetched.events) ? fetched.events : [];
  const seen = await loadSeen();

  const toCreate = events.filter((g) => !seen.has(g.signature));
  const createdIssueIds = [];
  for (const group of toCreate) {
    try {
      const issue = await createIssue(
        apiUrl,
        apiKey,
        runId,
        companyId,
        buildIssuePayload(group, poAgentId),
      );
      const id = issue?.id ?? issue?.issue?.id ?? null;
      if (id) createdIssueIds.push(id);
      seen.add(group.signature);
    } catch (err) {
      process.stderr.write(
        `failed to create issue for ${group.signature}: ${err.message}\n`,
      );
    }
  }

  if (toCreate.length > 0) await saveSeen(seen);

  process.stdout.write(
    JSON.stringify({
      fetched: events.length,
      alreadySeen: events.length - toCreate.length,
      created: createdIssueIds.length,
      createdIssueIds,
    }) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`kubernetes-watcher failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
