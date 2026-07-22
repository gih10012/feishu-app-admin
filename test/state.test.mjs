import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { stateDirectory } from "../src/cli.mjs";

test("uses an application-specific state override", () => {
  const previous = process.env.FEISHU_APP_ADMIN_HOME;
  process.env.FEISHU_APP_ADMIN_HOME = "./state-test";
  try {
    assert.equal(stateDirectory(), path.resolve("state-test"));
  } finally {
    if (previous === undefined) delete process.env.FEISHU_APP_ADMIN_HOME;
    else process.env.FEISHU_APP_ADMIN_HOME = previous;
  }
});
