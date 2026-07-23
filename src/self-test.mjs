import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { shouldLaunchHeadless } from "./browser.mjs";
import { buildPlan, resolveTemplates, validateManifest } from "./manifest.mjs";
import { redact } from "./output.mjs";
import { browserCandidates, isPathInside, stateDirectory } from "./platform.mjs";

export async function selfTest() {
  const manifest = validateManifest({
    platform: "feishu",
    operations: [
      { id: "create", action: "app.create", name: "test" },
      {
        id: "events",
        action: "events.update",
        app_id: "${create.app_id}",
        app_events: ["im.message.receive_v1"],
      },
    ],
  });
  const plan = buildPlan(manifest);
  if (!plan.writes || plan.operations.length !== 2) throw new Error("plan test failed");
  const resolved = resolveTemplates(
    { app_id: "${create.app_id}", label: "app=${create.app_id}" },
    { create: { app_id: "cli_test" } },
  );
  if (resolved.app_id !== "cli_test" || resolved.label !== "app=cli_test") {
    throw new Error("template test failed");
  }
  const sanitized = redact({ app_secret: "secret", nested: { csrfToken: "csrf" } });
  if (sanitized.app_secret !== "<redacted>" || sanitized.nested.csrfToken !== "<redacted>") {
    throw new Error("redaction test failed");
  }
  let rejected = false;
  try {
    validateManifest({ operations: [{ action: "raw.request", path: "https://evil.invalid" }] });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("raw path safety test failed");

  const windowsState = stateDirectory({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
    home: "C:\\Users\\test",
  });
  if (windowsState !== "C:\\Users\\test\\AppData\\Local\\feishu-app-admin") {
    throw new Error("Windows state path test failed");
  }
  const windowsBrowsers = browserCandidates(undefined, {
    platform: "win32",
    env: { PROGRAMFILES: "C:\\Program Files", PATH: "" },
    home: "C:\\Users\\test",
  });
  if (!windowsBrowsers.includes("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")) {
    throw new Error("Windows browser candidate test failed");
  }
  if (!isPathInside("C:\\Work", "c:\\work\\icon.png", "win32")) {
    throw new Error("Windows path containment test failed");
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), "feishu-app-admin-self-test-"));
  try {
    await mkdir(path.join(profile, "Default"), { recursive: true });
    if (await shouldLaunchHeadless(profile, {})) throw new Error("empty profile test failed");
    await writeFile(path.join(profile, "Default", "Cookies"), "");
    if (!(await shouldLaunchHeadless(profile, {}))) throw new Error("stored profile test failed");
    if (await shouldLaunchHeadless(profile, { "show-browser": true })) {
      throw new Error("interactive override test failed");
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
  return {
    ok: true,
    tests: [
      "manifest",
      "plan",
      "templates",
      "redaction",
      "raw-path",
      "headless-reuse",
      "windows-state",
      "windows-browser",
      "cross-platform-paths",
    ],
  };
}
