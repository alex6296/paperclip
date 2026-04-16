#!/usr/bin/env node
// Crashlytics watcher — event-driven glue between `aip-crashlytics-fetch`
// and Paperclip. Zero AI tokens: runs the fetch CLI, diffs against a local
// seen-file, and creates one Issue per *new* Crashlytics issueId assigned
// to the PO.
//
// Env expected (auto-injected by the `process` adapter unless marked):
//   PAPERCLIP_API_URL
//   PAPERCLIP_API_KEY
//   PAPERCLIP_COMPANY_ID
//   PAPERCLIP_RUN_ID              (optional, used as X-Paperclip-Run-Id header)
//   AIP_PO_AGENT_ID               REQUIRED — the Product Owner's agent id
//   FIREBASE_PROJECT_ID           REQUIRED — Firebase project id
//   AIP_BUG_LABEL_ID              optional — label ID to tag issues as bugs
//   AIP_CRASHLYTICS_DAYS          optional lookback window (default 7)
//   AIP_CRASHLYTICS_LIMIT         optional max rows (default 50)

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
  "aip-crashlytics-fetch",
  "bin",
  "crashlytics-fetch.mjs",
);
const STATE_DIR = path.join(AGENT_DIR, ".state");
const STATE_FILE = path.join(STATE_DIR, "seen-issue-ids.json");

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

function buildIssuePayload(row, poAgentId) {
  const titleBits = [row.issueTitle, row.issueSubtitle].filter(Boolean);
  const title = `Crashlytics: ${titleBits.join(" — ") || row.issueId}`;

  const description = [
    `**Issue ID**: \`${row.issueId}\``,
    `**Severity**: ${row.severity} (${row.crashlyticsEventType ?? "unknown"})`,
    `**Events (last 7 days)**: ${row.eventCount ?? 0}`,
    row.latestEventTimestamp ? `**Last seen**: ${row.latestEventTimestamp}` : null,
    row.applicationDisplayVersion
      ? `**App version**: ${row.applicationDisplayVersion}`
      : null,
    row.operatingSystem ? `**OS**: ${row.operatingSystem}` : null,
    row.deviceModel ? `**Device**: ${row.deviceModel}` : null,
    row.blameFrameFile
      ? `**Blame frame**: \`${row.blameFrameFile}${row.blameFrameLine ? `:${row.blameFrameLine}` : ""}\``
      : null,
    "",
    "_Filed automatically by the Crashlytics Watcher._",
  ]
    .filter(Boolean)
    .join("\n");

  const bugLabelId = process.env.AIP_BUG_LABEL_ID ?? null;
  return {
    title: title.slice(0, 200),
    description,
    priority: severityToPriority(row.severity),
    status: "todo",
    assigneeAgentId: poAgentId,
    ...(bugLabelId ? { labelIds: [bugLabelId] } : {}),
  };
}

function runFetch() {
  return new Promise((resolve, reject) => {
    const args = [
      FETCH_SCRIPT,
      "--project-id",
      requireEnv("FIREBASE_PROJECT_ID"),
    ];
    if (process.env.AIP_CRASHLYTICS_DAYS) {
      args.push("--days", process.env.AIP_CRASHLYTICS_DAYS);
    }
    if (process.env.AIP_CRASHLYTICS_LIMIT) {
      args.push("--limit", process.env.AIP_CRASHLYTICS_LIMIT);
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
      reject(new Error("crashlytics-fetch timed out"));
    }, 180_000);
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
          `crashlytics-fetch exited ${code}: ${stderr.trim() || stdout.trim()}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`crashlytics-fetch returned non-JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

async function loadSeen() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.issueIds)) return new Set(parsed.issueIds);
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
    { issueIds: Array.from(seen).sort(), updatedAt: new Date().toISOString() },
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
  const rows = Array.isArray(fetched.issues) ? fetched.issues : [];
  const seen = await loadSeen();

  const toCreate = rows.filter((r) => r.issueId && !seen.has(r.issueId));
  const createdIssueIds = [];
  for (const row of toCreate) {
    try {
      const issue = await createIssue(
        apiUrl,
        apiKey,
        runId,
        companyId,
        buildIssuePayload(row, poAgentId),
      );
      const id = issue?.id ?? issue?.issue?.id ?? null;
      if (id) createdIssueIds.push(id);
      seen.add(row.issueId);
    } catch (err) {
      process.stderr.write(
        `failed to create issue for ${row.issueId}: ${err.message}\n`,
      );
    }
  }

  if (toCreate.length > 0) await saveSeen(seen);

  process.stdout.write(
    JSON.stringify({
      fetched: rows.length,
      alreadySeen: rows.length - toCreate.length,
      created: createdIssueIds.length,
      createdIssueIds,
    }) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`crashlytics-watcher failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
