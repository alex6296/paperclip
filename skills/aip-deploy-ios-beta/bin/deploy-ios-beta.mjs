#!/usr/bin/env node
// Windows-friendly iOS beta deploy stub. Dispatches a GitHub Actions
// workflow via `gh workflow run`, then polls `gh run view` until the run
// reaches a terminal state or we hit --timeout-ms.

import { spawn } from "node:child_process";
import process from "node:process";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const LIST_RETRY_DELAY_MS = 3_000;
const LIST_RETRIES = 10;

function parseArgs(argv) {
  const out = {
    ref: null,
    workflow: "ios-beta.yml",
    repo: null,
    pollMs: DEFAULT_POLL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--ref") out.ref = next();
    else if (a === "--workflow") out.workflow = next();
    else if (a === "--repo") out.repo = next();
    else if (a === "--poll-interval-ms") out.pollMs = Number(next());
    else if (a === "--timeout-ms") out.timeoutMs = Number(next());
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: deploy-ios-beta.mjs --ref <branch> [--workflow ios-beta.yml] [--repo owner/name] [--poll-interval-ms 15000] [--timeout-ms 2700000]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function runGh(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      reject(new Error(`gh ${args.join(" ")} timed out`));
    }, timeoutMs);
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
          `gh ${args.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dispatchWorkflow({ ref, workflow, repo }) {
  const args = ["workflow", "run", workflow, "--ref", ref];
  if (repo) args.push("--repo", repo);
  await runGh(args);
}

async function findRun({ ref, workflow, repo, dispatchedAt }) {
  const args = [
    "run", "list",
    "--workflow", workflow,
    "--branch", ref,
    "--limit", "5",
    "--json", "databaseId,url,status,conclusion,createdAt,headBranch,event",
  ];
  if (repo) args.push("--repo", repo);
  for (let attempt = 0; attempt < LIST_RETRIES; attempt++) {
    try {
      const { stdout } = await runGh(args);
      const runs = JSON.parse(stdout);
      const match = runs
        .filter((r) => new Date(r.createdAt).getTime() >= dispatchedAt - 5_000)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (match) return match;
    } catch (err) {
      if (attempt === LIST_RETRIES - 1) throw err;
    }
    await sleep(LIST_RETRY_DELAY_MS);
  }
  return null;
}

async function pollRun({ runId, repo, pollMs, deadline }) {
  const args = [
    "run", "view", String(runId),
    "--json", "status,conclusion,updatedAt,url",
  ];
  if (repo) args.push("--repo", repo);
  while (Date.now() < deadline) {
    const { stdout } = await runGh(args);
    const info = JSON.parse(stdout);
    if (info.status === "completed") return info;
    await sleep(pollMs);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.ref) {
    process.stderr.write("--ref is required\n");
    process.exit(2);
  }

  const start = Date.now();
  const deadline = start + args.timeoutMs;

  try {
    await dispatchWorkflow({ ref: args.ref, workflow: args.workflow, repo: args.repo });
  } catch (err) {
    process.stderr.write(`dispatch failed: ${err.message}\n`);
    process.exit(1);
  }

  const run = await findRun({
    ref: args.ref,
    workflow: args.workflow,
    repo: args.repo,
    dispatchedAt: start,
  });

  if (!run) {
    process.stdout.write(
      JSON.stringify({
        ref: args.ref,
        workflow: args.workflow,
        runId: null,
        runUrl: null,
        conclusion: null,
        status: "pending",
        durationMs: Date.now() - start,
        timedOut: false,
        note: "dispatch ok but run did not appear in listings — investigate in GitHub Actions UI",
      }) + "\n",
    );
    process.exit(1);
  }

  const final = await pollRun({
    runId: run.databaseId,
    repo: args.repo,
    pollMs: args.pollMs,
    deadline,
  });

  const timedOut = final === null;
  const out = {
    ref: args.ref,
    workflow: args.workflow,
    runId: run.databaseId,
    runUrl: run.url,
    conclusion: final?.conclusion ?? null,
    status: final?.status ?? "in_progress",
    durationMs: Date.now() - start,
    timedOut,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(out.conclusion === "success" ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`deploy-ios-beta failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
