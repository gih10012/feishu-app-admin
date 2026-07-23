import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyWindowsAcl,
  browserCandidates,
  findBrowser,
  isPathInside,
  stateDirectory,
  terminateProcessTree,
  writePrivateFile,
} from "../src/platform.mjs";

test("uses native state directory conventions", () => {
  assert.equal(
    stateDirectory({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      home: "C:\\Users\\me",
    }),
    "C:\\Users\\me\\AppData\\Local\\feishu-app-admin",
  );
  assert.equal(
    stateDirectory({ platform: "darwin", env: {}, home: "/Users/me" }),
    "/Users/me/Library/Application Support/feishu-app-admin",
  );
  assert.equal(
    stateDirectory({ platform: "linux", env: {}, home: "/home/me" }),
    "/home/me/.local/state/feishu-app-admin",
  );
});

test("honors a platform-specific state override", () => {
  assert.equal(
    stateDirectory({
      platform: "win32",
      env: { FEISHU_APP_ADMIN_HOME: "D:\\FeishuState" },
      home: "C:\\Users\\me",
    }),
    "D:\\FeishuState",
  );
});

test("builds browser candidates for Windows and macOS", () => {
  const windows = browserCandidates(undefined, {
    platform: "win32",
    env: {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      PATH: "C:\\Tools",
    },
    home: "C:\\Users\\me",
  });
  assert.ok(windows.includes("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"));
  assert.ok(windows.includes("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"));
  assert.ok(windows.includes("C:\\Tools\\chrome.exe"));

  const mac = browserCandidates(undefined, {
    platform: "darwin",
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin" },
    home: "/Users/me",
  });
  assert.ok(mac.includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  assert.ok(mac.includes("/Applications/Chromium.app/Contents/MacOS/Chromium"));
  assert.ok(mac.includes("/opt/homebrew/bin/google-chrome"));
});

test("findBrowser respects explicit paths and native executable semantics", async () => {
  const checked = [];
  const selected = await findBrowser("C:\\Portable\\chrome.exe", {
    platform: "win32",
    env: { PATH: "" },
    home: "C:\\Users\\me",
    accessFile: async (filename, mode) => {
      checked.push({ filename, mode });
      if (filename !== "C:\\Portable\\chrome.exe") throw new Error("missing");
    },
  });
  assert.equal(selected, "C:\\Portable\\chrome.exe");
  assert.equal(checked.length, 1);
});

test("path containment handles Windows case and rejects traversal", () => {
  assert.equal(isPathInside("C:\\Work", "c:\\work\\icons\\app.png", "win32"), true);
  assert.equal(isPathInside("C:\\Work", "C:\\Other\\app.png", "win32"), false);
  assert.equal(isPathInside("/work", "/work/icons/app.png", "linux"), true);
  assert.equal(isPathInside("/work", "/other/app.png", "linux"), false);
});

test("Windows ACLs grant protected principals and remove broad groups", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (command === "whoami") return { code: 0, stdout: '"host\\me","S-1-5-21-123-456-789-1001"\r\n', stderr: "" };
    return { code: 0, stdout: "processed", stderr: "" };
  };
  await applyWindowsAcl("C:\\State", { directory: true, runner });
  assert.equal(calls[0].command, "whoami");
  assert.equal(calls[1].command, "icacls");
  assert.ok(calls[1].args.includes("/inheritance:r"));
  assert.ok(calls[1].args.includes("*S-1-5-21-123-456-789-1001:(OI)(CI)F"));
  assert.ok(calls[1].args.includes("*S-1-5-18:(OI)(CI)F"));
  assert.ok(calls[1].args.includes("*S-1-1-0"));
  assert.ok(calls[1].args.includes("*S-1-5-32-545"));
});

test("Windows process cleanup terminates the complete browser tree", async () => {
  const calls = [];
  await terminateProcessTree(
    { pid: 4242, exitCode: null },
    {
      platform: "win32",
      runner: async (command, args) => {
        calls.push({ command, args });
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  );
  assert.deepEqual(calls, [
    { command: "taskkill", args: ["/pid", "4242", "/t", "/f"] },
  ]);
});

test(
  "private files use POSIX 0700/0600 modes",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "feishu-app-admin-permissions-"));
    const filename = path.join(root, "private", "app.json");
    try {
      await writePrivateFile(filename, "secret");
      assert.equal((await stat(path.dirname(filename))).mode & 0o777, 0o700);
      assert.equal((await stat(filename)).mode & 0o777, 0o600);
      assert.equal(await readFile(filename, "utf8"), "secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
