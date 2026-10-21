import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The CLI works only in the caller's development draft (ADR 0010): every request names it, and
// no command takes a target flag.

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7a";
const OTHER_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";
let calls = [];
let noDevelopmentDraft = false;
let home;
let server;

// One invocation of every command that reaches the API.
const COMMANDS = [
  ["pages", "list"],
  ["pages", "get", "--id", ID],
  ["pages", "create", "--path-segment", "about", "--layout-id", "default"],
  ["pages", "update", "--id", ID, "--nickname", "About"],
  ["pages", "set-seo", "--id", ID, "--meta-title", "About"],
  ["pages", "set-layout", "--id", ID, "--layout-id", "default"],
  ["pages", "delete", "--id", ID],
  ["blocks", "types"],
  ["blocks", "describe", "--type", "hero"],
  ["blocks", "get", "--id", ID],
  ["blocks", "get-many", "--id", ID, "--id", OTHER_ID],
  ["blocks", "create", "--page-id", ID, "--type", "hero", "--content", "{}"],
  ["blocks", "edit", "--id", ID, "--content", "{}"],
  ["blocks", "move", "--id", ID, "--position", "last"],
  ["blocks", "delete", "--id", ID],
  ["layouts", "list"],
  ["layouts", "get", "--layout-id", "default"],
  ["files", "list"],
  ["files", "get", "--id", ID],
  ["files", "update", "--id", ID, "--alt", "Hero"],
  ["files", "upload", "--file", "hero.png"],
  ["files", "update", "--id", ID, "--file", "hero.png"],
  ["publish"],
  ["publish", "--confirm", "token"],
  ["discard", "--yes"],
  ["status"],
];

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-draft-test-"));
  await mkdir(join(home, ".camox"));
  await mkdir(join(home, "node_modules/.camox"), { recursive: true });
  await writeFile(join(home, "hero.png"), "png");
  server = createServer(async (req, res) => {
    for await (const _chunk of req);
    calls.push({ url: req.url, headers: req.headers });
    res.setHeader("Content-Type", "application/json");
    if (noDevelopmentDraft && req.url.startsWith("/files/")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "No development draft", code: "NO_DEVELOPMENT_DRAFT" }));
      return;
    }
    if (noDevelopmentDraft && req.url.startsWith("/rpc/agent/")) {
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          json: {
            defined: false,
            code: "NO_DEVELOPMENT_DRAFT",
            status: 404,
            message: "No development draft",
          },
        }),
      );
      return;
    }
    if (req.url.startsWith("/files/")) {
      res.end(JSON.stringify({ id: ID }));
      return;
    }
    if (req.url.startsWith("/rpc/projects/getBy")) {
      res.end(JSON.stringify({ json: { id: 7 } }));
      return;
    }
    if (req.url.startsWith("/rpc/drafts/get")) {
      res.end(JSON.stringify({ json: { changeCount: 0 } }));
      return;
    }
    res.end(JSON.stringify({ json: { ok: true, result: {} } }));
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
      projectId: "01a15fff-627b-7fa1-938b-93ab659c1acc",
      apiUrl: origin,
      authenticationUrl: origin,
    }),
  );
});

beforeEach(() => {
  calls = [];
  noDevelopmentDraft = false;
});

after(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await rm(home, { recursive: true, force: true });
});

async function cli(...args) {
  try {
    return {
      ...(await exec(process.execPath, [binary, ...args, "--json"], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("every command names the development draft on each request", async () => {
  for (const args of COMMANDS) {
    calls = [];
    const result = await cli(...args);
    const label = args.join(" ");
    assert.equal(result.code, 0, `${label}: ${result.stderr}`);
    // The project lookup, then the command's own request.
    assert.equal(calls.length, 2, label);
    for (const call of calls) {
      assert.equal(call.headers["x-camox-draft"], "development", `${label} → ${call.url}`);
    }
  }
});

void test("no command takes a production or Live flag", async () => {
  for (const args of COMMANDS) {
    for (const flag of ["--production", "--live"]) {
      const result = await cli(...args, flag);
      assert.notEqual(result.code, 0, `${args.join(" ")} ${flag}`);
    }
  }
  assert.equal(calls.length, 0);
});

void test("explains how to create the development draft when it doesn't exist yet", async () => {
  noDevelopmentDraft = true;
  for (const args of [
    ["pages", "list"],
    ["files", "upload", "--file", "hero.png"],
    ["files", "update", "--id", ID, "--file", "hero.png"],
  ]) {
    const result = await cli(...args);
    const label = args.join(" ");
    assert.notEqual(result.code, 0, label);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, "NO_DEVELOPMENT_DRAFT", label);
    assert.match(error.message, /run your site locally/i, label);
  }
});

void test("status reports the development draft", async () => {
  const result = await cli("status");
  assert.equal(result.code, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.draft, "development");
});
