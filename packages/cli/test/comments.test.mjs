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
const commentId = "78cf8b0c-630e-4d56-8a5f-931f15048784";
const calls = [];
let home;
let server;

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-comments-test-"));
  await mkdir(join(home, ".camox"));
  await mkdir(join(home, "node_modules/.camox"), { recursive: true });
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const input = body ? JSON.parse(body).json : undefined;
    calls.push({ url: req.url, headers: req.headers, input });
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/rpc/projects/getBySlug")) {
      res.end(JSON.stringify({ json: { id: 7 } }));
      return;
    }
    if (input.arguments.pageId === 999) {
      res.end(JSON.stringify({ json: { ok: false, error: { code: "NOT_FOUND", message: "Page not found" } } }));
      return;
    }
    res.end(JSON.stringify({ json: { ok: true, result: input.arguments } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(home, ".camox/auth.json"),
    JSON.stringify({ [origin]: { token: "test-token", email: "tester@example.com", name: "Tester" } }),
  );
  await writeFile(
    join(home, "node_modules/.camox/runtime.json"),
    JSON.stringify({ projectSlug: "test", apiUrl: origin, authenticationUrl: origin, disableTelemetry: true }),
  );
});

after(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await rm(home, { recursive: true, force: true });
});

async function cli(...args) {
  try {
    return {
      ...(await exec(process.execPath, [binary, "comments", ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("lists page comments in development and resolves a comment in production", async () => {
  const listed = await cli("list", "--page-id", "42", "--json");
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), { pageId: 42 });
  assert.equal(calls.at(-1).input.name, "listComments");
  assert.equal(calls.at(-1).input.projectId, 7);
  assert.equal(calls.at(-1).headers["x-environment-name"], "dev:tester@example.com");

  const resolved = await cli("resolve", "--page-id", "42", "--id", commentId, "--production", "--project", "other");
  assert.equal(resolved.code, 0, resolved.stderr);
  assert.deepEqual(JSON.parse(resolved.stdout), { pageId: 42, id: commentId });
  assert.equal(calls.at(-1).input.name, "resolveComment");
  assert.equal(calls.at(-1).headers["x-environment-name"], "production");
  assert.equal(calls.at(-2).input.slug, "other");
});

void test("rejects missing and invalid identifiers before a request", async () => {
  for (const args of [
    ["list"],
    ["list", "--page-id", "0"],
    ["resolve", "--page-id", "42"],
    ["resolve", "--id", commentId],
  ]) {
    const count = calls.length;
    const result = await cli(...args);
    assert.notEqual(result.code, 0);
    assert.equal(calls.length, count);
  }
});

void test("prints structured server errors", async () => {
  const failed = await cli("resolve", "--page-id", "999", "--id", commentId);
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.stderr).code, "NOT_FOUND");
  assert.equal(failed.stdout, "");
});
