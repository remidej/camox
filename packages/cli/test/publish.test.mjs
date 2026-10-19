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

// `camox publish`, `camox discard` and `camox status` against a fake API holding one
// development draft (ADR 0009, ADR 0010).

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const PAGE = { kind: "page", id: "page-1", path: "/about", nickname: "About" };
let home;
let server;
let api;

const subject = (id, label) => ({ entity: "block", id, label, owner: PAGE });

/** The fake API's state: the draft's list, and which conflicts Live has now. */
function freshApi() {
  return {
    draftExists: true,
    liveConflicts: 0,
    changes: [
      { ...subject("block-1", "Hero"), change: "changed" },
      { ...subject("block-2", "Quote"), change: "created" },
    ],
    published: 0,
    discarded: 0,
    toolCalls: [],
    translating: [],
    publishArgs: null,
  };
}

function preview() {
  const conflicts = Array.from({ length: api.liveConflicts }, (_, i) => ({
    ...subject(`conflict-${i}`, `Theirs ${i}`),
    liveVersion: 2,
    publishedBy: { id: "ada", name: "Ada" },
    publishedAt: 1_700_000_000_000,
    release: false,
  }));
  return {
    blockers: [
      {
        entity: "definition",
        id: "block:hero",
        label: "Hero",
        owner: null,
        code: "definitionsDiffer",
        field: "",
        message: "Differs from Live's definition: release it first",
      },
    ],
    conflicts,
    lost: [{ ...subject("item-1", "Link"), reason: "parentGone" }],
    warnings: [
      {
        ...subject("block-3", "Old"),
        code: "danglingReference",
        field: "author",
        message: "Points at nothing",
      },
    ],
    changes: api.changes,
    translating: api.translating,
    token: `token-${api.liveConflicts}`,
  };
}

function tool(name, args) {
  api.toolCalls.push(name);
  switch (name) {
    case "previewPublish":
      return { ok: true, result: preview() };
    case "publishDraft":
      if (args.token !== preview().token) {
        return {
          ok: true,
          result: {
            published: false,
            reason: "conflictsChanged",
            message: "Live changed since the preview.",
            preview: preview(),
          },
        };
      }
      if (api.discardedBy) {
        const endedBy = { id: "ada", name: api.discardedBy };
        return {
          ok: true,
          result: {
            published: false,
            reason: "discarded",
            message: `${api.discardedBy} discarded the draft.`,
            ended: { draftId: "draft-1", outcome: "discarded", endedBy, endedAt: 1 },
          },
        };
      }
      if (api.translating.length > 0 && !args.publishAnyway) {
        return {
          ok: true,
          result: {
            published: false,
            reason: "translating",
            message: "Translations into de are still running.",
            preview: preview(),
          },
        };
      }
      api.publishArgs = args;
      if (api.changes.length === 0) {
        return {
          ok: true,
          result: { published: false, reason: "empty", message: "The draft has no changes." },
        };
      }
      api.published += 1;
      api.changes = [];
      return { ok: true, result: { published: true, ended: null } };
    case "discardDraft":
      api.discarded += 1;
      api.changes = [];
      return { ok: true, result: { ended: null } };
    default:
      return { ok: false, error: { code: "UNKNOWN_TOOL", message: name } };
  }
}

const NO_DRAFT = {
  defined: false,
  code: "NO_DEVELOPMENT_DRAFT",
  status: 404,
  message: "No development draft",
};

before(async () => {
  home = await mkdtemp(join(tmpdir(), "camox-publish-test-"));
  await mkdir(join(home, ".camox"));
  await mkdir(join(home, "node_modules/.camox"), { recursive: true });
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const input = body ? JSON.parse(body).json : undefined;
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/rpc/projects/getBySlug")) {
      res.end(JSON.stringify({ json: { id: 7 } }));
      return;
    }
    if (req.url.startsWith("/rpc/drafts/get")) {
      if (!api.draftExists) {
        res.statusCode = 404;
        res.end(JSON.stringify({ json: NO_DRAFT }));
        return;
      }
      res.end(JSON.stringify({ json: { changeCount: api.changes.length } }));
      return;
    }
    if (req.url.startsWith("/rpc/agent/callTool")) {
      res.end(JSON.stringify({ json: tool(input.name, input.arguments ?? {}) }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
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
    JSON.stringify({ projectSlug: "test", apiUrl: origin, authenticationUrl: origin }),
  );
});

beforeEach(() => {
  api = freshApi();
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

void test("publish prints the full list and a token without publishing", async () => {
  const result = await cli("publish", "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), preview());
  assert.deepEqual(api.toolCalls, ["previewPublish"]);
  assert.equal(api.published, 0);
});

void test("publish --confirm with the printed token publishes", async () => {
  const { token } = JSON.parse((await cli("publish", "--json")).stdout);

  const result = await cli("publish", "--confirm", token, "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).published, true);
  assert.equal(api.published, 1);
});

void test("a stale token publishes nothing, reprints the new list and fails", async () => {
  const { token } = JSON.parse((await cli("publish", "--json")).stdout);
  // Another draft published a conflicting change since the list was printed.
  api.liveConflicts = 1;

  const result = await cli("publish", "--confirm", token, "--json");

  assert.notEqual(result.code, 0);
  assert.equal(api.published, 0);
  assert.equal(JSON.parse(result.stderr).code, "CONFLICTS_CHANGED");
  const reprinted = JSON.parse(result.stdout);
  assert.deepEqual(reprinted, preview());
  assert.notEqual(reprinted.token, token);
  assert.equal(reprinted.conflicts.length, 1);

  const retried = await cli("publish", "--confirm", reprinted.token, "--json");
  assert.equal(retried.code, 0, retried.stderr);
  assert.equal(api.published, 1);
});

void test("publish --confirm while translations run publishes nothing, reprints the list and fails", async () => {
  api.translating = ["de"];
  const { token } = JSON.parse((await cli("publish", "--json")).stdout);

  const result = await cli("publish", "--confirm", token, "--json");

  assert.notEqual(result.code, 0);
  assert.equal(api.published, 0);
  assert.equal(JSON.parse(result.stderr).code, "TRANSLATIONS_PENDING");
  assert.deepEqual(JSON.parse(result.stdout).translating, ["de"]);
});

void test("publish --confirm --anyway publishes while translations run", async () => {
  api.translating = ["de"];
  const { token } = JSON.parse((await cli("publish", "--json")).stdout);

  const result = await cli("publish", "--confirm", token, "--anyway", "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.equal(api.published, 1);
  assert.equal(api.publishArgs.publishAnyway, true);
});

void test("publish --confirm on a draft without changes says nothing was published", async () => {
  const { token } = JSON.parse((await cli("publish", "--json")).stdout);
  api.changes = [];

  const result = await cli("publish", "--confirm", token, "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.published, false);
  assert.equal(printed.reason, "empty");
  assert.equal(api.published, 0);
});

void test("publish --confirm on a discarded draft fails and says nothing was published", async () => {
  const { token } = JSON.parse((await cli("publish", "--json")).stdout);
  api.discardedBy = "Ada";

  const result = await cli("publish", "--confirm", token, "--json");

  assert.notEqual(result.code, 0);
  assert.equal(api.published, 0);
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, "DRAFT_ENDED");
  assert.match(error.message, /Ada discarded/);
  assert.match(error.message, /Nothing was published/);
});

void test("discard --yes empties the development draft", async () => {
  const result = await cli("discard", "--yes", "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.equal(api.discarded, 1);
  assert.deepEqual(api.changes, []);
});

void test("discard without --yes asks for confirmation, and outside a terminal refuses", async () => {
  const result = await cli("discard", "--json");

  assert.notEqual(result.code, 0);
  assert.equal(JSON.parse(result.stderr).code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(api.toolCalls, []);
  assert.equal(api.discarded, 0);
});

void test("status reports that the development draft exists and how many changes it holds", async () => {
  const result = await cli("status", "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).developmentDraft, {
    exists: true,
    changeCount: 2,
  });

  await cli("discard", "--yes");
  const emptied = JSON.parse((await cli("status", "--json")).stdout);
  assert.deepEqual(emptied.developmentDraft, { exists: true, changeCount: 0 });
});

void test("status reports a development draft that doesn't exist yet", async () => {
  api.draftExists = false;

  const result = await cli("status", "--json");

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).developmentDraft, {
    exists: false,
    changeCount: 0,
  });
});

void test("status works when not signed in", async () => {
  const result = await cli("status", "--json", "--cwd", home);
  assert.equal(result.code, 0, result.stderr);

  const signedOut = await mkdtemp(join(tmpdir(), "camox-publish-test-signed-out-"));
  try {
    await mkdir(join(signedOut, "node_modules/.camox"), { recursive: true });
    await writeFile(
      join(signedOut, "node_modules/.camox/runtime.json"),
      JSON.stringify({
        projectSlug: "test",
        apiUrl: "http://127.0.0.1:1",
        authenticationUrl: "http://127.0.0.1:1",
      }),
    );
    const status = await exec(process.execPath, [binary, "status", "--json"], {
      cwd: signedOut,
      env: { ...process.env, HOME: signedOut, CAMOX_PROJECT: "" },
    });
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.authenticated, false);
    assert.equal(parsed.developmentDraft, null);
  } finally {
    await rm(signedOut, { recursive: true, force: true });
  }
});
