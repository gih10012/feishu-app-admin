import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function modules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await modules(filename)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(filename);
  }
  return files;
}

for (const filename of [...(await modules("src")), ...(await modules("bin"))]) {
  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const selfTest = spawnSync(process.execPath, ["src/cli.mjs", "self-test"], {
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(selfTest.status || 0);
