#!/usr/bin/env node
// Runs `npx bundle fastlane ios beta` in the Stress-Aware iOS directory.

import { spawn } from "node:child_process";
import process from "node:process";

const IOS_DIR = "C:/Users/Alex/Documents/GitHub/Stress-Aware/App/ios";

const child = spawn("npx", ["bundle", "fastlane", "ios", "beta"], {
  cwd: IOS_DIR,
  shell: true,
  stdio: "inherit",
});

child.on("error", (err) => {
  process.stderr.write(`deploy-ios-beta failed: ${err.message}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
