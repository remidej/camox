import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";

import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
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
function blockModule(id: string, { component = "() => null" } = {}) {
  return `import { createBlock } from "camox/createBlock";

import { greeting } from "../fields/greeting";

export const block = createBlock({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(id)},
  description: "A block",
  content: (field) => ({ title: field.string({ default: greeting }) }),
  component: ${component},
  toMarkdown: (content) => [content.title],
});
`;
}

/**
 * A checkout with a minimal Camox app and a dev session, plus a fake API that
 * accepts definition sync unless `failSync` is set, answering with `syncResult` over an empty one.
 */
async function devCheckout(
  t: TestContext,
  {
    failSync = false,
    draftCreated = false,
    livePages = 0,
    blockers = [] as string[],
    syncResult = {} as Record<string, unknown>,
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "camox-after-sync-"));
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".camox"));
  await writeFile(
    join(root, ".camox/auth.json"),
    JSON.stringify({
      [AUTHENTICATION_URL]: { token: "dev-session", name: "Dev", email: "dev@camox.dev" },
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
          draftCreated,
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
    },
    pages: {
      listBySlug: base.handler(({ context, input }) => {
        requests.push({ path: "pages.listBySlug", headers: context.headers, input });
        return {
          projectName: "Test project",
          pages: Array.from({ length: livePages }, (_, id) => ({ id })),
        };
      }),
    },
    projects: {
      getBySlug: base.handler(({ context, input }) => {
        requests.push({ path: "projects.getBySlug", headers: context.headers, input });
        return { id: 1 };
      }),
    },
    drafts: {
      previewPublish: base.handler(({ context }) => {
        requests.push({ path: "drafts.previewPublish", headers: context.headers });
        return {
          blockers: blockers.map((message) => ({ message })),
          changes: [{ id: "seeded" }],
          token: "preview-token",
        };
      }),
      publish: base.handler(({ context }) => {
        requests.push({ path: "drafts.publish", headers: context.headers });
        return { empty: false, ended: null };
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

async function startDevServer(
  checkout: { root: string; apiUrl: string; cleanups: (() => Promise<void>)[] },
  afterSync: AfterSync,
  seedLiveDeployToken?: string,
) {
  const logs: string[] = [];
  const logger = createLogger("silent");
  logger.info = (message) => logs.push(message);
  logger.warn = (message) => logs.push(message);
  logger.error = (message) => logs.push(message);
  const server = await createServer({
    configFile: false,
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
          afterSync,
          seedLiveDeployToken,
        },
      }),
    ],
  });
  checkout.cleanups.push(() => server.close());
  await server.listen();
  return { logs };
}

async function waitFor(condition: () => boolean, logs: string[]): Promise<void> {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) await setTimeout(20);
  assert.ok(condition(), logs.join("\n"));
}

void test("the dev server syncs definitions and runs afterSync in the dev user's development draft", async (t) => {
  const checkout = await devCheckout(t);
  const calls: Parameters<AfterSync>[0][] = [];
  const { logs } = await startDevServer(checkout, async (context) => {
    calls.push(context);
    await context.client.collectionDefinitions.list({ projectUuid: context.projectUuid });
  });

  const afterSync = () => checkout.requests.find((r) => r.path === "collectionDefinitions.list");
  await waitFor(() => !!afterSync(), logs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.projectUuid, CHECKOUT_PROJECT_ID);
  assert.ok(logs.some((line) => line.includes("Synced 0 collection definitions")));
  assert.deepEqual(
    checkout.requests.map(({ path, headers }) => ({
      path,
      session: headers.authorization,
      draft: headers[DRAFT_HEADER],
    })),
    ["definitions.sync", "collectionDefinitions.list"].map((path) => ({
      path,
      session: "Bearer dev-session",
      draft: DEVELOPMENT_DRAFT,
    })),
  );
  assert.ok(!logs.some((line) => line.includes("Created your development draft")));
});

void test("the dev server syncs the app's blocks without writing an app file", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(checkout, () => {});

  await waitFor(() => logs.some((line) => line.includes("Synced 1 block definition")), logs);
  assert.deepEqual(checkout.syncedBlockIds, [["hero"]]);
  assert.ok(!existsSync(join(checkout.root, "src/camox/app.ts")));
});

void test("the dev server says when its first sync created the development draft", async (t) => {
  const checkout = await devCheckout(t, { draftCreated: true });
  const { logs } = await startDevServer(checkout, () => {});

  await waitFor(() => logs.some((line) => line.includes("Synced 0 collection definitions")), logs);
  assert.ok(logs.some((line) => line.includes("Created your development draft")));
  assert.ok(logs.some((line) => line.includes("Running Camox app (your development draft)")));
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

void test("on an empty Live, the dev server releases first and publishes what afterSync seeded", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(
    checkout,
    async (context) => {
      await context.client.collectionDefinitions.list({ projectUuid: context.projectUuid });
    },
    "deploy-token",
  );

  await waitFor(() => checkout.requests.some((r) => r.path === "drafts.publish"), logs);
  assert.deepEqual(requestLog(checkout.requests), [
    "pages.listBySlug live",
    "definitions.sync live",
    `definitions.sync ${DEVELOPMENT_DRAFT}`,
    `collectionDefinitions.list ${DEVELOPMENT_DRAFT}`,
    `projects.getBySlug ${DEVELOPMENT_DRAFT}`,
    `drafts.previewPublish ${DEVELOPMENT_DRAFT}`,
    `drafts.publish ${DEVELOPMENT_DRAFT}`,
  ]);
});

void test("seeding an empty Live names the project by its Project ID, never its slug", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(
    checkout,
    async (context) => {
      await context.client.collectionDefinitions.list({ projectUuid: context.projectUuid });
    },
    "deploy-token",
  );

  await waitFor(() => checkout.requests.some((r) => r.path === "drafts.publish"), logs);
  // Drafts are named by the project's integer id, which the project load returned.
  const namingProject = checkout.requests.filter(({ path }) => !path.startsWith("drafts."));
  assert.deepEqual(
    namingProject.map(({ path, input }) => {
      const { projectUuid, projectSlug, slug } = input as Record<string, unknown>;
      return { path, projectUuid, projectSlug, slug };
    }),
    [
      "pages.listBySlug",
      "definitions.sync",
      "definitions.sync",
      "collectionDefinitions.list",
      "projects.getBySlug",
    ].map((path) => ({
      path,
      projectUuid: CHECKOUT_PROJECT_ID,
      projectSlug: undefined,
      slug: undefined,
    })),
  );
});

void test("when Live has pages, the dev server neither releases nor publishes", async (t) => {
  const checkout = await devCheckout(t, { livePages: 1 });
  let ran = false;
  const { logs } = await startDevServer(
    checkout,
    () => {
      ran = true;
    },
    "deploy-token",
  );

  await waitFor(() => ran, logs);
  await setTimeout(100);
  assert.deepEqual(requestLog(checkout.requests), [
    "pages.listBySlug live",
    `definitions.sync ${DEVELOPMENT_DRAFT}`,
  ]);
});

void test("seeded content stays in the development draft when publishing it is blocked", async (t) => {
  const checkout = await devCheckout(t, { blockers: ["The page needs a meta title"] });
  const { logs } = await startDevServer(checkout, () => {}, "deploy-token");

  await waitFor(() => logs.some((line) => line.includes("publishing is blocked")), logs);
  assert.ok(logs.some((line) => line.includes("The page needs a meta title")));
  assert.ok(!checkout.requests.some((r) => r.path === "drafts.publish"));
});

/** How many whole-set syncs reached the API's block definitions, judging by the dev logs. */
function syncCount(logs: string[]) {
  return logs.filter((line) => /Synced \d+ block definition/.test(line)).length;
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
    blockModule("hero", { component: '() => "styled"' }),
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
    Array.from({ length: 3 }, () => `definitions.sync ${DEVELOPMENT_DRAFT}`),
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
