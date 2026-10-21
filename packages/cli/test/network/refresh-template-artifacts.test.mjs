// Installs from npm, so it runs with `pnpm --filter @camox/cli test:network`, not `pnpm test`.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const script = fileURLToPath(
  new URL("../../scripts/refresh-template-artifacts.mjs", import.meta.url),
);
// Any published SDK version will do: the refresh installs it from npm.
const PUBLISHED_VERSION = "0.44.0";

let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "camox-refresh-template-test-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An empty bare repo standing in for `template-default`, of its own for each test. */
async function emptyRemote(name) {
  const remote = join(root, `${name}.git`);
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  return remote;
}

function refresh(remote) {
  return exec(
    process.execPath,
    [script, "--remote", remote, "--camox-version", PUBLISHED_VERSION],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
}

async function freshClone(remote, name) {
  const dir = join(root, name);
  await exec("git", ["clone", "--quiet", remote, dir]);
  return dir;
}

async function commitCount(remote) {
  const { stdout } = await exec("git", ["--git-dir", remote, "rev-list", "--count", "main"]);
  return Number(stdout.trim());
}

void test(
  "after a refresh, a fresh clone of the Template installs from its frozen lockfile at the published SDK",
  { timeout: 10 * 60_000 },
  async () => {
    const remote = await emptyRemote("installs");
    await refresh(remote);

    const clone = await freshClone(remote, "installs-clone");
    const pkg = JSON.parse(await readFile(join(clone, "package.json"), "utf-8"));
    assert.equal(pkg.dependencies.camox, `^${PUBLISHED_VERSION}`);

    const lockfile = await readFile(join(clone, "pnpm-lock.yaml"), "utf-8");
    assert.match(
      lockfile,
      new RegExp(
        `\\n {6}camox:\\n {8}specifier: \\^${PUBLISHED_VERSION}\\n {8}version: ${PUBLISHED_VERSION}`,
      ),
    );

    await exec("pnpm", ["install", "--frozen-lockfile"], {
      cwd: clone,
      maxBuffer: 16 * 1024 * 1024,
    });
  },
);

void test(
  "refreshing an unchanged Template pushes no new commit",
  { timeout: 10 * 60_000 },
  async () => {
    const remote = await emptyRemote("unchanged");
    await refresh(remote);
    const before = await commitCount(remote);
    assert.ok(before > 0, "the first refresh pushed nothing");

    await refresh(remote);

    assert.equal(await commitCount(remote), before);
  },
);
