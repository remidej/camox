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
// UUIDv7s, as the API mints them.
const PAGE_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7a";
const BLOCK_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7c";
const OTHER_BLOCK_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7d";
const source = `<!doctype html>
<title>Orbit "demo"</title>
<script type="module">
  import { animate } from "https://esm.sh/motion@12.0.0";
  animate("h1", { opacity: [0, 1] }); // \\n stays literal
</script>
`;
let home;
let server;

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-blocks-test-"));
  await mkdir(join(home, ".camox"));
  await mkdir(join(home, "node_modules/.camox"), { recursive: true });
  await writeFile(join(home, "orbit.html"), source);
  await writeFile(join(home, "caption.txt"), "Caption from a file\n");
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const input = body ? JSON.parse(body).json : undefined;
    calls.push({ url: req.url, input });
    res.setHeader("Content-Type", "application/json");
    // A tool call answers with the arguments it received, so a command's output shows what it sent.
    const result = input?.arguments ?? { id: BLOCK_ID };
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
      ...(await exec(process.execPath, [binary, "blocks", ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, CAMOX_PROJECT: "" },
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

void test("edit sets a field to a file's raw contents", async () => {
  const result = await cli("edit", "--id", BLOCK_ID, "--field-file", "source=orbit.html");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(calls.at(-1).input.name, "editBlock");
  assert.deepEqual(calls.at(-1).input.arguments, { id: BLOCK_ID, content: { source } });
});

void test("create sets several fields from repeated --field-file flags", async () => {
  const result = await cli(
    "create",
    "--page-id",
    PAGE_ID,
    "--type",
    "hero",
    "--field-file",
    "source=orbit.html",
    "--field-file",
    "caption=caption.txt",
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(calls.at(-1).input.name, "createBlock");
  assert.deepEqual(calls.at(-1).input.arguments.content, {
    source,
    caption: "Caption from a file\n",
  });
});

void test("--field-file merges with --content and wins on conflicts", async () => {
  for (const command of [
    ["create", "--page-id", PAGE_ID, "--type", "hero"],
    ["edit", "--id", BLOCK_ID],
  ]) {
    const result = await cli(
      ...command,
      "--content",
      JSON.stringify({ title: "Orbit", caption: "From JSON" }),
      "--field-file",
      "caption=caption.txt",
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(calls.at(-1).input.arguments.content, {
      title: "Orbit",
      caption: "Caption from a file\n",
    });
  }
});

void test("a missing file fails with a clear error before anything is written", async () => {
  for (const command of [
    ["create", "--page-id", PAGE_ID, "--type", "hero"],
    ["edit", "--id", BLOCK_ID],
  ]) {
    const count = calls.length;
    const result = await cli(
      ...command,
      "--field-file",
      "source=orbit.html",
      "--field-file",
      "caption=missing.txt",
      "--json",
    );
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(calls.length, count);
    const error = JSON.parse(result.stderr);
    assert.match(error.message, /missing\.txt/);
    assert.match(error.message, /caption/);
  }
});

void test("create and edit help document --field-file", async () => {
  for (const command of ["create", "edit"]) {
    const help = await cli(command, "--help");
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--field-file/);
    assert.match(help.stdout, /raw contents/);
  }
});

void test("takes and prints block and page ids as UUIDv7s", async () => {
  for (const { args, name, expected } of [
    { args: ["get", "--id", BLOCK_ID], name: "getBlock", expected: { id: BLOCK_ID } },
    {
      args: ["get-many", "--id", BLOCK_ID, "--id", OTHER_BLOCK_ID],
      name: "getBlocks",
      expected: { ids: [BLOCK_ID, OTHER_BLOCK_ID] },
    },
    {
      args: [
        "create",
        "--page-id",
        PAGE_ID,
        "--type",
        "hero",
        "--content",
        "{}",
        "--after-id",
        OTHER_BLOCK_ID,
      ],
      name: "createBlock",
      expected: { pageId: PAGE_ID, type: "hero", content: {}, afterId: OTHER_BLOCK_ID },
    },
    {
      args: ["move", "--id", BLOCK_ID, "--before-id", OTHER_BLOCK_ID],
      name: "moveBlock",
      expected: { id: BLOCK_ID, beforeId: OTHER_BLOCK_ID },
    },
    { args: ["delete", "--id", BLOCK_ID], name: "deleteBlock", expected: { id: BLOCK_ID } },
  ]) {
    const result = await cli(...args, "--json");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(calls.at(-1).input.name, name);
    assert.deepEqual(calls.at(-1).input.arguments, expected);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
});

void test("rejects a block or page id that isn't a UUIDv7 before making requests", async () => {
  for (const id of ["5", "abc", "2b0f6c2e-4a1d-4c6e-9b8a-3f2e1d0c9b8a"]) {
    for (const args of [
      ["get", "--id", id],
      ["get-many", "--id", BLOCK_ID, "--id", id],
      ["create", "--page-id", id, "--type", "hero"],
      ["create", "--page-id", PAGE_ID, "--type", "hero", "--before-id", id],
      ["edit", "--id", id, "--content", "{}"],
      ["move", "--id", id, "--position", "first"],
      ["move", "--id", BLOCK_ID, "--after-id", id],
      ["delete", "--id", id],
    ]) {
      const count = calls.length;
      const result = await cli(...args);
      assert.notEqual(result.code, 0, args.join(" "));
      assert.match(result.stderr, /UUIDv7/, args.join(" "));
      assert.equal(calls.length, count, args.join(" "));
    }
  }
});
