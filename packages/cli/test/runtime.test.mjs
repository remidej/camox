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
  await writeFile(
    join(app, "node_modules/.camox/runtime.json"),
    JSON.stringify({
      projectId: "01a15fff-627c-7e88-83cd-ceb11f804d47",
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
        env: { ...process.env, HOME: root },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("logout signs out of the authentication URL of the runtime found from --cwd", async () => {
  const authFile = join(root, ".camox/auth.json");
  await mkdir(join(root, ".camox"), { recursive: true });
  await writeFile(
    authFile,
    JSON.stringify({
      "https://auth.example.test": { token: "t", email: "tester@example.com", name: "Tester" },
    }),
  );

  const result = await cli(["logout", "--cwd", "apps/site"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Logged out from Tester/);
  assert.match((await cli(["logout", "--cwd", "apps/site"])).stdout, /Not logged in/);
});
