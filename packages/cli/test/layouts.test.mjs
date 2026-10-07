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
const calls = [];
const bundle = {
  layout: { id: 39, layoutId: "default", beforeBlockIds: [99], afterBlockIds: [100] },
  blocks: [
    { id: 99, type: "navigation", slot: "before", content: {} },
    { id: 100, type: "footer", slot: "after", content: {} },
  ],
  repeatableItems: [],
  files: [],
};
let home;
let server;

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-layouts-test-"));
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
    if (input?.arguments?.id === 999) {
      res.end(
        JSON.stringify({
          json: { ok: false, error: { code: "NOT_FOUND", message: "Layout not found" } },
        }),
      );
      return;
    }
    const result = input.name === "listLayouts" ? [{ id: 39, layoutId: "default" }] : bundle;
    res.end(JSON.stringify({ json: { ok: true, result } }));
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

async function cli(...args) {
  try {
    return {
      ...(await exec(process.execPath, [binary, "layouts", ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("discovers layout block IDs through list and draft get", async () => {
  const listed = await cli("list", "--json");
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(calls.at(-1).input.name, "listLayouts");
  const [{ id }] = JSON.parse(listed.stdout);
  const result = await cli("get", "--id", String(id), "--json");
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), bundle);
  assert.equal(calls.at(-1).input.name, "getLayout");
  assert.deepEqual(calls.at(-1).input.arguments, { id: 39, source: "draft" });
  assert.equal(calls.at(-1).headers["x-environment-name"], "dev:tester@example.com");
});

void test("forwards live source independently of project and production targeting", async () => {
  for (const live of [false, true]) {
    const result = await cli(
      "get",
      "--id",
      "39",
      "--project",
      "other",
      "--production",
      ...(live ? ["--live"] : []),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), bundle);
    assert.deepEqual(calls.at(-1).input.arguments, {
      id: 39,
      source: live ? "live" : "draft",
    });
    assert.equal(calls.at(-1).input.projectId, 7);
    assert.equal(calls.at(-1).headers["x-environment-name"], "production");
    assert.equal(calls.at(-2).input.slug, "other");
  }
});

void test("rejects missing or invalid numeric layout IDs before making requests", async () => {
  for (const flags of [[], ["--id", "default"], ["--id", "0"], ["--id", "-1"], ["--id", "1.5"]]) {
    const count = calls.length;
    const result = await cli("get", ...flags);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(calls.length, count);
  }
});

void test("prints structured server errors and exposes discovery guidance in help", async () => {
  const failed = await cli("get", "--id", "999", "--json");
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.stderr).code, "NOT_FOUND");
  assert.equal(failed.stdout, "");
  const listHelp = await cli("list", "--help");
  assert.match(listHelp.stdout, /layouts get/);
  const help = await cli("get", "--help");
  assert.equal(help.code, 0);
  for (const text of [
    "--id",
    "--live",
    "--cwd",
    "--project",
    "--production",
    "--json",
    "blocks edit",
  ]) {
    assert.ok(help.stdout.includes(text), help.stdout);
  }
});
