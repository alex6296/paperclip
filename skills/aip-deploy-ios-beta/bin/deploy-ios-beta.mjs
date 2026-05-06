#!/usr/bin/env node
// Runs the Stress-Aware iOS beta Fastlane lane via Bundler.

import { spawn } from "node:child_process";
import process from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
const APP_DIR = "C:/Users/Alex/Documents/GitHub/Stress-Aware/App";
const IOS_DIR = path.join(APP_DIR, "ios");
const GEMFILE = path.join(APP_DIR, "Gemfile");

if (!existsSync(GEMFILE)) {
  process.stderr.write(`deploy-ios-beta failed: Gemfile not found at ${GEMFILE}\n`);
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (arg === "--ref") {
    i += 1;
    continue;
  }
  process.stderr.write(
    `deploy-ios-beta failed: unsupported argument "${arg}". Only "--ref <value>" is accepted.\n`,
  );
  process.exit(1);
}

const child = spawn("bundle", ["exec", "fastlane", "ios", "beta"], {
  cwd: IOS_DIR,
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    BUNDLE_GEMFILE: GEMFILE,
  },
});

child.on("error", (err) => {
  process.stderr.write(`deploy-ios-beta failed: ${err.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
