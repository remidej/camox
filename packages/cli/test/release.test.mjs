import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// `camox release` builds the website with `vp build`, which the SDK's Vite plugin turns into a
// release from the environment it's given. A fake `vp` records that environment.

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

/** Runs `camox release` with a fake `vp`, and returns how it exited and what `vp` was given. */
async function release(t, args, env) {
  const root = await mkdtemp(join(tmpdir(), "camox-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const received = join(root, "vp-env.json");
  const vp = join(root, "vp");
  await writeFile(
    vp,
    `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(received)}, JSON.stringify({ args: process.argv.slice(2), release: process.env.CAMOX_INTERNAL_RELEASE ?? null }));
`,
  );
  await chmod(vp, 0o755);
  const { CAMOX_DEPLOY_TOKEN: _token, ...inherited } = process.env;
  const result = await exec(process.execPath, [binary, "release", ...args], {
    cwd: root,
    env: { ...inherited, PATH: `${root}${delimiter}${process.env.PATH}`, ...env },
  }).then(
    () => ({ code: 0 }),
    (error) => ({ code: error.code }),
  );
  const vpRun = await readFile(received, "utf8").then(JSON.parse, () => null);
  return { ...result, vpRun };
}

void test("a release builds for Live with the Deploy Token", async (t) => {
  const { code, vpRun } = await release(t, [], { CAMOX_DEPLOY_TOKEN: "deploy-token" });

  assert.equal(code, 0);
  assert.deepEqual(vpRun, { args: ["build"], release: "1" });
});

void test("a release without the Deploy Token fails before building", async (t) => {
  const { code, vpRun } = await release(t, [], {});

  assert.notEqual(code, 0);
  assert.equal(vpRun, null);
});

void test("a dry-run release builds as a release would, without a Deploy Token", async (t) => {
  const { code, vpRun } = await release(t, ["--dry-run"], {});

  assert.equal(code, 0);
  assert.deepEqual(vpRun, { args: ["build"], release: "dry-run" });
});
