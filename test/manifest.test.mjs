import assert from "node:assert/strict";
import test from "node:test";

import {
  actionCatalog,
  buildPlan,
  redact,
  resolveTemplates,
  validateManifest,
} from "../src/cli.mjs";

test("validates named inspection actions and event modes", () => {
  const manifest = validateManifest({
    platform: "feishu",
    app_id: "cli_test",
    operations: [
      { id: "inspect", action: "app.inspect", sections: ["event", "external_sharing"] },
      { id: "mode", action: "event.mode", event_mode: "websocket" },
    ],
  });

  assert.deepEqual(manifest.operations[0].sections, ["event", "external-sharing"]);
  assert.equal(manifest.operations[1].event_mode, 4);
  assert.equal(buildPlan(manifest).writes, true);
});

test("rejects unsupported inspection sections", () => {
  assert.throws(
    () => validateManifest({ operations: [{ action: "app.inspect", sections: ["unknown"] }] }),
    /unsupported sections/,
  );
});

test("resolves exact and embedded templates", () => {
  const output = resolveTemplates(
    { app_id: "${create.app_id}", label: "app=${create.app_id}" },
    { create: { app_id: "cli_test" } },
  );
  assert.deepEqual(output, { app_id: "cli_test", label: "app=cli_test" });
});

test("redacts recursive sensitive values", () => {
  assert.deepEqual(redact({ app_secret: "x", nested: { csrfToken: "y", safe: 1 } }), {
    app_secret: "<redacted>",
    nested: { csrfToken: "<redacted>", safe: 1 },
  });
});

test("keeps raw.request as the last-resort high-risk action", () => {
  const raw = actionCatalog().find(({ action }) => action === "raw.request");
  assert.equal(raw.risk, "high-risk-write");
  assert.match(raw.description, /Fallback/);
  assert.throws(
    () => validateManifest({ operations: [{ action: "raw.request", path: "https://example.com" }] }),
    /relative developer API path/,
  );
});
