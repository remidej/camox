import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
// A Project ID, as the API mints it: a lowercase UUIDv7.
const PROJECT_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a70";
const calls = [];
let home;
let server;

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-project-test-"));
  await mkdir(join(home, ".camox"));
  await mkdir(join(home, "node_modules/.camox"), { recursive: true });
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const input = body ? JSON.parse(body).json : undefined;
    calls.push({ url: req.url, input });
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/rpc/projects/getBySlug")) {
      res.end(JSON.stringify({ json: { id: 7 } }));
      return;
    }
    if (req.url.startsWith("/rpc/drafts/get")) {
      res.end(JSON.stringify({ json: { changeCount: 3 } }));
      return;
    }
    res.end(JSON.stringify({ json: { ok: true, result: [] } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(home, ".camox/auth.json"),
    JSON.stringify({
      [origin]: { token: "test-token", email: "tester@example.com", name: "Tester" },
    }),
  );
  await writeFile(
    join(home, "node_modules/.camox/runtime.json"),
    JSON.stringify({
      projectSlug: "test",
      apiUrl: origin,
      authenticationUrl: origin,
      disableTelemetry: true,
    }),
  );
});

after(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await rm(home, { recursive: true, force: true });
});

async function cli(args, env = {}) {
  try {
    return {
      ...(await exec(process.execPath, [binary, ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "", ...env },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

/** The input of the last project lookup the CLI made. */
function lastProjectLookup() {
  return calls.findLast((call) => call.url.startsWith("/rpc/projects/getBySlug")).input;
}

/** Runs `pages list` against the project named by `value`, through the flag or the env var. */
function listPages(value, via) {
  return via === "--project"
    ? cli(["pages", "list", "--project", value, "--json"])
    : cli(["pages", "list", "--json"], { CAMOX_PROJECT: value });
}

for (const via of ["--project", "CAMOX_PROJECT"]) {
  void test(`${via} targets a project by its Project ID`, async () => {
    const result = await listPages(PROJECT_ID, via);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(lastProjectLookup(), { projectUuid: PROJECT_ID });
    assert.equal(calls.at(-1).input.projectId, 7);
  });

  void test(`${via} targets a project by its Project Slug`, async () => {
    const result = await listPages("other-site", via);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(lastProjectLookup(), { slug: "other-site" });
    assert.equal(calls.at(-1).input.projectId, 7);
  });
}

void test("status checks the development draft of a project named by its Project ID", async () => {
  const result = await cli(["status", "--project", PROJECT_ID, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(lastProjectLookup(), { projectUuid: PROJECT_ID });
  assert.deepEqual(JSON.parse(result.stdout).developmentDraft, { exists: true, changeCount: 3 });
});
