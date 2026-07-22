import assert from "node:assert/strict";
import test from "node:test";

import { runOperation } from "../src/cli.mjs";

class FakePortalClient {
  calls = [];

  async post(path, body, options = {}) {
    this.calls.push({ path, body, options });
    if (path === "/app/list") {
      return {
        code: 0,
        data: { apps: [{ appId: "cli_a", name: "A" }], totalCount: 1 },
      };
    }
    if (path.startsWith("/callback/")) {
      return { code: 1001, msg: "callback is not configured" };
    }
    return { code: 0, data: { requestedPath: path } };
  }
}

test("apps.inspect uses named portal reads instead of raw.request", async () => {
  const client = new FakePortalClient();
  const result = await runOperation(
    client,
    {
      id: "inventory",
      action: "apps.inspect",
      sections: ["event", "callback", "bot", "external-sharing"],
    },
    { platform: "feishu" },
  );

  assert.equal(result.total_count, 1);
  assert.equal(result.apps[0].app_id, "cli_a");
  assert.equal(result.apps[0].inspection.event.ok, true);
  assert.equal(result.apps[0].inspection.callback.ok, false);
  assert.deepEqual(
    client.calls.map(({ path }) => path),
    [
      "/app/list",
      "/event/cli_a",
      "/callback/cli_a",
      "/robot/cli_a",
      "/b2c_share/cli_a",
    ],
  );
  assert.equal(client.calls.some(({ path }) => path.includes("raw")), false);
});

test("dedicated read actions normalize unavailable portal settings", async () => {
  const client = new FakePortalClient();
  const result = await runOperation(
    client,
    { id: "callback", action: "callback.get", app_id: "cli_a" },
    { platform: "feishu" },
  );

  assert.deepEqual(result.callback, {
    ok: false,
    code: 1001,
    message: "callback is not configured",
  });
  assert.equal(client.calls[0].options.allowNonzero, true);
});
