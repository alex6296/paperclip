#!/usr/bin/env node
// Org watcher — event-driven glue for Paperclip company org health.
// Zero AI tokens: polls the Paperclip API for agent anomalies (budget
// overruns, error states) and pending approvals, diffs against a local
// seen-file, and creates one Issue per new problem assigned to the COO.
// Exits 0 on empty runs. The COO only wakes when a real new problem lands.
//
// Env expected (auto-injected by the `process` adapter unless marked):
//   PAPERCLIP_API_URL
//   PAPERCLIP_API_KEY
//   PAPERCLIP_COMPANY_ID
//   PAPERCLIP_RUN_ID           (optional, used as X-Paperclip-Run-Id header)
//   AIP_COO_AGENT_ID           REQUIRED — the COO's agent id
//   AIP_BUDGET_WARN_PCT        optional — budget % threshold for warn issues (default 80)

import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(HERE, "..");
const STATE_DIR = path.join(AGENT_DIR, ".state");
const STATE_FILE = path.join(STATE_DIR, "seen-events.json");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function apiHeaders(apiKey, runId) {
  const h = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (runId) h["X-Paperclip-Run-Id"] = runId;
  return h;
}

async function apiFetch(url, apiKey, runId) {
  const res = await fetch(url, { headers: apiHeaders(apiKey, runId) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function createIssue(apiUrl, apiKey, runId, companyId, payload) {
  const res = await fetch(`${apiUrl}/api/companies/${companyId}/issues`, {
    method: "POST",
    headers: apiHeaders(apiKey, runId),
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

async function fetchAgents(apiUrl, apiKey, runId, companyId) {
  const data = await apiFetch(
    `${apiUrl}/api/companies/${companyId}/agents`,
    apiKey,
    runId,
  );
  return Array.isArray(data) ? data : (data.agents ?? data.items ?? []);
}

async function fetchApprovals(apiUrl, apiKey, runId, companyId) {
  const data = await apiFetch(
    `${apiUrl}/api/companies/${companyId}/approvals?status=pending`,
    apiKey,
    runId,
  );
  return Array.isArray(data) ? data : (data.approvals ?? data.items ?? []);
}

function budgetPct(agent) {
  if (!agent.budgetMonthlyCents || agent.budgetMonthlyCents <= 0) return 0;
  return Math.round((agent.spentMonthlyCents ?? 0) / agent.budgetMonthlyCents * 100);
}

function detectAgentProblems(agents, budgetWarnPct) {
  const problems = [];
  for (const agent of agents) {
    if (agent.status === "error") {
      problems.push({
        key: `agent-error:${agent.id}`,
        kind: "agent_error",
        agent,
        priority: "high",
        title: `Org: agent "${agent.name}" is in error state`,
        description: [
          `**Agent**: ${agent.name} (${agent.role ?? "unknown role"})`,
          `**Status**: ${agent.status}`,
          agent.title ? `**Title**: ${agent.title}` : null,
          "",
          "_Filed automatically by the Org Watcher._",
        ].filter(Boolean).join("\n"),
      });
    }
    const pct = budgetPct(agent);
    if (pct >= budgetWarnPct) {
      problems.push({
        key: `agent-budget:${agent.id}:${pct >= 100 ? "over" : "warn"}`,
        kind: "agent_budget",
        agent,
        priority: pct >= 100 ? "high" : "medium",
        title: `Org: agent "${agent.name}" budget ${pct >= 100 ? "exhausted" : `${pct}% used`}`,
        description: [
          `**Agent**: ${agent.name} (${agent.role ?? "unknown role"})`,
          `**Budget used**: ${pct}% (${ (agent.spentMonthlyCents ?? 0) / 100 } / ${ agent.budgetMonthlyCents / 100 } USD/mo)`,
          agent.title ? `**Title**: ${agent.title}` : null,
          "",
          "_Filed automatically by the Org Watcher._",
        ].filter(Boolean).join("\n"),
      });
    }
  }
  return problems;
}

function describeApproval(approval) {
  const subject = approval.subject ?? approval.title ?? approval.kind ?? "approval";
  return {
    key: `approval:${approval.id}`,
    kind: "pending_approval",
    approval,
    priority: "medium",
    title: `Org: pending approval — ${subject}`.slice(0, 200),
    description: [
      `**Approval ID**: \`${approval.id}\``,
      `**Subject**: ${subject}`,
      approval.requestedBy ? `**Requested by**: ${approval.requestedBy}` : null,
      approval.createdAt ? `**Created**: ${approval.createdAt}` : null,
      "",
      "_Filed automatically by the Org Watcher._",
    ].filter(Boolean).join("\n"),
  };
}

async function loadSeen() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.events)) return new Set(parsed.events);
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
    { events: Array.from(seen).sort(), updatedAt: new Date().toISOString() },
    null,
    2,
  );
  await fs.writeFile(STATE_FILE, body, "utf8");
}

async function main() {
  const apiUrl = requireEnv("PAPERCLIP_API_URL").replace(/\/$/, "");
  const apiKey = requireEnv("PAPERCLIP_API_KEY");
  const companyId = requireEnv("PAPERCLIP_COMPANY_ID");
  const cooAgentId = requireEnv("AIP_COO_AGENT_ID");
  const runId = process.env.PAPERCLIP_RUN_ID ?? null;
  const budgetWarnPct = parseInt(process.env.AIP_BUDGET_WARN_PCT ?? "80", 10);

  const [agents, approvals] = await Promise.all([
    fetchAgents(apiUrl, apiKey, runId, companyId),
    fetchApprovals(apiUrl, apiKey, runId, companyId).catch((err) => {
      process.stderr.write(`approvals fetch failed (skipping): ${err.message}\n`);
      return [];
    }),
  ]);

  const agentProblems = detectAgentProblems(agents, budgetWarnPct);
  const approvalItems = approvals.map(describeApproval);
  const allItems = [...agentProblems, ...approvalItems];

  const seen = await loadSeen();
  const toCreate = allItems.filter((item) => !seen.has(item.key));

  const createdIssueIds = [];
  for (const item of toCreate) {
    try {
      const issue = await createIssue(apiUrl, apiKey, runId, companyId, {
        title: item.title,
        description: item.description,
        priority: item.priority,
        status: "todo",
        assigneeAgentId: cooAgentId,
      });
      const id = issue?.id ?? issue?.issue?.id ?? null;
      if (id) createdIssueIds.push(id);
      seen.add(item.key);
    } catch (err) {
      process.stderr.write(
        `failed to create issue for ${item.key}: ${err.message}\n`,
      );
    }
  }

  if (toCreate.length > 0) await saveSeen(seen);

  process.stdout.write(
    JSON.stringify({
      agents: agents.length,
      approvals: approvals.length,
      problems: allItems.length,
      alreadySeen: allItems.length - toCreate.length,
      created: createdIssueIds.length,
      createdIssueIds,
    }) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`org-watcher failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
