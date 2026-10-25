import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { buildCommand, pushCommand, updateCommand } from "./commands";

const exec = promisify(execFile);
const OLD_VERSION = "0.9.1";
const NEW_VERSION = "0.10.0";

/**
 * Stands in for pnpm: `install` writes a lockfile naming the `camox` range `package.json` asks
 * for, and `exec` (the build) records the range it built with in `$BUILT_WITH`.
 */
const FAKE_PNPM = `#!/bin/sh
range=$(node -p "require('./package.json').dependencies.camox")
case "$1" in
  install) printf 'camox: %s\\n' "$range" > pnpm-lock.yaml ;;
  exec) printf '%s' "$range" > "$BUILT_WITH" ;;
esac
`;

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Camox",
  GIT_AUTHOR_EMAIL: "upgrades@camox.test",
  GIT_COMMITTER_NAME: "Camox",
  GIT_COMMITTER_EMAIL: "upgrades@camox.test",
};

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sh(command: string, cwd: string, env: Record<string, string> = {}) {
  return exec("sh", ["-c", command], { cwd, env: { ...process.env, ...GIT_IDENTITY, ...env } });
}

/** A project on `OLD_VERSION`, in a bare repo as its remote, with the commit `main` points to. */
async function project() {
  const root = await mkdtemp(path.join(tmpdir(), "camox-upgrade-"));
  dirs.push(root);
  const [origin, scratch, workspace, bin] = ["origin.git", "scratch", "workspace", "bin"].map(
    (name) => path.join(root, name),
  );
  await mkdir(scratch);
  await writeFile(
    path.join(scratch, "package.json"),
    `${JSON.stringify({ name: "site", dependencies: { camox: `^${OLD_VERSION}` } }, null, 2)}\n`,
  );
  await writeFile(path.join(scratch, "pnpm-lock.yaml"), `camox: ^${OLD_VERSION}\n`);
  await sh("git init -q -b main && git add -A && git commit -q -m 'Create site'", scratch);
  await sh(`git clone -q --bare . ${origin}`, scratch);
  const { stdout } = await sh("git rev-parse HEAD", scratch);
  await mkdir(bin);
  await writeFile(path.join(bin, "pnpm"), FAKE_PNPM);
  await chmod(path.join(bin, "pnpm"), 0o755);
  return { root, origin, workspace, bin, sha: stdout.trim() };
}

/**
 * Runs an upgrade's steps as `@cloudflare/ci`'s sandbox runner does: the first on a fresh
 * checkout of the commit, each later one on the workspace the previous left, with the commit's
 * tracked files copied back over it.
 */
async function upgrade({ root, origin, workspace, bin, sha }: Awaited<ReturnType<typeof project>>) {
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    BUILT_WITH: path.join(root, "built-with"),
    UPGRADE_GIT_REMOTE: origin,
  };
  const steps = [
    updateCommand(`npm pkg set dependencies.camox=^${NEW_VERSION}`),
    buildCommand(),
    pushCommand(sha, NEW_VERSION),
  ];
  await mkdir(workspace);
  for (const command of steps) {
    await sh(`git -C ${origin} archive ${sha} | tar -x -C ${workspace}`, root);
    await sh(command, workspace, env);
  }
  return { builtWith: await readFile(env.BUILT_WITH, "utf8") };
}

async function mainOf(origin: string, file: string) {
  return (await sh(`git show main:${file}`, origin)).stdout;
}

describe("an upgrade's steps", () => {
  it("build the upgraded packages, though each step gets the commit's files back", async () => {
    const { builtWith } = await upgrade(await project());

    expect(builtWith).toBe(`^${NEW_VERSION}`);
  });

  it("push the upgraded package.json and lockfile to main, and nothing else", async () => {
    const site = await project();

    await upgrade(site);

    expect(JSON.parse(await mainOf(site.origin, "package.json")).dependencies.camox).toBe(
      `^${NEW_VERSION}`,
    );
    expect(await mainOf(site.origin, "pnpm-lock.yaml")).toBe(`camox: ^${NEW_VERSION}\n`);
    const { stdout: files } = await sh("git ls-tree -r --name-only main", site.origin);
    expect(files.trim().split("\n").sort()).toEqual(["package.json", "pnpm-lock.yaml"]);
    const { stdout: message } = await sh("git log -1 --format=%s main", site.origin);
    expect(message.trim()).toBe(`Upgrade Camox to ${NEW_VERSION}`);
  });
});
