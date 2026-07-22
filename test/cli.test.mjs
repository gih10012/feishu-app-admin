import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "feishu-app-admin.mjs");

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("prints version", () => {
  const result = run("--version");
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "0.3.0");
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
