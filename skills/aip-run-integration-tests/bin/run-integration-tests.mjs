#!/usr/bin/env node
// Run a shell test command with a hard timeout and Windows-safe tree-kill.
// Lifted from ai-pipline/backend/src/services/test-runner.ts (execShell +
// killTree). Output is one JSON line on stdout.

import { exec, spawn } from "node:child_process";
import process from "node:process";

function parseArgs(argv) {
  const out = {
    cwd: null,
    cmd: null,
    timeoutMs: 15 * 60 * 1000,
    label: "run",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--cwd") out.cwd = next();
    else if (a === "--cmd") out.cmd = next();
    else if (a === "--timeout-ms") out.timeoutMs = Number(next());
    else if (a === "--label") out.label = next();
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: run-integration-tests.mjs --cwd <dir> --cmd \"<shell>\" [--timeout-ms 900000] [--label run]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function killTree(pid) {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    exec(`taskkill /pid ${pid} /T /F`, () => { /* swallow — already-dead is fine */ });
  } else {
    try { process.kill(pid, "SIGTERM"); } catch { /* same reasoning */ }
  }
}

function execShell({ command, cwd, timeoutMs, label }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        label,
        command,
        cwd,
        exitCode: null,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        durationMs: Date.now() - started,
        timedOut: false,
        passed: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        label,
        command,
        cwd,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        passed: !timedOut && code === 0,
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.cwd || !args.cmd) {
    process.stderr.write("--cwd and --cmd are required\n");
    process.exit(2);
  }
  const result = await execShell({
    command: args.cmd,
    cwd: args.cwd,
    timeoutMs: args.timeoutMs,
    label: args.label,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((err) => {
  process.stderr.write(`run-integration-tests failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
