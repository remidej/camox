import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";

import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { createLogger, createServer, resolveConfig } from "vite-plus";

import type { DefinitionSet } from "@/core/createApp";

import { type CamoxPluginOptions, camox } from "./vite";

type AfterSync = NonNullable<NonNullable<CamoxPluginOptions["_internal"]>["afterSync"]>;

const AUTHENTICATION_URL = "http://dashboard.test";
const CHECKOUT_PROJECT_ID = "01a15fff-627b-7fa1-938b-93ab659c1acc";

function greetingModule(greeting: string) {
  return `export const greeting = ${JSON.stringify(greeting)};\n`;
}

/** A block module whose title defaults to the shared greeting. */
function blockModule(id: string, { toReact = "() => null" } = {}) {
  return `import { createBlock } from "camox/createBlock";

import { greeting } from "../fields/greeting";

export const block = createBlock({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(id)},
  description: "A block",
  content: (field) => ({ title: field.string({ default: greeting }) }),
  toReact: ${toReact},
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [content.title],
});
`;
}

/**
 * A checkout with a minimal Camox app and a dev session, plus a fake API that
 * accepts definition sync unless `failSync` is set, answering with `syncResult` over an empty one.
 */
async function devCheckout(
  t: TestContext,
  { failSync = false, syncResult = {} as Record<string, unknown> } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "camox-after-sync-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".camox"));
  await writeFile(
    join(root, ".camox/auth.json"),
    JSON.stringify({
      [AUTHENTICATION_URL]: { token: "dev-session", name: "Dev", email: "dev@camox.ai" },
    }),
  );
  await mkdir(join(root, "src/blocks"), { recursive: true });
  await mkdir(join(root, "src/fields"), { recursive: true });
  // A module the block's schema imports, like a shared field set.
  await writeFile(join(root, "src/fields/greeting.ts"), greetingModule("Welcome"));
  await writeFile(join(root, "src/blocks/hero.ts"), blockModule("hero"));

  const requests: { path: string; headers: IncomingHttpHeaders; input?: unknown }[] = [];
  /** The block ids each `definitions.sync` received, in order. */
  const syncedBlockIds: string[][] = [];
  /** Each block's default title, per `definitions.sync`, in order. */
  const syncedDefaultTitles: Record<string, unknown>[] = [];
  const base = os.$context<{ headers: IncomingHttpHeaders }>();
  const router = {
    definitions: {
      sync: base.handler(({ context, input }) => {
        requests.push({ path: "definitions.sync", headers: context.headers, input });
        if (failSync) throw new Error("definition sync failed");
        const { blocks } = (input as { definitionSet: DefinitionSet }).definitionSet;
        syncedBlockIds.push(blocks.map((definition) => definition.blockId).sort());
        syncedDefaultTitles.push(
          Object.fromEntries(
            blocks.map((d) => [d.blockId, (d.defaultContent as { title?: unknown }).title]),
          ),
        );
        return {
          draftCreated: false,
          blocks: { count: blocks.length, deletedDefinitionTypes: [] },
          collections: { count: 0, retired: [] },
          layouts: null,
          homepage: null,
          ...syncResult,
        };
      }),
    },
    collectionDefinitions: {
      list: base.handler(({ context, input }) => {
        requests.push({ path: "collectionDefinitions.list", headers: context.headers, input });
        return [];
      }),
      createRecord: base.handler(({ context, input }) => {
        requests.push({
          path: "collectionDefinitions.createRecord",
          headers: context.headers,
          input,
        });
        return { id: "record-1" };
      }),
    },
  };
  const handler = new RPCHandler(router);
  const api = createHttpServer(async (req, res) => {
    const { matched } = await handler.handle(req, res, {
      prefix: "/rpc",
      context: { headers: req.headers },
    });
    if (matched) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");

  const previousCwd = process.cwd();
  process.chdir(root);
  // Run newest first, so the dev server stops writing to root before root is removed.
  const cleanups: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    process.chdir(previousCwd);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    apiUrl: `http://127.0.0.1:${address.port}`,
    requests,
    syncedBlockIds,
    syncedDefaultTitles,
    cleanups,
  };
}

/** The deploy token apps/api's dev seed gives every project, which dev mode releases with. */
const LOCAL_DEPLOY_TOKEN = "local-deploy-token";

function devServerConfig(
  checkout: { root: string; apiUrl: string },
  internal: NonNullable<CamoxPluginOptions["_internal"]>,
  logger = createLogger("silent"),
) {
  return {
    configFile: false as const,
    root: checkout.root,
    customLogger: logger,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      // Sync runs in Node, so these tests need no Worker: only the name Camox checks for.
      { name: "vite-plugin-cloudflare" },
      camox({
        projectId: CHECKOUT_PROJECT_ID,
        _internal: {
          apiUrl: checkout.apiUrl,
          authenticationUrl: AUTHENTICATION_URL,
          ...internal,
        },
      }),
    ],
  };
}

async function startDevServer(
  checkout: { root: string; apiUrl: string; cleanups: (() => Promise<void>)[] },
  afterSync: AfterSync,
) {
  const logs: string[] = [];
  const logger = createLogger("silent");
  logger.info = (message) => logs.push(message);
  logger.warn = (message) => logs.push(message);
  logger.error = (message) => logs.push(message);
  const server = await createServer(
    devServerConfig(checkout, { afterSync, localDeployToken: LOCAL_DEPLOY_TOKEN }, logger),
  );
  checkout.cleanups.push(() => server.close());
  await server.listen();
  return { logs };
}

async function waitFor(condition: () => boolean, logs: string[]): Promise<void> {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) await setTimeout(20);
  assert.ok(condition(), logs.join("\n"));
}

void test("dev mode releases the app's definitions to Live with the deploy token, as a release does", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(checkout, () => {});

  await waitFor(() => syncCount(logs) === 1, logs);
  assert.deepEqual(
    checkout.requests.map(({ path, headers, input }) => ({
      path,
      draft: headers[DRAFT_HEADER],
      deployToken: (input as { deployToken?: unknown }).deployToken,
    })),
    [{ path: "definitions.sync", draft: undefined, deployToken: LOCAL_DEPLOY_TOKEN }],
  );
  assert.ok(logs.some((line) => line.includes("Running Camox app (local Live)")));
});

void test("afterSync seeds as the dev user in a regular draft, which its first content write starts", async (t) => {
  const checkout = await devCheckout(t);
  const calls: Parameters<AfterSync>[0][] = [];
  const { logs } = await startDevServer(checkout, async (context) => {
    calls.push(context);
    const scope = { projectUuid: context.projectUuid, collectionId: "articles" };
    await context.client.collectionDefinitions.list({ projectUuid: context.projectUuid });
    await context.client.collectionDefinitions.createRecord({ ...scope, content: {} });
    await context.client.collectionDefinitions.createRecord({ ...scope, content: {} });
    await context.client.collectionDefinitions.list({ projectUuid: context.projectUuid });
  });

  const seeding = () => checkout.requests.filter((r) => r.path !== "definitions.sync");
  await waitFor(() => seeding().length === 4, logs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.projectUuid, CHECKOUT_PROJECT_ID);
  const sent = seeding().map(({ path, headers }) => ({
    path,
    session: headers.authorization,
    draft: headers[DRAFT_HEADER],
    create: headers[DRAFT_CREATE_HEADER],
  }));
  const draft = sent[1]!.draft;
  assert.ok(uuidv7Schema.safeParse(draft).success, String(draft));
  const session = "Bearer dev-session";
  assert.deepEqual(sent, [
    // Before any write, the draft doesn't exist, so reads see Live and seeding that finds its
    // content starts nothing.
    { path: "collectionDefinitions.list", session, draft: undefined, create: undefined },
    { path: "collectionDefinitions.createRecord", session, draft, create: "1" },
    { path: "collectionDefinitions.createRecord", session, draft, create: "1" },
    // Once a write started it, reads see the draft.
    { path: "collectionDefinitions.list", session, draft, create: undefined },
  ]);
});

void test("a release syncs the app's blocks to Live: its requests name no draft", async (t) => {
  const checkout = await devCheckout(t);
  for (const [name, value] of Object.entries({
    CAMOX_INTERNAL_RELEASE: "1",
    CAMOX_DEPLOY_TOKEN: "deploy-token",
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const plugin = camox({
    projectId: CHECKOUT_PROJECT_ID,
    _internal: { apiUrl: checkout.apiUrl, authenticationUrl: AUTHENTICATION_URL },
  });
  // Resolving the config runs the plugin's config hooks the way `vite build` does.
  await resolveConfig(
    {
      configFile: false,
      root: checkout.root,
      logLevel: "silent",
      plugins: [{ name: "vite-plugin-cloudflare" }, plugin],
    },
    "build",
  );

  await (plugin.closeBundle as () => Promise<void>)();

  assert.deepEqual(checkout.syncedBlockIds, [["hero"]]);
  assert.deepEqual(
    checkout.requests.map(({ path, headers }) => ({ path, draft: headers[DRAFT_HEADER] })),
    [{ path: "definitions.sync", draft: undefined }],
  );
});

void test("a dry-run release builds without a login or a Deploy Token, and syncs nothing", async (t) => {
  const checkout = await devCheckout(t);
  // Nobody is logged in where the upgrade job builds a project.
  await rm(join(checkout.root, ".camox"), { recursive: true });
  for (const [name, value] of Object.entries({
    CAMOX_INTERNAL_RELEASE: "dry-run",
    CAMOX_DEPLOY_TOKEN: undefined,
  })) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const plugin = camox({
    projectId: CHECKOUT_PROJECT_ID,
    _internal: { apiUrl: checkout.apiUrl, authenticationUrl: AUTHENTICATION_URL },
  });

  await resolveConfig(
    {
      configFile: false,
      root: checkout.root,
      logLevel: "silent",
      plugins: [{ name: "vite-plugin-cloudflare" }, plugin],
    },
    "build",
  );
  await (plugin.closeBundle as () => Promise<void>)();

  assert.deepEqual(checkout.requests, []);
});

void test("the dev server skips afterSync when definition sync fails", async (t) => {
  const checkout = await devCheckout(t, { failSync: true });
  let calls = 0;
  const { logs } = await startDevServer(checkout, () => {
    calls++;
  });

  await waitFor(() => logs.some((line) => line.includes("Failed to sync")), logs);
  await setTimeout(100);
  assert.equal(calls, 0);
});

void test("an afterSync failure is contained as a warning instead of rejecting", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(checkout, () => {
    throw new Error("seeding exploded");
  });

  await waitFor(() => logs.some((line) => line.includes("seeding exploded")), logs);
  const warning = logs.find((line) => line.includes("seeding exploded"))!;
  assert.match(warning, /\[camox\] afterSync failed/);
});

/** Each request's path and the draft it named, or Live when it named none. */
function requestLog(requests: { path: string; headers: IncomingHttpHeaders }[]) {
  return requests.map(({ path, headers }) => `${path} ${String(headers[DRAFT_HEADER] ?? "live")}`);
}

/** Starts a dev server and expects it refused; one that wrongly starts is closed again. */
async function assertDevModeRefused(config: Parameters<typeof createServer>[0]) {
  await assert.rejects(
    createServer(config).then(async (server) => {
      await server.close();
    }),
    /code reaches Camox through drafts and Upgrades/,
  );
}

void test("dev mode refuses to start without the deploy token", async (t) => {
  const checkout = await devCheckout(t);

  await assertDevModeRefused(devServerConfig(checkout, {}));
  assert.deepEqual(checkout.requests, []);
});

void test("dev mode refuses to start against an API that isn't local, even with the deploy token", async (t) => {
  const checkout = await devCheckout(t);

  await assertDevModeRefused(
    devServerConfig(
      { ...checkout, apiUrl: "https://api.camox.ai" },
      { localDeployToken: LOCAL_DEPLOY_TOKEN },
    ),
  );
});

/** How many whole-set syncs reached the API's block definitions, judging by the dev logs. */
function syncCount(logs: string[]) {
  return logs.filter((line) => /Synced \d+ Camox definition/.test(line)).length;
}

/** Long enough for the dev server to notice a file change and finish any sync it causes. */
const SETTLE_MS = 600;

void test("changing a module a block's schema imports syncs the new Definition Set", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(checkout, () => {});
  await waitFor(() => syncCount(logs) === 1, logs);

  await writeFile(join(checkout.root, "src/fields/greeting.ts"), greetingModule("Hello"));

  await waitFor(() => syncCount(logs) === 2, logs);
  assert.deepEqual(checkout.syncedDefaultTitles, [{ hero: "Welcome" }, { hero: "Hello" }]);
});

void test("a change that leaves the Definition Set equal sends no sync", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(checkout, () => {});
  await waitFor(() => syncCount(logs) === 1, logs);
  const requestsAfterFirstSync = checkout.requests.length;

  // Styling work: the component changes, no definition does.
  await writeFile(
    join(checkout.root, "src/blocks/hero.ts"),
    blockModule("hero", { toReact: '() => "styled"' }),
  );
  await setTimeout(SETTLE_MS);
  assert.equal(checkout.requests.length, requestsAfterFirstSync);

  // A definition change afterwards still syncs, so the dev server was watching all along.
  await writeFile(join(checkout.root, "src/fields/greeting.ts"), greetingModule("Hello"));
  await waitFor(() => syncCount(logs) === 2, logs);
  assert.deepEqual(checkout.syncedDefaultTitles, [{ hero: "Welcome" }, { hero: "Hello" }]);
});

void test("adding or deleting a block file leads to one whole-set sync each", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(checkout, () => {});
  await waitFor(() => syncCount(logs) === 1, logs);

  await writeFile(join(checkout.root, "src/blocks/cta.ts"), blockModule("cta"));
  await waitFor(() => syncCount(logs) === 2, logs);
  await setTimeout(SETTLE_MS);

  await rm(join(checkout.root, "src/blocks/cta.ts"));
  await waitFor(() => syncCount(logs) === 3, logs);
  await setTimeout(SETTLE_MS);

  assert.deepEqual(checkout.syncedBlockIds, [["hero"], ["cta", "hero"], ["hero"]]);
  assert.deepEqual(
    requestLog(checkout.requests),
    Array.from({ length: 3 }, () => "definitions.sync live"),
  );
});

void test("the dev server logs what one sync changed, as the API reports it", async (t) => {
  const checkout = await devCheckout(t, {
    syncResult: {
      blocks: { count: 1, deletedDefinitionTypes: ["quote"] },
      collections: { count: 0, retired: ["authors"] },
      layouts: {
        count: 1,
        layouts: [
          {
            layoutId: "default",
            wasExisting: true,
            createdBlockTypes: ["navbar"],
            removedBlockTypes: ["banner"],
            skippedOrphanTypes: ["hero"],
          },
        ],
        removedLayoutIds: ["landing"],
        deletedDefinitionTypes: ["banner"],
      },
    },
  });
  const { logs } = await startDevServer(checkout, () => {});

  await waitFor(() => syncCount(logs) === 1, logs);
  for (const expected of [
    "Synced 2 Camox definitions",
    'Removed 1 block definition no longer in code: "quote"',
    'Removed collection "authors"; its records are kept and hidden',
    'Added 1 block to existing layout "default": "navbar"',
    'Removed 1 layoutOnly block from layout "default": "banner"',
    'Layout "default" has 1 block still in DB but removed from code: "hero"',
    'Removed layout "landing"; its pages are kept and listed as needing a layout',
    'Removed 1 layoutOnly block definition (no layout uses it anymore): "banner"',
  ]) {
    assert.ok(
      logs.some((line) => line.includes(expected)),
      `${expected}\n---\n${logs.join("\n")}`,
    );
  }
});
