import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const files = (await readdir("test"))
  .filter((filename) => filename.endsWith(".test.mjs"))
  .sort()
  .map((filename) => path.join("test", filename));

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status || 0);
