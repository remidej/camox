import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
let home;
let origin;
let server;
const calls = [];
const records = [];
const image = Buffer.from("test media bytes");

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-cli-test-"));
  await mkdir(join(home, ".camox"));
  await mkdir(join(home, "tmp"));
  await mkdir(join(home, "node_modules/.camox"), { recursive: true });
  server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      calls.push({ url: req.url, headers: req.headers });
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/source")) {
        res.setHeader("Content-Type", "image/webp");
        res.end(image);
        return;
      }
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/source.webp?signature=secret" }).end();
        return;
      }
      if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" }).end();
        return;
      }
      if (req.url === "/unsafe-redirect") {
        res.writeHead(302, { Location: "file:///secret" }).end();
        return;
      }
      if (req.url === "/oversized") {
        res.writeHead(200, { "Content-Length": 101 * 1024 * 1024 }).end();
        return;
      }
      const contentTarget = /^\/files\/(\d+)\/content$/.exec(req.url);
      if (req.url === "/files/upload" || contentTarget) {
        const form = await new Request(`${origin}/files/upload`, {
          method: "POST",
          headers: { "content-type": req.headers["content-type"] },
          body,
        }).formData();
        const file = form.get("file");
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), image);
        assert.equal(form.get("projectId"), "7");
        const existing = contentTarget
          ? records.find((file) => file.id === Number(contentTarget[1]))
          : undefined;
        if (contentTarget && !existing) {
          res.writeHead(404).end();
          return;
        }
        if (contentTarget && file.name === "fail.webp") {
          res.writeHead(500).end("private server failure");
          return;
        }
        const record = {
          id: existing?.id ?? records.length + 1,
          url: `${origin}/files/serve/example-${calls.length}`,
          filename: file.name,
          mimeType: file.type,
          alt: form.get("alt") ?? existing?.alt ?? "",
          aiMetadataEnabled: form.has("aiMetadataEnabled")
            ? form.get("aiMetadataEnabled") === "true"
            : (existing?.aiMetadataEnabled ?? null),
        };
        if (existing) Object.assign(existing, record);
        else records.push(record);
        res.writeHead(existing ? 200 : 201).end(JSON.stringify(record));
        return;
      }
      if (req.url.startsWith("/rpc/projects/getBySlug")) {
        res.end(JSON.stringify({ json: { id: 7 } }));
        return;
      }
      if (req.url.startsWith("/rpc/agent/callTool")) {
        const input = JSON.parse(body.toString()).json;
        calls.at(-1).input = input;
        let result = records;
        if (input.name === "getFile")
          result = records.find((file) => file.id === input.arguments.id);
        if (input.name === "updateFile") {
          result = records.find((file) => file.id === input.arguments.id);
          Object.assign(result, input.arguments);
          if (input.arguments.alt !== undefined) result.aiMetadataEnabled = false;
        }
        if (input.name === "editBlock")
          result = { id: input.arguments.id, content: input.arguments.content };
        res.end(JSON.stringify({ json: { ok: true, result } }));
        return;
      }
      res.writeHead(404).end("secret");
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    join(home, ".camox/auth.json"),
    JSON.stringify({
      [origin]: { token: "test-token", name: "Tester", email: "tester@example.com" },
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
  await writeFile(join(home, "hero.webp"), image);
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
        env: { ...process.env, HOME: home, TMPDIR: join(home, "tmp"), CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

function success(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

void test("local upload, empty alt, reads, updates, and use in block content", async () => {
  const file = success(await cli("files", "upload", "--file", "hero.webp", "--alt", "", "--json"));
  assert.equal(file.mimeType, "image/webp");
  assert.equal(file.alt, "");
  assert.equal(file.aiMetadataEnabled, false);
  assert.equal(success(await cli("files", "get", "--id", String(file.id))).id, file.id);
  assert.equal(success(await cli("files", "list"))[0].id, file.id);
  assert.equal(
    success(await cli("files", "update", "--id", String(file.id), "--alt", "Hero")).alt,
    "Hero",
  );
  const renamed = success(
    await cli("files", "update", "--id", String(file.id), "--filename", "dummy-hero.webp"),
  );
  assert.equal(renamed.filename, "dummy-hero.webp");
  assert.equal(renamed.url, file.url);
  assert.equal(renamed.alt, "Hero");
  assert.equal(renamed.aiMetadataEnabled, false);
  const block = success(
    await cli(
      "blocks",
      "edit",
      "--id",
      "20",
      "--content",
      JSON.stringify({ image: { _fileId: file.id } }),
    ),
  );
  assert.equal(block.content.image._fileId, file.id);
  const upload = calls.find((call) => call.url === "/files/upload");
  assert.equal(upload.headers.authorization, "Bearer test-token");
  assert.equal(upload.headers["x-environment-name"], "dev:tester@example.com");
  assert.equal(upload.headers["x-camox-telemetry-disabled"], "1");
});

void test("URL upload follows redirects, stores a copy, and uses the shared production context", async () => {
  const file = success(
    await cli(
      "files",
      "upload",
      "--url",
      `${origin}/redirect`,
      "--production",
      "--project",
      "other",
      "--filename",
      "hero.webp",
      "--ai-metadata",
      "off",
    ),
  );
  assert.equal(file.filename, "hero.webp");
  assert.equal(file.aiMetadataEnabled, false);
  assert.equal(
    calls.filter((call) => call.url === "/files/upload").at(-1).headers["x-environment-name"],
    "production",
  );
  assert.equal(calls.find((call) => call.url === "/redirect").headers.authorization, undefined);
  assert.deepEqual(await readdir(join(home, "tmp")), []);
  const automatic = success(
    await cli("files", "upload", "--url", `${origin}/source.webp?signature=secret`),
  );
  assert.equal(automatic.filename, "source.webp");
  assert.equal(automatic.aiMetadataEnabled, null);
});

void test("rejects missing/conflicting sources and metadata before making requests", async () => {
  for (const args of [
    ["upload"],
    ["upload", "--file", "hero.webp", "--url", `${origin}/source`],
    ["upload", "--file", "hero.webp", "--alt", "", "--ai-metadata", "on"],
    ["upload", "--file", "hero.webp", "--filename", "../hero.webp"],
    ["update", "--id", "1"],
    ["update", "--id", "1", "--file", "hero.webp", "--url", `${origin}/source`],
    ["update", "--id", "1", "--file", "hero.webp", "--alt", "", "--ai-metadata", "on"],
    ["update", "--id", "1", "--url", `${origin}/source`, "--filename", "../bad.webp"],
    ["update", "--id", "1", "--filename", "../invalid.webp"],
    ["update", "--id", "1", "--filename", ""],
    ["update", "--id", "1", "--alt", "Manual", "--ai-metadata", "on"],
  ]) {
    const count = calls.length;
    const result = await cli("files", ...args);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).code, "INVALID_ARGS");
    assert.equal(calls.length, count);
  }
});

void test("download failures are bounded, redact URLs, and clean up temporary files", async () => {
  for (const url of [
    `${origin}/missing?signature=secret`,
    `${origin}/loop`,
    `${origin}/oversized`,
    `${origin}/unsafe-redirect`,
    "file:///secret",
  ]) {
    const count = records.length;
    const result = await cli("files", "upload", "--url", url);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes("secret"), false);
    assert.equal(records.length, count);
    assert.deepEqual(await readdir(join(home, "tmp")), []);
  }
});

void test("update replaces local and remote content in one request, keeping IDs and omitted metadata", async () => {
  const original = success(await cli("files", "upload", "--file", "hero.webp", "--alt", "Keep me"));
  const id = String(original.id);
  const count = records.length;
  const replacement = success(
    await cli("files", "update", "--id", id, "--file", "hero.webp", "--json"),
  );
  assert.equal(replacement.id, original.id);
  assert.notEqual(replacement.url, original.url);
  assert.equal(replacement.alt, "Keep me");
  assert.equal(replacement.aiMetadataEnabled, false);
  assert.equal(records.length, count);
  const remote = success(
    await cli(
      "files",
      "update",
      "--id",
      id,
      "--url",
      `${origin}/redirect`,
      "--filename",
      "updated.webp",
      "--alt",
      "",
      "--production",
    ),
  );
  assert.equal(remote.id, original.id);
  assert.equal(remote.filename, "updated.webp");
  assert.equal(remote.alt, "");
  assert.equal(remote.aiMetadataEnabled, false);
  assert.equal(records.length, count);
  const request = calls.filter((call) => call.url === `/files/${id}/content`).at(-1);
  assert.equal(request.headers["x-environment-name"], "production");
  assert.equal(request.headers.authorization, "Bearer test-token");
  assert.equal(request.headers["x-camox-telemetry-disabled"], "1");
  assert.deepEqual(await readdir(join(home, "tmp")), []);
  assert.equal(success(await cli("files", "get", "--id", id)).url, remote.url);
  const enabled = success(
    await cli("files", "update", "--id", id, "--file", "hero.webp", "--ai-metadata", "on"),
  );
  assert.equal(enabled.aiMetadataEnabled, true);
  for (const args of [
    ["--url", `${origin}/missing?signature=secret`],
    ["--file", "hero.webp", "--filename", "fail.webp"],
  ]) {
    const result = await cli("files", "update", "--id", id, ...args);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes("secret"), false);
    assert.deepEqual(success(await cli("files", "get", "--id", id)), enabled);
  }
  assert.equal((await cli("files", "update", "--id", "999999", "--file", "hero.webp")).code, 1);
  const help = await cli("files", "update", "--help");
  assert.equal(help.code, 0);
  assert.ok(help.stdout.includes("--file"));
  assert.ok(help.stdout.includes("--url"));
  assert.ok(help.stdout.includes("every reference"));
});

void test("rejects oversized local files without uploading", async () => {
  const largeFile = await open(join(home, "large.webp"), "w");
  await largeFile.truncate(101 * 1024 * 1024);
  await largeFile.close();
  const count = records.length;
  const result = await cli("files", "upload", "--file", "large.webp");
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stderr).code, "FILE_TOO_LARGE");
  assert.equal(records.length, count);
});

void test("help documents sources, alt text and automatic metadata", async () => {
  const result = await cli("files", "upload", "--help");
  assert.equal(result.code, 0);
  for (const flag of ["--file", "--url", "--filename", "--alt", "--ai-metadata", "--production"]) {
    assert.ok(result.stdout.includes(flag), flag);
  }
});
