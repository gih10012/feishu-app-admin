import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "feishu-app-admin.mjs");

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("prints version", () => {
  const result = run("--version");
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), VERSION);
});

test("prints a machine-readable action catalog", () => {
  const result = run("actions");
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.ok(output.actions.some(({ action }) => action === "apps.inspect"));
  assert.ok(output.actions.some(({ action }) => action === "external-sharing.get"));
});

test("validates the shipped examples without a browser", () => {
  for (const filename of ["inspect.json", "create-websocket-bot.json"]) {
    const result = run("validate", "--manifest", path.join("examples", filename));
    assert.equal(result.status, 0, result.stderr);
  }
});

test("doctor validates the native platform without launching a browser", () => {
  const state = mkdtempSync(path.join(os.tmpdir(), "feishu-app-admin-doctor-"));
  try {
    const result = spawnSync(
      process.execPath,
      [cli, "doctor", "--chrome", process.execPath],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, FEISHU_APP_ADMIN_HOME: state },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.browser, process.execPath);
    assert.match(output.note, /did not launch a browser/);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
