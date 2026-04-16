#!/usr/bin/env node
// CLI port of ai-pipline/backend/src/services/crashlytics-poller.ts.
// Queries the Firebase Crashlytics BigQuery export for the top crash issues
// in the last N days and emits JSON on stdout. No dedup, no side effects.

import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = {
    projectId: process.env.FIREBASE_PROJECT_ID ?? null,
    days: 7,
    limit: 50,
    timeoutMs: 120_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--project-id": out.projectId = next(); break;
      case "--days": out.days = Number.parseInt(next(), 10); break;
      case "--limit": out.limit = Number.parseInt(next(), 10); break;
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
  if (!out.projectId) {
    throw new Error(
      "Missing --project-id (or FIREBASE_PROJECT_ID env). See SKILL.md.",
    );
  }
  if (!Number.isFinite(out.days) || out.days < 1) out.days = 7;
  if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = 50;
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: crashlytics-fetch.mjs --project-id <id> [options]",
      "",
      "  --project-id <id>   Firebase project id (or FIREBASE_PROJECT_ID env)",
      "  --days <n>          Lookback window (default 7)",
      "  --limit <n>         Max issues returned (default 50)",
      "  --timeout-ms <n>    Hard bq timeout (default 120000)",
      "",
    ].join("\n"),
  );
}

function buildQuery(projectId, days, limit) {
  // Wildcard across all Crashlytics tables (per-app, suffixed by app id or
  // date on the batch export). `ANY_VALUE` picks one representative row per
  // issue. 7-day default window because free-tier batch export is daily and
  // a 24h window misses late days.
  return `
    SELECT
      issue_id,
      ANY_VALUE(issue_title) AS issue_title,
      ANY_VALUE(issue_subtitle) AS issue_subtitle,
      ANY_VALUE(event_id) AS event_id,
      MAX(event_timestamp) AS event_timestamp,
      ANY_VALUE(crashlytics_event_type) AS crashlytics_event_type,
      ANY_VALUE(device.model) AS device_model,
      ANY_VALUE(operating_system.display_version) AS operating_system,
      ANY_VALUE(application.display_version) AS application_display_version,
      ANY_VALUE(blame_frame.file) AS blame_frame_file,
      ANY_VALUE(blame_frame.line) AS blame_frame_line,
      COUNT(*) AS event_count
    FROM \`${projectId}.firebase_crashlytics.*\`
    WHERE event_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
    GROUP BY issue_id
    ORDER BY event_count DESC
    LIMIT ${limit}
  `.trim();
}

// `bq` on Windows is a `.cmd` batch script — spawn needs shell:true to find
// it. On POSIX it's a real binary; shell:true is harmless. Matches the
// prototype's rationale.
function execBq(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("bq", args, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      reject(new Error(`bq timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr?.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`bq spawn failed: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `bq exited ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
      ));
    });
  });
}

function severityFromType(type) {
  const t = (type ?? "").toUpperCase();
  if (t.includes("FATAL") && !t.includes("NON")) return "critical";
  if (t.includes("ANR")) return "high";
  return "medium";
}

function shapeRow(row) {
  return {
    issueId: row.issue_id,
    severity: severityFromType(row.crashlytics_event_type),
    issueTitle: row.issue_title ?? null,
    issueSubtitle: row.issue_subtitle ?? null,
    eventId: row.event_id ?? null,
    eventCount: Number.parseInt(row.event_count ?? "0", 10),
    latestEventTimestamp: row.event_timestamp ?? null,
    crashlyticsEventType: row.crashlytics_event_type ?? null,
    deviceModel: row.device_model ?? null,
    operatingSystem: row.operating_system ?? null,
    applicationDisplayVersion: row.application_display_version ?? null,
    blameFrameFile: row.blame_frame_file ?? null,
    blameFrameLine:
      row.blame_frame_line === undefined || row.blame_frame_line === null
        ? null
        : Number.isNaN(Number(row.blame_frame_line))
          ? row.blame_frame_line
          : Number(row.blame_frame_line),
  };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  const query = buildQuery(opts.projectId, opts.days, opts.limit);
  let stdout;
  try {
    ({ stdout } = await execBq(
      [
        "query",
        "--format=json",
        "--use_legacy_sql=false",
        `--project_id=${opts.projectId}`,
        `--max_rows=${opts.limit}`,
        // bq needs the query as a single argument. Quoting rules differ
        // between cmd.exe and POSIX shells; the portable path is to pipe
        // via stdin, but `bq query` doesn't accept stdin — we fall back on
        // the documented "last positional is the SQL" form and wrap in
        // double quotes which both shells honour for a whitespace-free
        // single argument.
        `"${query.replace(/"/g, '\\"').replace(/\s+/g, " ").trim()}"`,
      ],
      opts.timeoutMs,
    ));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const trimmed = stdout.trim();
  let rows = [];
  if (trimmed && trimmed !== "[]") {
    try {
      rows = JSON.parse(trimmed);
    } catch {
      process.stderr.write(
        `bq returned non-JSON output: ${trimmed.slice(0, 200)}\n`,
      );
      process.exit(1);
    }
  }
  if (!Array.isArray(rows)) rows = [];

  const issues = rows.map(shapeRow);
  process.stdout.write(
    JSON.stringify(
      { projectId: opts.projectId, windowDays: opts.days, issues },
    ) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`unexpected: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
});
