#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import { actionCatalog, EVENT_MODES, VERSION } from "./constants.mjs";
import { diagnoseEnvironment } from "./doctor.mjs";
import { CliError } from "./errors.mjs";
import {
  buildPlan,
  loadManifest,
  requireString,
  validateManifest,
} from "./manifest.mjs";
import { emitJson } from "./output.mjs";
import { executeManifest } from "./runner.mjs";
import { selfTest } from "./self-test.mjs";

export { shouldLaunchHeadless } from "./browser.mjs";
export { actionCatalog, VERSION } from "./constants.mjs";
export { buildPlan, resolveTemplates, validateManifest } from "./manifest.mjs";
export { runOperation } from "./operations.mjs";
export { redact } from "./output.mjs";
export { stateDirectory } from "./platform.mjs";
export { selfTest } from "./self-test.mjs";

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
    "browser-smoke",
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
  feishu-app-admin doctor   [--chrome <path>] [--profile-dir <path>] [--browser-smoke]
  feishu-app-admin validate --manifest <file.json>
  feishu-app-admin plan     --manifest <file.json>
  feishu-app-admin apply    --manifest <file.json> [--yes]
  feishu-app-admin apps     [--platform feishu|lark] [--inspect] [--full]
  feishu-app-admin inspect  --app-id <id> [--sections <names>] [--event-details]
  feishu-app-admin actions
  feishu-app-admin self-test

Browser options:
  --chrome <path>          Chrome/Edge executable; auto-detected on Linux/macOS/Windows
  --login-timeout <sec>    Login timeout, default 300
  --reuse-session          Reuse the default dedicated browser profile
  --profile-dir <path>     Reuse an explicit dedicated browser profile
  --show-browser           Force one interactive login/re-authentication window
  --browser-smoke          Doctor only: launch one temporary headless CDP probe

Execution options:
  --yes                    Confirm all writes already authorized by the user
  --secrets-dir <path>     Override the protected App Secret directory
  --no-store-secrets       Do not fetch/store app secrets after app.create

Inspection sections:
  event, callback, bot, external-sharing
  --event-details          Include the portal event catalog in inspection output
  --full                   Include complete app records with apps --inspect
`;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (options.version || command === "--version" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (options.help || new Set(["help", "--help", "-h"]).has(command)) {
    process.stdout.write(usage());
    return;
  }
  if (command === "doctor") {
    const report = await diagnoseEnvironment(options);
    emitJson(report);
    if (!report.ok) process.exitCode = 4;
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
    emitJson(
      command === "validate"
        ? { ok: true, operations: manifest.operations.length }
        : buildPlan(manifest),
    );
    return;
  }
  if (command === "apply") {
    emitJson(await executeManifest(await loadManifest(options.manifest), options));
    return;
  }
  if (command === "apps") {
    const operation = {
      id: "apps",
      action: options.inspect ? "apps.inspect" : "app.list",
      ...(options.sections
        ? { sections: options.sections.split(",").map((value) => value.trim()) }
        : {}),
      ...(options["event-details"] ? { event_details: true } : {}),
      ...(options.full ? { full_app_records: true } : {}),
    };
    const manifest = validateManifest({
      platform: options.platform || "feishu",
      operations: [operation],
    });
    emitJson(await executeManifest(manifest, options));
    return;
  }
  if (command === "inspect") {
    requireString(options["app-id"], "--app-id");
    const operation = {
      id: "inspect",
      action: "app.inspect",
      app_id: options["app-id"],
      ...(options.sections
        ? { sections: options.sections.split(",").map((value) => value.trim()) }
        : {}),
      ...(options["event-details"] ? { event_details: true } : {}),
    };
    const manifest = validateManifest({
      platform: options.platform || "feishu",
      operations: [operation],
    });
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
