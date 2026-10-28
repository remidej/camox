import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
async function release(t, args, env, { setup } = {}) {
  const root = await mkdtemp(join(tmpdir(), "camox-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await setup?.(root);
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
  return { ...result, vpRun, root };
}

/**
 * A website's `camox`, whose SDK Bundle step records the folder it adds the bundle to: the SDK's
 * own is tested with a real build (packages/sdk/src/features/sdkBundle/websiteBuild.test.ts).
 */
async function installCamox(root) {
  const camox = join(root, "node_modules/camox");
  await mkdir(join(camox, "dist"), { recursive: true });
  await writeFile(
    join(camox, "package.json"),
    JSON.stringify({
      name: "camox",
      type: "module",
      exports: { "./_internal/sdkBundle": { import: "./dist/sdkBundle.js" } },
    }),
  );
  await writeFile(
    join(camox, "dist/sdkBundle.js"),
    `import { writeFileSync } from "node:fs";
export async function addSdkBundleToBuild({ root }) {
  writeFileSync(${JSON.stringify(join(root, "added.json"))}, JSON.stringify({ root }));
  return { browser: "b", workerd: "w" };
}
`,
  );
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

void test("a release adds the SDK Bundle its build names to what it deploys", async (t) => {
  for (const args of [[], ["--dry-run"]]) {
    const { code, root } = await release(
      t,
      args,
      { CAMOX_DEPLOY_TOKEN: "deploy-token" },
      { setup: installCamox },
    );

    assert.equal(code, 0, args.join(" "));
    const added = JSON.parse(await readFile(join(root, "added.json"), "utf8"));
    assert.equal(await realpath(added.root), await realpath(root), args.join(" "));
  }
});
