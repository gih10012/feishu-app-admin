import process from "node:process";

import { launchPortalSession } from "./browser.mjs";
import { CliError } from "./errors.mjs";
import { buildPlan, resolveTemplates } from "./manifest.mjs";
import { runOperation } from "./operations.mjs";
import { PortalClient } from "./portal-client.mjs";

export async function executeManifest(manifest, options = {}) {
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
