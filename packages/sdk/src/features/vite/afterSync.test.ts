import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";

import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { createLogger, createServer } from "vite-plus";

import { type CamoxPluginOptions, camox } from "./vite";

type AfterSync = NonNullable<NonNullable<CamoxPluginOptions["_internal"]>["afterSync"]>;

const AUTHENTICATION_URL = "http://dashboard.test";

/**
 * A checkout with a minimal Camox app and a dev session, plus a fake API that
 * accepts definition sync unless `failCollectionSync` is set.
 */
async function devCheckout(t: TestContext, { failCollectionSync = false } = {}) {
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
      sync: base.handler(() => ({
        environmentCreated: false,
        deletedDefinitionTypes: [],
        blockedDefinitionDeletions: [],
      })),
    },
    collectionDefinitions: {
      sync: base.handler(() => {
        if (failCollectionSync) throw new Error("collection sync failed");
        return { count: 0, retired: [] };
      }),
      list: base.handler(({ context }) => {
        requests.push({ path: "collectionDefinitions.list", headers: context.headers });
        return [];
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
  t.after(async () => {
    process.chdir(previousCwd);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  return { root, apiUrl: `http://127.0.0.1:${address.port}`, requests };
}

async function startDevServer(
  t: TestContext,
  checkout: { root: string; apiUrl: string },
  afterSync: AfterSync,
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
      camox({
        projectSlug: "checkout",
        _internal: {
          apiUrl: checkout.apiUrl,
          authenticationUrl: AUTHENTICATION_URL,
          disableCodeGen: true,
          afterSync,
        },
      }),
    ],
  });
  t.after(() => server.close());
  await server.listen();
  return { logs };
}

async function waitFor(condition: () => boolean, logs: string[]): Promise<void> {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) await setTimeout(20);
  assert.ok(condition(), logs.join("\n"));
}

void test("the dev server runs afterSync as the dev user once definitions are synced", async (t) => {
  const checkout = await devCheckout(t);
  const calls: Parameters<AfterSync>[0][] = [];
  const { logs } = await startDevServer(t, checkout, async (context) => {
    calls.push(context);
    await context.client.collectionDefinitions.list({ projectSlug: context.projectSlug });
  });

  await waitFor(() => checkout.requests.length > 0, logs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.projectSlug, "checkout");
  assert.equal(calls[0]!.environmentName, "dev:dev@camox.dev");
  assert.ok(logs.some((line) => line.includes("Synced 0 collection definitions")));
  assert.equal(checkout.requests[0]!.headers.authorization, "Bearer dev-session");
  assert.equal(checkout.requests[0]!.headers["x-environment-name"], "dev:dev@camox.dev");
});

void test("the dev server skips afterSync when definition sync fails", async (t) => {
  const checkout = await devCheckout(t, { failCollectionSync: true });
  let calls = 0;
  const { logs } = await startDevServer(t, checkout, () => {
    calls++;
  });

  await waitFor(() => logs.some((line) => line.includes("Failed to sync")), logs);
  await setTimeout(100);
  assert.equal(calls, 0);
});

void test("an afterSync failure is contained as a warning instead of rejecting", async (t) => {
  const checkout = await devCheckout(t);
  const { logs } = await startDevServer(t, checkout, () => {
    throw new Error("seeding exploded");
  });

  await waitFor(() => logs.some((line) => line.includes("seeding exploded")), logs);
  const warning = logs.find((line) => line.includes("seeding exploded"))!;
  assert.match(warning, /\[camox\] afterSync failed/);
});
