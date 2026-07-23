import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { PORTALS } from "./constants.mjs";
import { CliError } from "./errors.mjs";
import {
  ensurePrivateDirectory,
  findBrowser,
  stateDirectory,
  terminateProcessTree,
} from "./platform.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timed out")), 10000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP connection failed"));
      });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        for (const handler of this.handlers.get(message.method) || []) {
          handler(message.params || {});
        }
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    });
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method)?.delete(handler);
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function waitForDebugPort(profileDir, child) {
  const activePort = path.join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) {
      throw new CliError(`browser exited before login (code ${child.exitCode})`, { exitCode: 4 });
    }
    try {
      const [port] = (await readFile(activePort, "utf8")).trim().split("\n");
      if (/^\d+$/.test(port)) return Number(port);
    } catch {
      // Chrome creates this file after remote debugging starts.
    }
    await sleep(100);
  }
  throw new CliError("browser remote-debugging endpoint did not start", { exitCode: 4 });
}

async function findPageTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Retry while Chrome initializes its first page.
    }
    await sleep(100);
  }
  throw new CliError("could not find the browser page target", { exitCode: 4 });
}

function platformLoginUrl(platform) {
  const cfg = PORTALS[platform];
  const redirect = platform === "lark" ? cfg.apiOpen : cfg.open;
  return `${cfg.accounts}/accounts/page/login?app_id=7&no_trap=1&redirect_uri=${encodeURIComponent(`${redirect}/`)}`;
}

function cookieDomainMatches(cookieDomain, hostname) {
  const normalized = cookieDomain.replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function hasPortalSession(cookies, platform) {
  const hosts = [new URL(PORTALS[platform].open).hostname, new URL(PORTALS[platform].apiOpen).hostname];
  return cookies.some(
    (cookie) => cookie.name === "session" && hosts.some((host) => cookieDomainMatches(cookie.domain, host)),
  );
}

function selectCsrfToken(cookies) {
  for (const name of ["lark_oapi_csrf_token", "swp_csrf_token"]) {
    const found = cookies.find((cookie) => cookie.name === name && cookie.value);
    if (found) return found.value;
  }
  return cookies.find((cookie) => /csrf/i.test(cookie.name) && cookie.value)?.value || "";
}

async function hasStoredBrowserState(profileDir) {
  try {
    return (await stat(path.join(profileDir, "Default", "Cookies"))).isFile();
  } catch {
    return false;
  }
}

export async function shouldLaunchHeadless(profileDir, options = {}) {
  return Boolean(profileDir && !options["show-browser"] && (await hasStoredBrowserState(profileDir)));
}

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === wanted) return String(value);
  }
  return "";
}

async function removeTemporaryProfile(profileDir) {
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export async function launchPortalSession(platform, options = {}) {
  const chrome = await findBrowser(options.chrome);
  const requestedProfile = options["profile-dir"]
    ? path.resolve(options["profile-dir"])
    : options["reuse-session"]
      ? path.join(stateDirectory(), "chrome-profile")
      : null;
  const profileDir = requestedProfile || (await mkdtemp(path.join(os.tmpdir(), "feishu-app-admin-")));
  const useHeadless = await shouldLaunchHeadless(requestedProfile, options);
  await ensurePrivateDirectory(profileDir);
  await rm(path.join(profileDir, "DevToolsActivePort"), { force: true });

  const browserArgs = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    platformLoginUrl(platform),
  ];
  if (useHeadless) browserArgs.unshift("--headless=new", "--window-size=1280,800");

  const child = spawn(chrome, browserArgs, { stdio: "ignore", windowsHide: true });
  let client;
  try {
    const port = await waitForDebugPort(profileDir, child);
    const target = await findPageTarget(port);
    client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.call("Network.enable");
    await client.call("Page.enable");

    const requestMeta = new Map();
    const earlyExtraHeaders = new Map();
    let capturedCsrfToken = "";
    let capturedCookieHeader = "";
    const captureHeaders = (requestId, headers) => {
      const meta = requestMeta.get(requestId);
      if (!meta?.isAppList) {
        earlyExtraHeaders.set(requestId, headers);
        return;
      }
      capturedCsrfToken ||= headerValue(headers, "x-csrf-token");
      capturedCookieHeader ||= headerValue(headers, "cookie");
    };
    client.on("Network.requestWillBeSent", ({ requestId, request = {} }) => {
      const isAppList =
        request.method === "POST" && String(request.url || "").includes("/developers/v1/app/list");
      requestMeta.set(requestId, { isAppList });
      if (!isAppList) return;
      capturedCsrfToken ||= headerValue(request.headers, "x-csrf-token");
      capturedCookieHeader ||= headerValue(request.headers, "cookie");
      if (earlyExtraHeaders.has(requestId)) {
        captureHeaders(requestId, earlyExtraHeaders.get(requestId));
        earlyExtraHeaders.delete(requestId);
      }
    });
    client.on("Network.requestWillBeSentExtraInfo", ({ requestId, headers = {} }) => {
      captureHeaders(requestId, headers);
    });

    process.stderr.write(
      useHeadless
        ? "[feishu-app-admin] Reusing the stored browser session headlessly.\n"
        : "[feishu-app-admin] Browser opened once for interactive login.\n",
    );
    const configuredTimeoutMs = Number(options["login-timeout"] || 300) * 1000;
    const timeoutMs = useHeadless ? Math.min(configuredTimeoutMs, 45000) : configuredTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let navigated = false;
    while (Date.now() < deadline) {
      const { cookies = [] } = await client.call("Network.getAllCookies");
      if (hasPortalSession(cookies, platform)) {
        if (!navigated) {
          await client.call("Page.navigate", { url: `${PORTALS[platform].open}/app` });
          navigated = true;
          const captureDeadline = Date.now() + 5000;
          while (Date.now() < captureDeadline && (!capturedCsrfToken || !capturedCookieHeader)) {
            await sleep(250);
          }
          continue;
        }
        const refreshed = await client.call("Network.getAllCookies");
        const csrfToken = capturedCsrfToken || selectCsrfToken(refreshed.cookies || []);
        if (csrfToken) {
          return {
            credentials: {
              cookies: refreshed.cookies || [],
              csrfToken,
              cookieHeader: capturedCookieHeader,
            },
            close: async () => {
              try {
                await client.call("Browser.close");
              } catch {
                // Fall through to platform-specific process-tree cleanup.
              }
              client.close();
              await terminateProcessTree(child);
              if (!requestedProfile) await removeTemporaryProfile(profileDir);
            },
          };
        }
      }
      await sleep(500);
    }
    throw new CliError(
      useHeadless
        ? "stored login is unavailable or expired; rerun once with --show-browser to re-authenticate"
        : "interactive login timed out or the portal CSRF cookie was not available",
      { exitCode: 3 },
    );
  } catch (error) {
    client?.close();
    await terminateProcessTree(child);
    if (!requestedProfile) await removeTemporaryProfile(profileDir);
    throw error;
  }
}
