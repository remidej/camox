import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";

import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { createLogger, createServer } from "vite-plus";

import { syncDefinitionsToApi } from "./definitionsSync";
import { type CamoxPluginOptions, camox } from "./vite";

type AfterSync = NonNullable<NonNullable<CamoxPluginOptions["_internal"]>["afterSync"]>;

const AUTHENTICATION_URL = "http://dashboard.test";

/**
 * A checkout with a minimal Camox app and a dev session, plus a fake API that
 * accepts definition sync unless `failCollectionSync` is set.
 */
async function devCheckout(
  t: TestContext,
  {
    failCollectionSync = false,
    draftCreated = false,
    livePages = 0,
    blockers = [] as string[],
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
  await mkdir(join(root, "src/camox"), { recursive: true });
  await writeFile(
    join(root, "src/camox/app.ts"),
    `export const camoxApp = {
      getBlocks: () => [],
      getSerializableLayoutDefinitions: () => [],
      getSerializableCollectionDefinitions: () => [],
      getInitialPageBundles: () => null,
    };`,
  );

  const requests: { path: string; headers: IncomingHttpHeaders }[] = [];
  const base = os.$context<{ headers: IncomingHttpHeaders }>();
  const router = {
    blockDefinitions: {
      sync: base.handler(({ context }) => {
        requests.push({ path: "blockDefinitions.sync", headers: context.headers });
        return { results: [], draftCreated, deletedDefinitionTypes: [] };
      }),
    },
    collectionDefinitions: {
      sync: base.handler(({ context }) => {
        requests.push({ path: "collectionDefinitions.sync", headers: context.headers });
        if (failCollectionSync) throw new Error("collection sync failed");
        return { count: 0, retired: [] };
      }),
      list: base.handler(({ context }) => {
        requests.push({ path: "collectionDefinitions.list", headers: context.headers });
        return [];
      }),
    },
    pages: {
      listBySlug: base.handler(({ context }) => {
        requests.push({ path: "pages.listBySlug", headers: context.headers });
        return {
          projectName: "Test project",
          pages: Array.from({ length: livePages }, (_, id) => ({ id })),
        };
      }),
    },
    projects: {
      getBySlug: base.handler(() => ({ id: 1 })),
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

  return { root, apiUrl: `http://127.0.0.1:${address.port}`, requests, cleanups };
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
        projectSlug: "checkout",
        _internal: {
          apiUrl: checkout.apiUrl,
          authenticationUrl: AUTHENTICATION_URL,
          disableCodeGen: true,
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
    await context.client.collectionDefinitions.list({ projectSlug: context.projectSlug });
  });

  const afterSync = () => checkout.requests.find((r) => r.path === "collectionDefinitions.list");
  await waitFor(() => !!afterSync(), logs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.projectSlug, "checkout");
  assert.ok(logs.some((line) => line.includes("Synced 0 collection definitions")));
  assert.deepEqual(
    checkout.requests.map(({ path, headers }) => ({
      path,
      session: headers.authorization,
      draft: headers[DRAFT_HEADER],
    })),
    ["blockDefinitions.sync", "collectionDefinitions.sync", "collectionDefinitions.list"].map(
      (path) => ({
        path,
        session: "Bearer dev-session",
        draft: DEVELOPMENT_DRAFT,
      }),
    ),
  );
  assert.ok(!logs.some((line) => line.includes("Created your development draft")));
});

void test("the dev server says when its first sync created the development draft", async (t) => {
  const checkout = await devCheckout(t, { draftCreated: true });
  const { logs } = await startDevServer(checkout, () => {});

  await waitFor(() => logs.some((line) => line.includes("Synced 0 collection definitions")), logs);
  assert.ok(logs.some((line) => line.includes("Created your development draft")));
  assert.ok(logs.some((line) => line.includes("Running Camox app (your development draft)")));
});

void test("a release syncs Live's definitions: its requests name no draft", async (t) => {
  const checkout = await devCheckout(t);
  const camoxApp = {
    getBlocks: () => [],
    getSerializableLayoutDefinitions: () => [],
    getSerializableCollectionDefinitions: () => [],
    getInitialPageBundles: async () => null,
  } as unknown as Parameters<typeof syncDefinitionsToApi>[0]["camoxApp"];

  await syncDefinitionsToApi({
    camoxApp,
    projectSlug: "checkout",
    apiUrl: checkout.apiUrl,
    autoCreate: false,
    deployToken: "deploy-token",
    logger: createLogger("silent"),
  });

  assert.deepEqual(
    checkout.requests.map(({ path, headers }) => ({ path, draft: headers[DRAFT_HEADER] })),
    [
      { path: "blockDefinitions.sync", draft: undefined },
      { path: "collectionDefinitions.sync", draft: undefined },
    ],
  );
});

void test("the dev server skips afterSync when definition sync fails", async (t) => {
  const checkout = await devCheckout(t, { failCollectionSync: true });
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
      await context.client.collectionDefinitions.list({ projectSlug: context.projectSlug });
    },
    "deploy-token",
  );

  await waitFor(() => checkout.requests.some((r) => r.path === "drafts.publish"), logs);
  assert.deepEqual(requestLog(checkout.requests), [
    "pages.listBySlug live",
    "blockDefinitions.sync live",
    "collectionDefinitions.sync live",
    `blockDefinitions.sync ${DEVELOPMENT_DRAFT}`,
    `collectionDefinitions.sync ${DEVELOPMENT_DRAFT}`,
    `collectionDefinitions.list ${DEVELOPMENT_DRAFT}`,
    `drafts.previewPublish ${DEVELOPMENT_DRAFT}`,
    `drafts.publish ${DEVELOPMENT_DRAFT}`,
  ]);
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
    `blockDefinitions.sync ${DEVELOPMENT_DRAFT}`,
    `collectionDefinitions.sync ${DEVELOPMENT_DRAFT}`,
  ]);
});

void test("seeded content stays in the development draft when publishing it is blocked", async (t) => {
  const checkout = await devCheckout(t, { blockers: ["The page needs a meta title"] });
  const { logs } = await startDevServer(checkout, () => {}, "deploy-token");

  await waitFor(() => logs.some((line) => line.includes("publishing is blocked")), logs);
  assert.ok(logs.some((line) => line.includes("The page needs a meta title")));
  assert.ok(!checkout.requests.some((r) => r.path === "drafts.publish"));
});
