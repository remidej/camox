import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
let root;
let app;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "camox-runtime-test-"));
  app = join(root, "apps/site");
  await mkdir(join(app, "node_modules/.camox"), { recursive: true });
  await mkdir(join(app, "src"));
  await writeFile(join(root, "not-a-directory"), "file");
  await writeFile(
    join(app, "node_modules/.camox/runtime.json"),
    JSON.stringify({
      projectSlug: "selected-app",
      apiUrl: "https://api.example.test",
      authenticationUrl: "https://auth.example.test",
      disableTelemetry: true,
    }),
  );
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function cli(args, cwd = root) {
  try {
    return {
      ...(await exec(process.execPath, [binary, ...args], {
        cwd,
        env: { ...process.env, HOME: root, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("relative and absolute --cwd start upward lookup; default upward lookup remains", async () => {
  for (const path of ["apps/site", app, "apps/site/src"]) {
    const result = await cli(["status", "--cwd", path, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).projectSlug, "selected-app");
  }
  const result = await cli(["status", "--json"], join(app, "src"));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).projectSlug, "selected-app");
});

void test("no downward discovery; missing runtime errors explain --cwd and generation", async () => {
  const result = await cli(["status", "--json"]);
  assert.equal(result.code, 2);
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, "RUNTIME_NOT_FOUND");
  assert.match(error.message, /Change into your app directory or pass --cwd/);
  assert.match(error.message, /dev server or build once/);
});

void test("invalid lookup directories fail even when shell directory has a runtime", async () => {
  for (const path of [join(root, "missing"), join(root, "not-a-directory")]) {
    const result = await cli(["status", "--cwd", path], app);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).code, "INVALID_CWD");
  }
});

void test("every runtime-backed command group forwards --cwd", async () => {
  for (const command of [
    ["pages", "list"],
    ["blocks", "types"],
    ["layouts", "list"],
    ["env", "check"],
    ["files", "list"],
  ]) {
    const result = await cli([...command, "--cwd", "apps/site"]);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(JSON.parse(result.stderr).code, "NOT_AUTHENTICATED");
    const help = await cli([...command, "--help"]);
    assert.match(help.stdout, /--cwd/);
  }
  const result = await cli(["logout", "--cwd", "apps/site"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Not logged in/);
});
