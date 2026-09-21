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
let home;
let server;

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-pages-test-"));
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
          json: { ok: false, error: { code: "NOT_FOUND", message: "Page not found" } },
        }),
      );
      return;
    }
    res.end(JSON.stringify({ json: { ok: true, result: input.arguments } }));
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
      ...(await exec(process.execPath, [binary, "pages", ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("forwards individual, combined, empty and omitted SEO fields through the public entry point", async () => {
  for (const { flags, expected } of [
    { flags: ["--meta-title", "About"], expected: { metaTitle: "About" } },
    { flags: ["--meta-description", ""], expected: { metaDescription: "" } },
    {
      flags: ["--meta-title", "About", "--meta-description", "Team"],
      expected: { metaTitle: "About", metaDescription: "Team" },
    },
    { flags: ["--ai-seo", "on"], expected: { aiSeoEnabled: true } },
    { flags: ["--ai-seo", "off"], expected: { aiSeoEnabled: false } },
    {
      flags: ["--meta-title", "", "--ai-seo", "off"],
      expected: { metaTitle: "", aiSeoEnabled: false },
    },
    { flags: ["--nickname", "Internal name"], expected: { nickname: "Internal name" } },
  ]) {
    const result = await cli("update", "--id", "42", ...flags, "--json");
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { id: 42, ...expected });
    assert.equal(calls.at(-1).input.name, "updatePage");
    assert.equal(calls.at(-1).headers["x-environment-name"], "dev:tester@example.com");
  }
});

void test("path targeting, project override, production selection and draft/live reads", async () => {
  const result = await cli(
    "update",
    "--path",
    "/about",
    "--meta-title",
    "About",
    "--project",
    "other",
    "--production",
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { path: "/about", metaTitle: "About" });
  assert.equal(calls.at(-1).input.projectId, 7);
  assert.equal(calls.at(-1).headers["x-environment-name"], "production");
  assert.equal(calls.at(-2).input.slug, "other");
  for (const live of [false, true]) {
    const read = await cli("get", "--path", "/about", ...(live ? ["--live"] : []));
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), { path: "/about", source: live ? "live" : "draft" });
    assert.equal(calls.at(-1).input.name, "getPage");
  }
});

void test("rejects invalid combinations before any request", async () => {
  for (const flags of [
    [],
    ["--id", "42"],
    ["--meta-title", "About"],
    ["--id", "42", "--path", "/about", "--meta-title", "About"],
    ["--id", "42", "--meta-title", "", "--ai-seo", "on"],
    ["--path", "/about", "--meta-description", "Team", "--ai-seo", "on"],
  ]) {
    const count = calls.length;
    const result = await cli("update", ...flags);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(JSON.parse(result.stderr).code, "INVALID_ARGS");
    assert.equal(result.stdout, "");
    assert.equal(calls.length, count);
  }
});

void test("prints structured server errors and documents SEO workflow in help", async () => {
  const failed = await cli("update", "--id", "999", "--ai-seo", "off");
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.stderr).code, "NOT_FOUND");
  assert.equal(failed.stdout, "");
  const help = await cli("update", "--help");
  assert.equal(help.code, 0);
  for (const text of [
    "--meta-title",
    "--meta-description",
    "--ai-seo",
    "--path",
    "asynchronous",
    "both fields",
    "draft",
    "publish",
    "--live",
  ]) {
    assert.ok(help.stdout.includes(text), text);
  }
});
