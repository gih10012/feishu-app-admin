import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { probeBrowser } from "./browser.mjs";
import {
  checkDirectoryWritable,
  findBrowser,
  permissionModel,
  stateDirectory,
} from "./platform.mjs";

async function fileExists(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

function runtimeApiCheck() {
  const missing = ["fetch", "WebSocket", "FormData", "File"].filter(
    (name) => typeof globalThis[name] === "undefined",
  );
  return {
    name: "node_web_apis",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "available" : `missing: ${missing.join(", ")}`,
  };
}

export async function diagnoseEnvironment(options = {}) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node_version",
    ok: nodeMajor >= 22,
    detail: process.versions.node,
  });
  checks.push(runtimeApiCheck());
  checks.push({
    name: "operating_system",
    ok: new Set(["linux", "darwin", "win32"]).has(process.platform),
    detail: `${process.platform}/${process.arch}`,
  });

  let browser = null;
  try {
    browser = await findBrowser(options.chrome);
    checks.push({ name: "browser", ok: true, detail: browser });
  } catch (error) {
    checks.push({ name: "browser", ok: false, detail: error.message });
  }

  let browserProbe = null;
  if (options["browser-smoke"] && browser) {
    try {
      browserProbe = await probeBrowser({ chrome: browser });
      checks.push({ name: "browser_cdp", ok: true, detail: browserProbe.product });
    } catch (error) {
      checks.push({ name: "browser_cdp", ok: false, detail: error.message });
    }
  }

  const state = stateDirectory();
  try {
    await checkDirectoryWritable(state);
    checks.push({ name: "state_directory", ok: true, detail: state });
  } catch (error) {
    checks.push({ name: "state_directory", ok: false, detail: error.message });
  }

  const profile = options["profile-dir"] ? path.resolve(options["profile-dir"]) : null;
  if (profile) {
    checks.push({
      name: "stored_profile",
      ok: await fileExists(path.join(profile, "Default", "Cookies")),
      detail: profile,
      required: false,
    });
  }

  return {
    ok: checks.every((check) => check.ok || check.required === false),
    system: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      node: process.versions.node,
    },
    browser,
    browser_probe: browserProbe,
    state_directory: state,
    permission_model: permissionModel(),
    checks,
    note: options["browser-smoke"]
      ? "doctor launched one temporary headless browser; it did not log in or contact Feishu/Lark"
      : "doctor did not launch a browser, log in, or contact Feishu/Lark",
  };
}
