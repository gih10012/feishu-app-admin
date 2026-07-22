#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const VERSION = "0.3.0";
const DEFAULT_ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==";

export function stateDirectory() {
  if (process.env.FEISHU_APP_ADMIN_HOME) {
    return path.resolve(process.env.FEISHU_APP_ADMIN_HOME);
  }
  const stateHome = process.env.XDG_STATE_HOME
    ? path.resolve(process.env.XDG_STATE_HOME)
    : path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "feishu-app-admin");
}

const PLATFORM = {
  feishu: {
    open: "https://open.feishu.cn",
    apiOpen: "https://open.feishu.cn",
    accounts: "https://accounts.feishu.cn",
    passport: "https://passport.feishu.cn",
  },
  lark: {
    open: "https://open.larkoffice.com",
    apiOpen: "https://open.larksuite.com",
    accounts: "https://accounts.larksuite.com",
    passport: "https://passport.larksuite.com",
  },
};

const ACTION_RISK = {
  "app.list": "read",
  "app.inspect": "read",
  "apps.inspect": "read",
  "app.create": "write",
  "secret.get": "sensitive-read",
  "bot.set": "write",
  "bot.get": "read",
  "scope.catalog": "read",
  "scopes.update": "write",
  "event.get": "read",
  "events.update": "write",
  "event.mode": "write",
  "callback.get": "read",
  "webhook.set": "write",
  "external-sharing.get": "read",
  "version.create": "write",
  "version.publish": "high-risk-write",
  "raw.request": "high-risk-write",
};

const EVENT_MODES = {
  webhook: 1,
  "cloud-function": 2,
  "apaas-cloud-function": 3,
  websocket: 4,
};

const INSPECTION_SECTIONS = ["event", "callback", "bot", "external-sharing"];

const ACTION_DESCRIPTIONS = {
  "app.list": "List applications available to the current developer account.",
  "app.inspect": "Read event, callback, bot, and external-sharing settings for one app.",
  "apps.inspect": "List apps and read selected settings for every app.",
  "app.create": "Create a custom application.",
  "secret.get": "Fetch an App Secret and store it in a protected local file.",
  "bot.get": "Read bot configuration.",
  "bot.set": "Enable or disable bot capability.",
  "scope.catalog": "Read the portal scope catalog and current scope state.",
  "scopes.update": "Add or remove exact tenant and user scopes.",
  "event.get": "Read event subscription and delivery configuration.",
  "events.update": "Add or remove event subscriptions.",
  "event.mode": "Switch event delivery mode.",
  "callback.get": "Read callback configuration.",
  "webhook.set": "Verify and save an HTTP event callback.",
  "external-sharing.get": "Read external availability and sharing configuration.",
  "version.create": "Create an application version.",
  "version.publish": "Submit an existing application version.",
  "raw.request": "Fallback for an unsupported developer-console endpoint.",
};

export function actionCatalog() {
  return Object.entries(ACTION_RISK).map(([action, risk]) => ({
    action,
    risk,
    description: ACTION_DESCRIPTIONS[action],
  }));
}

class CliError extends Error {
  constructor(message, { exitCode = 2, details = undefined } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSensitiveKey(key) {
  return /(?:secret|cookie|csrf|access[_-]?token|refresh[_-]?token|verification[_-]?token|encrypt[_-]?key)/i.test(
    key,
  );
}

export function redact(value, key = "") {
  if (isSensitiveKey(key) && value !== undefined && value !== null && value !== "") {
    return "<redacted>";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey),
      ]),
    );
  }
  return value;
}

function emitJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(redact(value), null, 2)}\n`);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const options = {};
  const positional = [];
  const aliases = { "-f": "manifest", "-h": "help" };
  const booleans = new Set([
    "help",
    "version",
    "yes",
    "inspect",
    "event-details",
    "full",
    "reuse-session",
    "no-store-secrets",
    "show-browser",
  ]);

  while (args.length > 0) {
    const raw = args.shift();
    if (!raw.startsWith("-")) {
      positional.push(raw);
      continue;
    }
    const normalized = aliases[raw] || raw.replace(/^--/, "");
    const [name, inlineValue] = normalized.split("=", 2);
    if (booleans.has(name)) {
      options[name] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }
    const value = inlineValue === undefined ? args.shift() : inlineValue;
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`missing value for --${name}`);
    }
    options[name] = value;
  }
  return { command, options, positional };
}

function usage() {
  return `feishu-app-admin ${VERSION}

Usage:
  feishu-app-admin validate --manifest <file.json>
  feishu-app-admin plan     --manifest <file.json>
  feishu-app-admin apply    --manifest <file.json> [--yes]
  feishu-app-admin apps     [--platform feishu|lark] [--inspect] [--full]
  feishu-app-admin inspect  --app-id <id> [--sections <names>] [--event-details]
  feishu-app-admin actions
  feishu-app-admin self-test

Browser options:
  --chrome <path>          Chrome/Edge executable
  --login-timeout <sec>    Login timeout, default 300
  --reuse-session          Reuse a dedicated browser profile under CLI state
  --profile-dir <path>     Reuse an explicit dedicated browser profile
  --show-browser           Force one interactive login/re-authentication window

Execution options:
  --yes                    Confirm all writes already authorized by the user
  --secrets-dir <path>     Secret store directory (mode 0700)
  --no-store-secrets       Do not fetch/store app secrets after app.create

Inspection sections:
  event, callback, bot, external-sharing
  --event-details          Include the portal event catalog in inspection output
  --full                   Include complete app records with apps --inspect
`;
}

async function loadManifest(filename) {
  if (!filename) {
    throw new CliError("--manifest is required");
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.resolve(filename), "utf8"));
  } catch (error) {
    throw new CliError(`cannot read manifest: ${error.message}`);
  }
  return validateManifest(parsed);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliError(`${label} must be a non-empty string`);
  }
}

function normalizeEventMode(value, label) {
  if (Number.isInteger(value)) return value;
  if (typeof value === "string" && EVENT_MODES[value] !== undefined) {
    return EVENT_MODES[value];
  }
  throw new CliError(
    `${label} must be an integer or one of ${Object.keys(EVENT_MODES).join(", ")}`,
  );
}

function normalizeInspectionSections(value, label = "sections") {
  if (value === undefined) return [...INSPECTION_SECTIONS];
  if (!Array.isArray(value) || value.some((section) => typeof section !== "string")) {
    throw new CliError(`${label} must be an array of strings`);
  }
  const sections = [...new Set(value.map((section) => section.replaceAll("_", "-")))];
  const unknown = sections.filter((section) => !INSPECTION_SECTIONS.includes(section));
  if (unknown.length > 0) {
    throw new CliError(`${label} contains unsupported sections: ${unknown.join(", ")}`);
  }
  return sections;
}

function validateRawPath(rawPath) {
  requireString(rawPath, "raw.request.path");
  if (/^https?:\/\//i.test(rawPath) || !rawPath.startsWith("/") || rawPath.includes("..")) {
    throw new CliError(
      "raw.request.path must be a relative developer API path beginning with / and without ..",
    );
  }
}

function validateWebhookUrl(url, allowInsecure, label = "webhook URL") {
  requireString(url, label);
  let callback;
  try {
    callback = new URL(url);
  } catch {
    throw new CliError(`${label} must be an absolute URL`);
  }
  if (callback.protocol !== "https:" && allowInsecure !== true) {
    throw new CliError(`${label} must use HTTPS unless allow_insecure is true`);
  }
}

export function validateManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CliError("manifest must be a JSON object");
  }
  const manifest = structuredClone(input);
  manifest.platform ||= "feishu";
  if (!PLATFORM[manifest.platform]) {
    throw new CliError("manifest.platform must be feishu or lark");
  }
  if (manifest.app_id !== undefined) {
    requireString(manifest.app_id, "manifest.app_id");
  }
  if (!Array.isArray(manifest.operations) || manifest.operations.length === 0) {
    throw new CliError("manifest.operations must be a non-empty array");
  }
  const seen = new Set();
  manifest.operations = manifest.operations.map((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new CliError(`operations[${index}] must be an object`);
    }
    const op = structuredClone(operation);
    requireString(op.action, `operations[${index}].action`);
    if (!ACTION_RISK[op.action]) {
      throw new CliError(`unsupported action ${op.action}`);
    }
    op.id ||= `op_${index + 1}`;
    requireString(op.id, `operations[${index}].id`);
    if (seen.has(op.id)) {
      throw new CliError(`duplicate operation id ${op.id}`);
    }
    seen.add(op.id);

    if (op.action === "app.create") {
      requireString(op.name, `${op.id}.name`);
    }
    if (op.action === "bot.set" && typeof op.enabled !== "boolean") {
      throw new CliError(`${op.id}.enabled must be boolean`);
    }
    if (op.action === "scopes.update") {
      if (!new Set(["add", "remove"]).has(op.operation || "add")) {
        throw new CliError(`${op.id}.operation must be add or remove`);
      }
    }
    if (op.action === "events.update") {
      if (!new Set(["add", "remove"]).has(op.operation || "add")) {
        throw new CliError(`${op.id}.operation must be add or remove`);
      }
    }
    if (op.action === "app.inspect" || op.action === "apps.inspect") {
      op.sections = normalizeInspectionSections(op.sections, `${op.id}.sections`);
    }
    if (op.action === "event.mode") {
      op.event_mode = normalizeEventMode(op.event_mode, `${op.id}.event_mode`);
    }
    if (op.action === "events.update" && op.event_mode !== undefined) {
      op.event_mode = normalizeEventMode(op.event_mode, `${op.id}.event_mode`);
    }
    if (op.action === "webhook.set") {
      requireString(op.url, `${op.id}.url`);
      if (!op.url.includes("${")) validateWebhookUrl(op.url, op.allow_insecure, `${op.id}.url`);
    }
    if (op.action === "version.create" && !op.payload) {
      requireString(op.version, `${op.id}.version`);
    }
    if (op.action === "version.publish") {
      requireString(op.version_id, `${op.id}.version_id`);
    }
    if (op.action === "raw.request") {
      validateRawPath(op.path);
      op.method = String(op.method || "POST").toUpperCase();
      if (!new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]).has(op.method)) {
        throw new CliError(`${op.id}.method is unsupported`);
      }
    }
    return op;
  });
  manifest.vars ||= {};
  if (!manifest.vars || typeof manifest.vars !== "object" || Array.isArray(manifest.vars)) {
    throw new CliError("manifest.vars must be an object");
  }
  return manifest;
}

function operationTarget(op, manifest) {
  if (op.action === "app.create") return op.name;
  return op.app_id || manifest.app_id || "${app_id}";
}

function operationRisk(op) {
  if (op.action === "version.create" && op.publish === true) return "high-risk-write";
  if (op.action === "scopes.update" && op.operation === "remove") return "high-risk-write";
  if (op.action === "events.update" && op.operation === "remove") return "high-risk-write";
  return ACTION_RISK[op.action];
}

export function buildPlan(manifest) {
  const operations = manifest.operations.map((op) => ({
    id: op.id,
    action: op.action,
    risk: operationRisk(op),
    target: operationTarget(op, manifest),
  }));
  return {
    ok: true,
    platform: manifest.platform,
    app_id: manifest.app_id || null,
    writes: operations.some((op) => op.risk !== "read"),
    high_risk_writes: operations
      .filter((op) => op.risk === "high-risk-write")
      .map((op) => op.id),
    operations,
  };
}

function getByPath(context, expression) {
  return expression.split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, context);
}

export function resolveTemplates(value, context) {
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveTemplates(child, context)]),
    );
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\$\{([^}]+)\}$/);
  if (exact) {
    const resolved = getByPath(context, exact[1]);
    if (resolved === undefined) {
      throw new CliError(`unresolved template ${value}`);
    }
    return structuredClone(resolved);
  }

  return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
    const resolved = getByPath(context, expression);
    if (resolved === undefined) {
      throw new CliError(`unresolved template ${match}`);
    }
    return String(resolved);
  });
}

async function executable(filename) {
  try {
    await access(filename, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  throw new CliError("Chrome or Edge was not found; pass --chrome or set CHROME_PATH", {
    exitCode: 4,
  });
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
      for (const { reject } of this.pending.values()) {
        reject(new Error("CDP connection closed"));
      }
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
      // Chrome creates the file after remote debugging starts.
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
  const cfg = PLATFORM[platform];
  const redirect = platform === "lark" ? cfg.apiOpen : cfg.open;
  return `${cfg.accounts}/accounts/page/login?app_id=7&no_trap=1&redirect_uri=${encodeURIComponent(`${redirect}/`)}`;
}

function cookieDomainMatches(cookieDomain, hostname) {
  const normalized = cookieDomain.replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function hasPortalSession(cookies, platform) {
  const hosts = [new URL(PLATFORM[platform].open).hostname, new URL(PLATFORM[platform].apiOpen).hostname];
  return cookies.some(
    (cookie) => cookie.name === "session" && hosts.some((host) => cookieDomainMatches(cookie.domain, host)),
  );
}

function selectCsrfToken(cookies) {
  const preferred = ["lark_oapi_csrf_token", "swp_csrf_token"];
  for (const name of preferred) {
    const found = cookies.find((cookie) => cookie.name === name && cookie.value);
    if (found) return found.value;
  }
  return cookies.find((cookie) => /csrf/i.test(cookie.name) && cookie.value)?.value || "";
}

async function hasStoredBrowserState(profileDir) {
  try {
    const info = await stat(path.join(profileDir, "Default", "Cookies"));
    return info.isFile();
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

async function launchPortalSession(platform, options) {
  const chrome = await findChrome(options.chrome);
  const requestedProfile = options["profile-dir"]
    ? path.resolve(options["profile-dir"])
    : options["reuse-session"]
      ? path.join(stateDirectory(), "chrome-profile")
      : null;
  const profileDir = requestedProfile || (await mkdtemp(path.join(os.tmpdir(), "feishu-app-admin-")));
  const useHeadless = await shouldLaunchHeadless(requestedProfile, options);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  await chmod(profileDir, 0o700);
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

  const child = spawn(
    chrome,
    browserArgs,
    { stdio: "ignore" },
  );

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
          await client.call("Page.navigate", { url: `${PLATFORM[platform].open}/app` });
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
                child.kill("SIGTERM");
              }
              client.close();
              if (!requestedProfile) await rm(profileDir, { recursive: true, force: true });
            },
          };
        }
      }
      await sleep(500);
    }
    throw new CliError(useHeadless
      ? "stored login is unavailable or expired; rerun once with --show-browser to re-authenticate"
      : "interactive login timed out or the portal CSRF cookie was not available", {
      exitCode: 3,
    });
  } catch (error) {
    client?.close();
    child.kill("SIGTERM");
    if (!requestedProfile) await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}

function cookieHeader(credentials) {
  if (credentials.cookieHeader) return credentials.cookieHeader;
  const sorted = [...credentials.cookies].sort(
    (a, b) => (b.path || "").length - (a.path || "").length,
  );
  const pairs = sorted.map((cookie) => `${cookie.name}=${cookie.value}`);
  if (!sorted.some((cookie) => cookie.name === "lark_oapi_csrf_token") && credentials.csrfToken) {
    pairs.push(`lark_oapi_csrf_token=${credentials.csrfToken}`);
  }
  return pairs.join("; ");
}

function developerPath(rawPath) {
  validateRawPath(rawPath);
  return rawPath.startsWith("/developers/v1/")
    ? rawPath.slice("/developers/v1".length)
    : rawPath;
}

class PortalClient {
  constructor(platform, credentials) {
    this.platform = platform;
    this.cfg = PLATFORM[platform];
    this.credentials = credentials;
  }

  headers({ json = true } = {}) {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      Cookie: cookieHeader(this.credentials),
      "x-csrf-token": this.credentials.csrfToken,
      "x-timezone-offset": String(new Date().getTimezoneOffset()),
      Origin: this.cfg.open,
      Referer: `${this.cfg.open}/app`,
      "User-Agent": "Mozilla/5.0 feishu-app-admin/0.1",
    };
  }

  async request(rawPath, { method = "POST", body = undefined, query = undefined, allowNonzero = false } = {}) {
    const url = new URL(`${this.cfg.apiOpen}/developers/v1${developerPath(rawPath)}`);
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      method,
      headers: this.headers({ json: body !== undefined }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { text: text.slice(0, 1000) };
    }
    if (!response.ok) {
      throw new CliError(`portal request failed: HTTP ${response.status} ${rawPath}`, {
        exitCode: 5,
        details: redact(payload),
      });
    }
    if (!allowNonzero && typeof payload.code === "number" && payload.code !== 0) {
      throw new CliError(`portal API rejected ${rawPath}: code=${payload.code}`, {
        exitCode: 5,
        details: redact(payload),
      });
    }
    return payload;
  }

  post(rawPath, body = {}, options = {}) {
    return this.request(rawPath, { ...options, method: "POST", body });
  }

  async uploadIcon(iconPath) {
    let bytes;
    if (iconPath) {
      const resolved = path.resolve(iconPath);
      const cwd = `${path.resolve(process.cwd())}${path.sep}`;
      if (resolved !== path.resolve(process.cwd()) && !resolved.startsWith(cwd)) {
        throw new CliError("icon_path must stay inside the current working directory");
      }
      const info = await stat(resolved);
      if (info.size > 5 * 1024 * 1024) throw new CliError("icon_path exceeds 5 MiB");
      bytes = await readFile(resolved);
    } else {
      bytes = Buffer.from(DEFAULT_ICON_BASE64, "base64");
    }
    const form = new FormData();
    form.append("file", new File([bytes], "icon.png", { type: "image/png" }));
    form.append("uploadType", "4");
    form.append("isIsv", "false");
    form.append("scale", JSON.stringify({ width: 240, height: 240 }));
    const response = await fetch(`${this.cfg.apiOpen}/developers/v1/app/upload/image`, {
      method: "POST",
      headers: this.headers({ json: false }),
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0 || !payload.data?.url) {
      throw new CliError("portal icon upload failed", { exitCode: 5, details: redact(payload) });
    }
    return payload.data.url;
  }

  async creatorId() {
    const url = `${this.cfg.passport}/accounts/web/user?app_id=7&support_anonymous=0&_t=${Date.now()}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader(this.credentials),
        "X-Api-Version": "1.0.28",
        "X-App-Id": "7",
        "X-Device-Info": "platform=websdk",
        Origin: this.cfg.open,
        Referer: `${this.cfg.open}/`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    const userId = payload.data?.user?.id;
    if (!response.ok || payload.code !== 0 || !userId) {
      throw new CliError("could not resolve the current developer user id", {
        exitCode: 5,
        details: redact(payload),
      });
    }
    return userId;
  }
}

function appIdFor(op, context) {
  const appId = op.app_id || context.app_id;
  requireString(appId, `${op.id}.app_id`);
  return appId;
}

function appIdFromRecord(app) {
  for (const key of ["appId", "appID", "AppID", "ClientID", "clientId", "client_id", "id"]) {
    if (typeof app?.[key] === "string" && app[key]) return app[key];
  }
  return "";
}

async function listApps(client, op) {
  const count = Number(op.count || 50);
  let cursor = Number(op.cursor || 0);
  const apps = [];
  let totalCount = 0;
  for (let page = 0; page < Number(op.max_pages || 200); page += 1) {
    const response = await client.post("/app/list", {
      Count: count,
      Cursor: cursor,
      QueryFilter: { filterAppSceneTypeList: op.scene_types || [0] },
      OrderBy: Number(op.order_by || 0),
    });
    const batch = response.data?.apps || [];
    totalCount = response.data?.totalCount || batch.length;
    apps.push(...batch);
    if (op.all === false || batch.length === 0 || apps.length >= totalCount) break;
    cursor += count;
  }
  return { apps, total_count: totalCount };
}

const SECTION_REQUEST = {
  event: (appId, options) => ({
    path: `/event/${encodeURIComponent(appId)}`,
    body: { needEventDetail: options.eventDetails === true },
  }),
  callback: (appId) => ({ path: `/callback/${encodeURIComponent(appId)}`, body: {} }),
  bot: (appId) => ({ path: `/robot/${encodeURIComponent(appId)}`, body: {} }),
  "external-sharing": (appId) => ({ path: `/b2c_share/${encodeURIComponent(appId)}`, body: {} }),
};

function summarizePortalSection(section, data, options) {
  if (section === "event" && options.eventDetails !== true) {
    return {
      event_mode: data.eventMode ?? null,
      events: data.events || [],
      cloud_functions: data.eventCloudFuncs || [],
      verification_status: data.verificationStatus ?? null,
      verification_url: data.verificationUrl || "",
    };
  }
  if (section === "callback") {
    return {
      callback_mode: data.callbackMode ?? null,
      callbacks: data.callbacks || [],
      verification_status: data.verificationStatus ?? null,
      verification_url: data.verificationUrl || "",
    };
  }
  if (section === "bot") {
    return {
      enabled: data.enable === true,
      menu_enabled: data.botMenuEnable === true,
      card_callback_mode: data.cardCallbackMode ?? null,
      card_request_url: data.cardRequestUrl || "",
    };
  }
  if (section === "external-sharing") {
    return {
      enabled: data.onlineB2CShareEnable === true,
      suggested: data.b2cShareSuggest === true,
      active_config: data.onlineB2CShareSplitConfig || null,
      suggested_config: data.b2cShareSplitConfigSuggest || null,
      feature_hint: data.b2cShareConfigHint || null,
    };
  }
  return data;
}

function normalizePortalRead(payload, section, options) {
  if (typeof payload.code === "number" && payload.code !== 0) {
    return {
      ok: false,
      code: payload.code,
      message: payload.msg || payload.message || "portal returned a nonzero code",
    };
  }
  return {
    ok: true,
    data: summarizePortalSection(section, payload.data ?? payload, options),
  };
}

async function readAppSection(client, appId, section, options = {}) {
  const request = SECTION_REQUEST[section](appId, options);
  const payload = await client.post(request.path, request.body, { allowNonzero: true });
  return normalizePortalRead(payload, section, options);
}

async function inspectApp(client, appId, sections, options = {}) {
  const inspection = {};
  for (const section of sections) {
    inspection[section.replaceAll("-", "_")] = await readAppSection(
      client,
      appId,
      section,
      options,
    );
  }
  return { app_id: appId, inspection };
}

function summarizeApp(app) {
  return {
    app_id: appIdFromRecord(app) || null,
    name: app.name || app.i18n?.zh_cn?.name || null,
    description: app.desc || app.i18n?.zh_cn?.description || null,
    version: app.version || null,
    abilities: app.ability || [],
    app_type: app.appType ?? null,
    app_status: app.appStatus ?? null,
    audit_status: app.auditStatus ?? null,
    developer_status: app.appListDevStatus ?? null,
    created_at: app.createTime ?? null,
    updated_at: app.updateTime ?? null,
  };
}

function arraysOnly(values, label) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new CliError(`${label} must be an array of strings`);
  }
  return [...new Set(values)];
}

function walkObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, output);
  } else if (value && typeof value === "object") {
    output.push(value);
    for (const item of Object.values(value)) walkObjects(item, output);
  }
  return output;
}

function findScopeRecord(catalog, scopeName) {
  const records = walkObjects(catalog);
  return records.find((record) =>
    Object.values(record).some((value) => typeof value === "string" && value === scopeName),
  );
}

function scopeIdFromRecord(record) {
  const preferred = ["scopeId", "scopeID", "scope_id", "id", "ID"];
  for (const key of preferred) {
    if (record?.[key] !== undefined && /^\d+$/.test(String(record[key]))) return String(record[key]);
  }
  for (const [key, value] of Object.entries(record || {})) {
    if (/scope.*id/i.test(key) && /^\d+$/.test(String(value))) return String(value);
  }
  return "";
}

function scopeTypeFromRecord(record) {
  const value = record?.scopeIdentityType ?? record?.scope_identity_type ?? record?.identityType;
  if (Number(value) === 2 || String(value).toLowerCase() === "tenant") return "tenant";
  if (Number(value) === 1 || String(value).toLowerCase() === "user") return "user";
  return "";
}

async function resolveScopeNames(client, appId, tenantNames, userNames) {
  if (tenantNames.length === 0 && userNames.length === 0) {
    return { tenant: [], user: [] };
  }
  const catalog = await client.post(`/scope/applied/${encodeURIComponent(appId)}`, {});
  const resolved = { tenant: [], user: [] };
  for (const [requestedType, names] of Object.entries({ tenant: tenantNames, user: userNames })) {
    for (const name of names) {
      const record = findScopeRecord(catalog, name);
      const id = scopeIdFromRecord(record);
      const detectedType = scopeTypeFromRecord(record);
      if (!record || !id) {
        throw new CliError(
          `scope ${name} could not be mapped to a numeric portal id; run scope.catalog or provide ${requestedType}_ids`,
        );
      }
      if (detectedType && detectedType !== requestedType) {
        throw new CliError(`scope ${name} is ${detectedType}, not ${requestedType}`);
      }
      resolved[requestedType].push(id);
    }
  }
  return resolved;
}

async function saveAppSecret(appId, appSecret, platform, options) {
  if (options["no-store-secrets"]) return null;
  const directory = path.resolve(
    options["secrets-dir"] || path.join(stateDirectory(), "apps"),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const filename = path.join(directory, `${appId}.json`);
  await writeFile(
    filename,
    `${JSON.stringify({ app_id: appId, app_secret: appSecret, platform, saved_at: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(filename, 0o600);
  return filename;
}

function defaultReleasePayload(op, creatorId) {
  const visibility = op.visibility || "creator";
  if (!new Set(["creator", "all"]).has(visibility)) {
    throw new CliError(`${op.id}.visibility must be creator or all`);
  }
  return {
    appVersion: op.version,
    mobileDefaultAbility: op.mobile_default_ability || "bot",
    pcDefaultAbility: op.pc_default_ability || "bot",
    changeLog: op.changelog || op.version,
    visibleSuggest: {
      departments: [],
      members: visibility === "creator" ? [creatorId] : [],
      groups: [],
      isAll: visibility === "all" ? 1 : 0,
    },
    applyReasonConfig: {
      apiPrivilegeNeedReason: false,
      contactPrivilegeNeedReason: false,
      dataPrivilegeReasonMap: {},
      visibleScopeNeedReason: false,
      apiPrivilegeReasonMap: {},
      contactPrivilegeReason: "",
      isDataPrivilegeExpandMap: {},
      visibleScopeReason: "",
      dataPrivilegeNeedReason: false,
      isAutoAudit: false,
      isContactExpand: false,
    },
    b2cShareSuggest: false,
    autoPublish: false,
    blackVisibleSuggest: { departments: [], members: [], groups: [], isAll: 0 },
  };
}

export async function runOperation(client, op, context, options = {}) {
  switch (op.action) {
    case "app.list": {
      return listApps(client, op);
    }
    case "app.inspect": {
      const appId = appIdFor(op, context);
      return inspectApp(
        client,
        appId,
        normalizeInspectionSections(op.sections, `${op.id}.sections`),
        { eventDetails: op.event_details === true },
      );
    }
    case "apps.inspect": {
      const listed = await listApps(client, op);
      const sections = normalizeInspectionSections(op.sections, `${op.id}.sections`);
      const apps = [];
      for (const app of listed.apps) {
        const appId = appIdFromRecord(app);
        apps.push({
          app: op.full_app_records === true ? app : summarizeApp(app),
          ...(appId
            ? await inspectApp(client, appId, sections, { eventDetails: op.event_details === true })
            : { app_id: null, inspection: {}, error: "app record does not contain an app id" }),
        });
      }
      return { apps, total_count: listed.total_count };
    }
    case "app.create": {
      const avatar = op.avatar_url || (await client.uploadIcon(op.icon_path));
      const description = op.description || op.name;
      const primaryLanguage = op.primary_language || (context.platform === "lark" ? "en_us" : "zh_cn");
      const response = await client.post("/app/create", {
        appSceneType: Number(op.app_scene_type || 0),
        name: op.name,
        desc: description,
        avatar,
        i18n: op.i18n || { [primaryLanguage]: { name: op.name, description } },
        primaryLang: primaryLanguage,
      });
      const appId = response.data?.ClientID;
      requireString(appId, `${op.id} result app_id`);
      context.app_id = appId;
      let secretFile = null;
      if (!options["no-store-secrets"] && op.fetch_secret !== false) {
        const secretResponse = await client.post(`/secret/${encodeURIComponent(appId)}`);
        const appSecret = secretResponse.data?.secret;
        requireString(appSecret, `${op.id} result app_secret`);
        secretFile = await saveAppSecret(appId, appSecret, context.platform, options);
      }
      return {
        app_id: appId,
        console_url: `${PLATFORM[context.platform].open}/app/${appId}`,
        secret_stored: Boolean(secretFile),
        secret_file: secretFile,
      };
    }
    case "secret.get": {
      const appId = appIdFor(op, context);
      if (options["no-store-secrets"]) {
        throw new CliError("secret.get cannot be used with --no-store-secrets");
      }
      const response = await client.post(`/secret/${encodeURIComponent(appId)}`);
      const appSecret = response.data?.secret;
      requireString(appSecret, `${op.id} result app_secret`);
      const secretFile = await saveAppSecret(appId, appSecret, context.platform, options);
      return { app_id: appId, secret_stored: true, secret_file: secretFile };
    }
    case "bot.set": {
      const appId = appIdFor(op, context);
      await client.post(`/robot/switch/${encodeURIComponent(appId)}`, { enable: op.enabled });
      if (op.enabled) await client.post(`/robot/${encodeURIComponent(appId)}`);
      return { app_id: appId, enabled: op.enabled };
    }
    case "bot.get": {
      const appId = appIdFor(op, context);
      return { app_id: appId, bot: await readAppSection(client, appId, "bot") };
    }
    case "scope.catalog": {
      const appId = appIdFor(op, context);
      const response = await client.post(`/scope/applied/${encodeURIComponent(appId)}`, {});
      return { app_id: appId, catalog: response.data ?? response };
    }
    case "scopes.update": {
      const appId = appIdFor(op, context);
      const tenantNames = arraysOnly(op.tenant_scopes, `${op.id}.tenant_scopes`);
      const userNames = arraysOnly(op.user_scopes, `${op.id}.user_scopes`);
      const fromNames = await resolveScopeNames(client, appId, tenantNames, userNames);
      const tenantIds = [
        ...arraysOnly(op.tenant_ids, `${op.id}.tenant_ids`),
        ...fromNames.tenant,
      ];
      const userIds = [
        ...arraysOnly(op.user_ids, `${op.id}.user_ids`),
        ...fromNames.user,
      ];
      if (tenantIds.length === 0 && userIds.length === 0) {
        throw new CliError(`${op.id} has no scopes to update`);
      }
      await client.post(`/scope/update/${encodeURIComponent(appId)}`, {
        appScopeIDs: [...new Set(tenantIds)],
        userScopeIDs: [...new Set(userIds)],
        scopeIds: arraysOnly(op.scope_ids, `${op.id}.scope_ids`),
        operation: op.operation || "add",
        isDeveloperPanel: true,
      });
      return {
        app_id: appId,
        operation: op.operation || "add",
        tenant_ids: [...new Set(tenantIds)],
        user_ids: [...new Set(userIds)],
      };
    }
    case "events.update": {
      const appId = appIdFor(op, context);
      const payload = {
        operation: op.operation || "add",
        events: arraysOnly(op.events, `${op.id}.events`),
        appEvents: arraysOnly(op.app_events, `${op.id}.app_events`),
        userEvents: arraysOnly(op.user_events, `${op.id}.user_events`),
        eventMode: Number.isInteger(op.event_mode) ? op.event_mode : 1,
      };
      await client.post(`/event/update/${encodeURIComponent(appId)}`, payload);
      return { app_id: appId, ...payload };
    }
    case "event.get": {
      const appId = appIdFor(op, context);
      return {
        app_id: appId,
        event: await readAppSection(client, appId, "event", {
          eventDetails: op.need_event_detail === true,
        }),
      };
    }
    case "event.mode": {
      const appId = appIdFor(op, context);
      await client.post(`/event/switch/${encodeURIComponent(appId)}`, {
        eventMode: op.event_mode,
      });
      return { app_id: appId, event_mode: op.event_mode };
    }
    case "callback.get": {
      const appId = appIdFor(op, context);
      return { app_id: appId, callback: await readAppSection(client, appId, "callback") };
    }
    case "webhook.set": {
      const appId = appIdFor(op, context);
      validateWebhookUrl(op.url, op.allow_insecure, `${op.id}.url`);
      const config = await client.post(`/event/${encodeURIComponent(appId)}`, {
        needEventDetail: true,
      });
      const verificationToken = config.data?.verificationToken;
      requireString(verificationToken, `${op.id} verification token`);
      const attempts = Number(op.retries || 5);
      let accepted = false;
      let lastResponse;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (op.warmup !== false) {
          await fetch(op.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challenge: `feishu-app-admin-${Date.now()}`,
              token: verificationToken,
              type: "url_verification",
            }),
          }).catch(() => undefined);
        }
        lastResponse = await client.post(
          `/event/check_url/${encodeURIComponent(appId)}`,
          { verificationToken, verificationUrl: op.url },
          { allowNonzero: true },
        );
        if (lastResponse.code === 0 && lastResponse.data?.access === true) {
          accepted = true;
          break;
        }
        if (attempt < attempts) await sleep(1000);
      }
      if (!accepted) {
        throw new CliError("the callback URL did not pass Feishu verification", {
          exitCode: 5,
          details: redact(lastResponse),
        });
      }
      await client.post(`/event/switch/${encodeURIComponent(appId)}`, { eventMode: 1 });
      return { app_id: appId, url: op.url, verified: true, event_mode: 1 };
    }
    case "external-sharing.get": {
      const appId = appIdFor(op, context);
      return {
        app_id: appId,
        external_sharing: await readAppSection(client, appId, "external-sharing"),
      };
    }
    case "version.create": {
      const appId = appIdFor(op, context);
      const creatorId = op.payload ? null : await client.creatorId();
      const payload = op.payload || defaultReleasePayload(op, creatorId);
      const response = await client.post(`/app_version/create/${encodeURIComponent(appId)}`, payload);
      const versionId = response.data?.versionId;
      requireString(versionId, `${op.id} result version_id`);
      if (op.publish === true) {
        await client.post(
          `/publish/commit/${encodeURIComponent(appId)}/${encodeURIComponent(versionId)}`,
        );
      }
      return {
        app_id: appId,
        version_id: versionId,
        console_url: `${PLATFORM[context.platform].open}/app/${appId}/version/${versionId}`,
        published: op.publish === true,
      };
    }
    case "version.publish": {
      const appId = appIdFor(op, context);
      await client.post(
        `/publish/commit/${encodeURIComponent(appId)}/${encodeURIComponent(op.version_id)}`,
      );
      return { app_id: appId, version_id: op.version_id, published: true };
    }
    case "raw.request": {
      const response = await client.request(op.path, {
        method: op.method || "POST",
        body: op.body,
        query: op.query,
        allowNonzero: op.allow_nonzero === true,
      });
      return { response };
    }
    default:
      throw new CliError(`unsupported action ${op.action}`);
  }
}

async function executeManifest(manifest, options) {
  const plan = buildPlan(manifest);
  if (plan.writes && !options.yes) {
    throw new CliError("write confirmation required; add --yes after user authorization", {
      exitCode: 10,
      details: plan,
    });
  }
  const session = await launchPortalSession(manifest.platform, options);
  const client = new PortalClient(manifest.platform, session.credentials);
  const context = {
    ...structuredClone(manifest.vars),
    vars: structuredClone(manifest.vars),
    platform: manifest.platform,
    app_id: manifest.app_id,
    results: {},
  };
  try {
    for (const original of manifest.operations) {
      const op = resolveTemplates(original, { ...context, ...context.results });
      process.stderr.write(`[feishu-app-admin] ${op.id}: ${op.action}\n`);
      try {
        const result = await runOperation(client, op, context, options);
        context.results[op.id] = result;
        if (result?.app_id && !context.app_id) context.app_id = result.app_id;
      } catch (error) {
        const details = {
          failed_operation: op.id,
          completed_operations: Object.keys(context.results),
          cause: error.details,
        };
        if (error instanceof CliError) {
          error.details = details;
          throw error;
        }
        throw new CliError(error.message || String(error), { exitCode: 1, details });
      }
    }
    return {
      ok: true,
      platform: manifest.platform,
      app_id: context.app_id || null,
      results: context.results,
    };
  } finally {
    try {
      await session.close();
    } catch (error) {
      process.stderr.write(`[feishu-app-admin] Warning: browser cleanup failed: ${error.message}\n`);
    }
  }
}

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
    tests: ["manifest", "plan", "templates", "redaction", "raw-path", "headless-reuse"],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (options.version || command === "--version" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (options.help || command === "help" || command === "--help") {
    process.stdout.write(usage());
    return;
  }
  if (command === "self-test") {
    emitJson(await selfTest());
    return;
  }
  if (command === "actions") {
    emitJson({ ok: true, actions: actionCatalog(), event_modes: EVENT_MODES });
    return;
  }
  if (command === "validate" || command === "plan") {
    const manifest = await loadManifest(options.manifest);
    emitJson(command === "validate" ? { ok: true, operations: manifest.operations.length } : buildPlan(manifest));
    return;
  }
  if (command === "apply") {
    const manifest = await loadManifest(options.manifest);
    emitJson(await executeManifest(manifest, options));
    return;
  }
  if (command === "apps") {
    const platform = options.platform || "feishu";
    const operation = {
      id: "apps",
      action: options.inspect ? "apps.inspect" : "app.list",
      ...(options.sections ? { sections: options.sections.split(",").map((value) => value.trim()) } : {}),
      ...(options["event-details"] ? { event_details: true } : {}),
      ...(options.full ? { full_app_records: true } : {}),
    };
    const manifest = validateManifest({ platform, operations: [operation] });
    emitJson(await executeManifest(manifest, options));
    return;
  }
  if (command === "inspect") {
    requireString(options["app-id"], "--app-id");
    const platform = options.platform || "feishu";
    const operation = {
      id: "inspect",
      action: "app.inspect",
      app_id: options["app-id"],
      ...(options.sections ? { sections: options.sections.split(",").map((value) => value.trim()) } : {}),
      ...(options["event-details"] ? { event_details: true } : {}),
    };
    const manifest = validateManifest({ platform, operations: [operation] });
    emitJson(await executeManifest(manifest, options));
    return;
  }
  throw new CliError(`unknown command ${command}`);
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    await main(argv);
  } catch (error) {
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    emitJson(
      {
        ok: false,
        error: {
          type: error instanceof CliError ? "cli" : "internal",
          message: error.message || String(error),
          details: error.details,
        },
      },
      process.stderr,
    );
    process.exitCode = exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
