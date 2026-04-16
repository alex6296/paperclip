#!/usr/bin/env node
// Run a sequential list of deploy shell steps from a JSON config.
// Adapted from ai-pipline/backend/src/services/deploy-runner.ts.
// Continue-on-failure: a failing step does not abort the run; every step's
// outcome is reported. Per-step timeout: 5 minutes. Output cap: 10 KB per
// stream (stdout, stderr) as in the prototype.

import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 10 * 1024;

function parseArgs(argv) {
  const out = { config: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i];
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: rollout-backend.mjs --config <path-to-deploy.json>\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function validateConfig(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("config must be a JSON object");
  }
  if (typeof raw.targetProjectPath !== "string" || !raw.targetProjectPath) {
    throw new Error("config.targetProjectPath (string) is required");
  }
  if (!Array.isArray(raw.steps)) {
    throw new Error("config.steps must be an array");
  }
  const steps = [];
  for (const [i, s] of raw.steps.entries()) {
    if (typeof s !== "object" || s === null) {
      throw new Error(`steps[${i}] must be an object`);
    }
    if (typeof s.name !== "string" || !s.name) {
      throw new Error(`steps[${i}].name (string) is required`);
    }
    if (typeof s.command !== "string" || !s.command) {
      throw new Error(`steps[${i}].command (string) is required`);
    }
    if (typeof s.cwd !== "string") {
      throw new Error(`steps[${i}].cwd (string) is required`);
    }
    if (typeof s.enabled !== "boolean") {
      throw new Error(`steps[${i}].enabled (boolean) is required`);
    }
    steps.push(s);
  }
  return { targetProjectPath: raw.targetProjectPath, steps };
}

function execCommand(command, cwd) {
  return new Promise((res) => {
    exec(
      command,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES * 2,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const exitCode = err
          ? (typeof err.code === "number" ? err.code : 1)
          : 0;
        res({
          exitCode,
          stdout: String(stdout).slice(0, MAX_OUTPUT_BYTES),
          stderr: String(stderr).slice(0, MAX_OUTPUT_BYTES),
        });
      },
    );
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config) {
    process.stderr.write("--config is required\n");
    process.exit(2);
  }

  let raw;
  try {
    const text = await fs.readFile(args.config, "utf8");
    raw = JSON.parse(text);
  } catch (err) {
    process.stderr.write(`failed to read config: ${err.message}\n`);
    process.exit(2);
  }

  let config;
  try {
    config = validateConfig(raw);
  } catch (err) {
    process.stderr.write(`invalid config: ${err.message}\n`);
    process.exit(2);
  }

  const enabled = config.steps.filter((s) => s.enabled);
  const results = [];

  for (const step of enabled) {
    const cwd = path.isAbsolute(step.cwd)
      ? step.cwd
      : path.resolve(config.targetProjectPath, step.cwd);

    const start = Date.now();
    const { exitCode, stdout, stderr } = await execCommand(step.command, cwd);
    const durationMs = Date.now() - start;
    const success = exitCode === 0;

    results.push({
      name: step.name,
      command: step.command,
      cwd,
      exitCode,
      stdout,
      stderr,
      durationMs,
      success,
    });
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  process.stdout.write(
    JSON.stringify({
      targetProjectPath: config.targetProjectPath,
      total: results.length,
      succeeded,
      failed,
      results,
    }) + "\n",
  );

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`rollout-backend failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
