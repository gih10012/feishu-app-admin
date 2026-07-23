import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { CliError } from "./errors.mjs";

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function envValue(env, name) {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

export function stateDirectory({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const paths = pathApi(platform);
  const override = envValue(env, "FEISHU_APP_ADMIN_HOME");
  if (override) return paths.resolve(override);

  if (platform === "win32") {
    const localAppData = envValue(env, "LOCALAPPDATA") || paths.join(home, "AppData", "Local");
    return paths.join(localAppData, "feishu-app-admin");
  }
  if (platform === "darwin") {
    return paths.join(home, "Library", "Application Support", "feishu-app-admin");
  }
  const xdgStateHome = envValue(env, "XDG_STATE_HOME") || paths.join(home, ".local", "state");
  return paths.join(xdgStateHome, "feishu-app-admin");
}

function pathCandidates(env, names, platform) {
  const paths = pathApi(platform);
  const delimiter = platform === "win32" ? ";" : ":";
  const entries = String(envValue(env, "PATH") || "")
    .split(delimiter)
    .filter(Boolean);
  return entries.flatMap((entry) => names.map((name) => paths.join(entry, name)));
}

export function browserCandidates(
  explicit,
  { platform = process.platform, env = process.env, home = os.homedir() } = {},
) {
  const paths = pathApi(platform);
  const candidates = [explicit, envValue(env, "CHROME_PATH")];

  if (platform === "win32") {
    const roots = [
      envValue(env, "PROGRAMFILES"),
      envValue(env, "PROGRAMFILES(X86)"),
      envValue(env, "LOCALAPPDATA"),
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        paths.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        paths.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        paths.join(root, "Chromium", "Application", "chrome.exe"),
      );
    }
    candidates.push(
      ...pathCandidates(env, ["chrome.exe", "msedge.exe", "chromium.exe"], platform),
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      paths.join(home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      ...pathCandidates(env, ["google-chrome", "chromium", "microsoft-edge"], platform),
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/microsoft-edge-stable",
      "/usr/bin/microsoft-edge",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/opt/google/chrome/chrome",
      ...pathCandidates(
        env,
        [
          "google-chrome-stable",
          "google-chrome",
          "microsoft-edge-stable",
          "microsoft-edge",
          "chromium",
          "chromium-browser",
        ],
        platform,
      ),
    );
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    const key = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function isExecutable(filename, platform, accessFile) {
  try {
    await accessFile(filename, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findBrowser(
  explicit,
  {
    platform = process.platform,
    env = process.env,
    home = os.homedir(),
    accessFile = access,
  } = {},
) {
  for (const candidate of browserCandidates(explicit, { platform, env, home })) {
    if (await isExecutable(candidate, platform, accessFile)) return candidate;
  }
  throw new CliError("Chrome or Edge was not found; pass --chrome or set CHROME_PATH", {
    exitCode: 4,
  });
}

export function isPathInside(root, candidate, platform = process.platform) {
  const paths = pathApi(platform);
  let normalizedRoot = paths.resolve(root);
  let normalizedCandidate = paths.resolve(candidate);
  if (platform === "win32") {
    normalizedRoot = normalizedRoot.toLowerCase();
    normalizedCandidate = normalizedCandidate.toLowerCase();
  }
  const relative = paths.relative(normalizedRoot, normalizedCandidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative))
  );
}

export function runCommand(command, args, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function applyWindowsAcl(target, { directory = false, runner = runCommand } = {}) {
  const identity = await runner("whoami", ["/user", "/fo", "csv", "/nh"]);
  const sid = identity.stdout.match(/S-\d(?:-\d+)+/)?.[0];
  if (identity.code !== 0 || !sid) {
    throw new CliError("could not determine the current Windows user SID", { exitCode: 6 });
  }

  const rights = directory ? "(OI)(CI)F" : "F";
  const acl = await runner("icacls", [
    target,
    "/inheritance:r",
    "/grant:r",
    `*${sid}:${rights}`,
    "/grant:r",
    `*S-1-5-18:${rights}`,
    "/grant:r",
    `*S-1-5-32-544:${rights}`,
    "/remove:g",
    "*S-1-1-0",
    "*S-1-5-11",
    "*S-1-5-32-545",
  ]);
  if (acl.code !== 0) {
    throw new CliError(`could not apply a private Windows ACL to ${target}`, {
      exitCode: 6,
      details: { stderr: acl.stderr.trim() || undefined },
    });
  }
}

export async function ensurePrivateDirectory(
  directory,
  { platform = process.platform, aclRunner = runCommand } = {},
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (platform === "win32") {
    await applyWindowsAcl(directory, { directory: true, runner: aclRunner });
  } else {
    await chmod(directory, 0o700);
  }
  return directory;
}

export async function writePrivateFile(
  filename,
  content,
  { platform = process.platform, aclRunner = runCommand } = {},
) {
  await ensurePrivateDirectory(path.dirname(filename), { platform, aclRunner });
  await writeFile(filename, content, { mode: 0o600 });
  if (platform === "win32") {
    await applyWindowsAcl(filename, { runner: aclRunner });
  } else {
    await chmod(filename, 0o600);
  }
  return filename;
}

export function permissionModel(platform = process.platform) {
  return platform === "win32" ? "windows-acl" : "posix-0700-0600";
}

export async function checkDirectoryWritable(directory, options = {}) {
  await ensurePrivateDirectory(directory, options);
  const probe = path.join(directory, `.doctor-${randomUUID()}`);
  try {
    await writeFile(probe, "ok", { flag: "wx", mode: 0o600 });
  } finally {
    await rm(probe, { force: true });
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export async function terminateProcessTree(
  child,
  { platform = process.platform, runner = runCommand } = {},
) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (platform === "win32") {
    await runner("taskkill", ["/pid", String(child.pid), "/t", "/f"]).catch(() => undefined);
    return;
  }
  child.kill("SIGTERM");
  if (!(await waitForExit(child, 2000)) && child.exitCode === null) child.kill("SIGKILL");
}
