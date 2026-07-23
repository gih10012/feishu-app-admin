import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { DEFAULT_ICON_BASE64, PORTALS, VERSION } from "./constants.mjs";
import { CliError } from "./errors.mjs";
import { validateRawPath } from "./manifest.mjs";
import { redact } from "./output.mjs";
import { isPathInside } from "./platform.mjs";

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

export class PortalClient {
  constructor(platform, credentials) {
    this.platform = platform;
    this.cfg = PORTALS[platform];
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
      "User-Agent": `Mozilla/5.0 feishu-app-admin/${VERSION}`,
    };
  }

  async request(
    rawPath,
    { method = "POST", body = undefined, query = undefined, allowNonzero = false } = {},
  ) {
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
      if (!isPathInside(process.cwd(), resolved)) {
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
