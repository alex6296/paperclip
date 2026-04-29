import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readInstructionsBundle, runChildProcess } from "./server-utils.js";

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidAlive(pid);
}

describe("runChildProcess", () => {
  it("waits for onSpawn before sending stdin to the child", async () => {
    const spawnDelayMs = 150;
    const startedAt = Date.now();
    let onSpawnCompletedAt = 0;

    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      [
        "-e",
        "let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>process.stdout.write(data));",
      ],
      {
        cwd: process.cwd(),
        env: {},
        stdin: "hello from stdin",
        timeoutSec: 5,
        graceSec: 1,
        onLog: async () => {},
        onSpawn: async () => {
          await new Promise((resolve) => setTimeout(resolve, spawnDelayMs));
          onSpawnCompletedAt = Date.now();
        },
      },
    );
    const finishedAt = Date.now();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello from stdin");
    expect(onSpawnCompletedAt).toBeGreaterThanOrEqual(startedAt + spawnDelayMs);
    expect(finishedAt - startedAt).toBeGreaterThanOrEqual(spawnDelayMs);
  });

  it.skipIf(process.platform === "win32")("kills descendant processes on timeout via the process group", async () => {
    let descendantPid: number | null = null;

    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "process.stdout.write(String(child.pid));",
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ],
      {
        cwd: process.cwd(),
        env: {},
        timeoutSec: 1,
        graceSec: 1,
        onLog: async () => {},
        onSpawn: async () => {},
      },
    );

    descendantPid = Number.parseInt(result.stdout.trim(), 10);
    expect(result.timedOut).toBe(true);
    expect(Number.isInteger(descendantPid) && descendantPid > 0).toBe(true);

    expect(await waitForPidExit(descendantPid!, 2_000)).toBe(true);
  });

  it.skipIf(process.platform !== "win32")("runs .cmd launchers from paths with spaces", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip cmd shim "));
    const scriptPath = path.join(tempRoot, "echo-arg.cmd");
    try {
      await fs.writeFile(
        scriptPath,
        ["@echo off", "setlocal", "echo %~1"].join("\r\n"),
        "utf8",
      );

      const result = await runChildProcess(
        randomUUID(),
        scriptPath,
        ["hello from cmd shim"],
        {
          cwd: tempRoot,
          env: {},
          timeoutSec: 5,
          graceSec: 1,
          onLog: async () => {},
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.replace(/\r?\n$/, "")).toBe("hello from cmd shim");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("runs quoted .cmd launchers from paths with spaces", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip cmd shim quoted "));
    const scriptPath = path.join(tempRoot, "echo-arg.cmd");
    const quotedScriptPath = `"${scriptPath}"`;
    try {
      await fs.writeFile(
        scriptPath,
        ["@echo off", "setlocal", "echo %~1"].join("\r\n"),
        "utf8",
      );

      const result = await runChildProcess(
        randomUUID(),
        quotedScriptPath,
        ["hello from quoted cmd shim"],
        {
          cwd: tempRoot,
          env: {},
          timeoutSec: 5,
          graceSec: 1,
          onLog: async () => {},
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.replace(/\r?\n$/, "")).toBe("hello from quoted cmd shim");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("readInstructionsBundle", () => {
  it("loads sibling companion files into the injected instructions contents", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-instructions-bundle-"));
    const entryPath = path.join(root, "AGENTS.md");

    try {
      await fs.writeFile(entryPath, "# Agent\nPrimary instructions.\n", "utf8");
      await fs.writeFile(path.join(root, "HEARTBEAT.md"), "# Heartbeat\nLoop.\n", "utf8");
      await fs.writeFile(path.join(root, "SOUL.md"), "# Soul\nIdentity.\n", "utf8");
      await fs.writeFile(path.join(root, "MACHINE.md"), "# Machine\nControl surface.\n", "utf8");

      const bundle = await readInstructionsBundle(entryPath);

      expect(bundle.entryFilePath).toBe(entryPath);
      expect(bundle.baseDir).toBe(root);
      expect(bundle.loadedFiles).toEqual(["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "MACHINE.md"]);
      expect(bundle.contents).toContain("# Agent\nPrimary instructions.");
      expect(bundle.contents).toContain(
        "The following companion instruction files were loaded from the same agent instruction bundle directory and are active for this run.",
      );
      expect(bundle.contents).toContain("Companion instruction file: ./HEARTBEAT.md");
      expect(bundle.contents).toContain("# Heartbeat\nLoop.");
      expect(bundle.contents).toContain("Companion instruction file: ./SOUL.md");
      expect(bundle.contents).toContain("# Soul\nIdentity.");
      expect(bundle.contents).toContain("Companion instruction file: ./MACHINE.md");
      expect(bundle.contents).toContain("# Machine\nControl surface.");
      expect(bundle.contents).not.toContain("./TOOLS.md");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
