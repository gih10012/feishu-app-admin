import { readFile } from "node:fs/promises";
import path from "node:path";

import { ACTION_RISK, EVENT_MODES, INSPECTION_SECTIONS, PORTALS } from "./constants.mjs";
import { CliError } from "./errors.mjs";

export async function loadManifest(filename) {
  if (!filename) throw new CliError("--manifest is required");
  try {
    return validateManifest(JSON.parse(await readFile(path.resolve(filename), "utf8")));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`cannot read manifest: ${error.message}`);
  }
}

export function requireString(value, label) {
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

export function normalizeInspectionSections(value, label = "sections") {
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

export function validateRawPath(rawPath) {
  requireString(rawPath, "raw.request.path");
  if (/^https?:\/\//i.test(rawPath) || !rawPath.startsWith("/") || rawPath.includes("..")) {
    throw new CliError(
      "raw.request.path must be a relative developer API path beginning with / and without ..",
    );
  }
}

export function validateWebhookUrl(url, allowInsecure, label = "webhook URL") {
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
  if (!PORTALS[manifest.platform]) {
    throw new CliError("manifest.platform must be feishu or lark");
  }
  if (manifest.app_id !== undefined) requireString(manifest.app_id, "manifest.app_id");
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
    if (!ACTION_RISK[op.action]) throw new CliError(`unsupported action ${op.action}`);
    op.id ||= `op_${index + 1}`;
    requireString(op.id, `operations[${index}].id`);
    if (seen.has(op.id)) throw new CliError(`duplicate operation id ${op.id}`);
    seen.add(op.id);

    if (op.action === "app.create") requireString(op.name, `${op.id}.name`);
    if (op.action === "bot.set" && typeof op.enabled !== "boolean") {
      throw new CliError(`${op.id}.enabled must be boolean`);
    }
    if (op.action === "scopes.update" && !new Set(["add", "remove"]).has(op.operation || "add")) {
      throw new CliError(`${op.id}.operation must be add or remove`);
    }
    if (op.action === "events.update" && !new Set(["add", "remove"]).has(op.operation || "add")) {
      throw new CliError(`${op.id}.operation must be add or remove`);
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
    if (op.action === "version.create" && !op.payload) requireString(op.version, `${op.id}.version`);
    if (op.action === "version.publish") requireString(op.version_id, `${op.id}.version_id`);
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
    target: op.action === "app.create" ? op.name : op.app_id || manifest.app_id || "${app_id}",
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
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveTemplates(child, context)]),
    );
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\$\{([^}]+)\}$/);
  if (exact) {
    const resolved = getByPath(context, exact[1]);
    if (resolved === undefined) throw new CliError(`unresolved template ${value}`);
    return structuredClone(resolved);
  }

  return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
    const resolved = getByPath(context, expression);
    if (resolved === undefined) throw new CliError(`unresolved template ${match}`);
    return String(resolved);
  });
}
