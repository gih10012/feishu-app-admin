import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const prefix = mkdtempSync(path.join(os.tmpdir(), "feishu-app-admin-install-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  return result;
}

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is unavailable; run through npm run smoke-install");
  run(process.execPath, [
    npmCli,
    "install",
    "--global",
    ".",
    "--prefix",
    prefix,
    "--ignore-scripts",
  ]);

  const executable =
    process.platform === "win32"
      ? path.join(prefix, "feishu-app-admin.cmd")
      : path.join(prefix, "bin", "feishu-app-admin");
  const version = run(executable, ["--version"], {
    shell: process.platform === "win32",
  }).stdout.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`unexpected CLI version: ${version}`);
  process.stdout.write(`installed CLI smoke test passed (${version})\n`);
} finally {
  rmSync(prefix, { recursive: true, force: true });
}
