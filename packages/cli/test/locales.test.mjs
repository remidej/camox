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
  home = await mkdtemp(join(tmpdir(), "camox-locales-test-"));
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
    res.end(JSON.stringify({ json: { ok: true, result: { called: input.name } } }));
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
      ...(await exec(process.execPath, [binary, ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("lists, adds and removes locales, and corrects the default locale's tag, in the development draft", async () => {
  for (const { args, name, toolArgs } of [
    { args: ["list"], name: "listLocales", toolArgs: {} },
    { args: ["add", "--tag", "de"], name: "addLocale", toolArgs: { tag: "de" } },
    { args: ["remove", "--tag", "de"], name: "removeLocale", toolArgs: { tag: "de" } },
    {
      args: ["set-default-tag", "--tag", "en-GB"],
      name: "setDefaultLocaleTag",
      toolArgs: { tag: "en-GB" },
    },
  ]) {
    const result = await cli("locales", ...args, "--json");
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { called: name });
    assert.equal(calls.at(-1).input.name, name);
    assert.deepEqual(calls.at(-1).input.arguments, toolArgs);
    assert.equal(calls.at(-1).headers["x-camox-draft"], "development");
  }
});

void test("reads and writes content in the locale --locale names, and the default locale without it", async () => {
  const id = "01a15417-bee7-7a35-8a17-77eb854482b0";
  for (const { args, name, toolArgs } of [
    {
      args: ["pages", "get", "--path", "/pricing"],
      name: "getPage",
      toolArgs: { path: "/pricing" },
    },
    {
      args: ["blocks", "edit", "--id", id, "--content", '{"title":"Hallo"}'],
      name: "editBlock",
      toolArgs: { id, content: { title: "Hallo" } },
    },
    {
      args: ["layouts", "get", "--layout-id", "default"],
      name: "getLayout",
      toolArgs: { layoutId: "default" },
    },
  ]) {
    const inGerman = await cli(...args, "--locale", "de", "--json");
    assert.equal(inGerman.code, 0, inGerman.stderr);
    assert.equal(calls.at(-1).input.name, name);
    assert.deepEqual(calls.at(-1).input.arguments, { ...toolArgs, locale: "de" });

    const byDefault = await cli(...args, "--json");
    assert.equal(byDefault.code, 0, byDefault.stderr);
    assert.deepEqual(calls.at(-1).input.arguments, toolArgs);
  }
});

void test("documents the locale flag and the locales commands", async () => {
  const help = await cli("pages", "get", "--help");
  assert.match(help.stdout, /--locale/);
  const add = await cli("locales", "add", "--help");
  assert.match(add.stdout, /--tag/);
});
