import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";

import { createLogger, createServer, type ViteDevServer } from "vite-plus";

import { installDevSignInLink } from "./devSignIn";

void test("prints a checkout-specific sign-in link on the actual Vite port after API startup", async () => {
  let requests = 0;
  const api = createHttpServer((req, res) => {
    requests++;
    assert.equal(req.url, "/api/auth/one-time-token/generate");
    assert.equal(req.headers.authorization, "Bearer checkout-session");
    res.writeHead(requests === 1 ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ token: "test-ott" }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const logs: string[] = [];
  const logger = createLogger("silent");
  logger.info = (message) => logs.push(message);
  logger.warn = (message) => logs.push(message);
  const server = await createServer({
    configFile: false,
    customLogger: logger,
    server: { host: "127.0.0.1", port: address.port },
    plugins: [
      {
        name: "test-sign-in",
        configureServer(vite) {
          installDevSignInLink(vite, {
            projectSlug: "checkout",
            environmentName: "dev:dev@camox.dev",
            apiUrl,
            authToken: "checkout-session",
          });
        },
      },
    ],
  });
  try {
    await server.listen();
    server.printUrls();
    for (
      let attempt = 0;
      attempt < 100 && !logs.some((line) => line.includes("Camox sign in"));
      attempt++
    ) {
      await setTimeout(50);
    }
    const line = logs.find((entry) => entry.includes("Camox sign in"));
    assert.ok(line, logs.join("\n"));
    const url = new URL(line.slice(line.indexOf("http")));
    assert.notEqual(url.port, String(address.port));
    assert.equal(url.origin, new URL(server.resolvedUrls!.local[0]!).origin);
    assert.equal(url.searchParams.get("ott"), "test-ott");
    assert.deepEqual(JSON.parse(url.searchParams.get("camox-preview")!), {
      projectSlug: "checkout",
      environmentName: "dev:dev@camox.dev",
      apiUrl,
    });
    assert.equal(requests, 2);
    assert.doesNotMatch(logs.join("\n"), /checkout-session/);
    server.printUrls();
    await setTimeout(50);
    assert.equal(requests, 2);
  } finally {
    await server.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

void test("closing Vite cancels pending sign-in retries without logging credentials", async () => {
  let requests = 0;
  const api = createHttpServer((_req, res) => {
    requests++;
    res.writeHead(503);
    res.end("private-backend-response");
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const logs: string[] = [];
  const logger = createLogger("silent");
  logger.info = (message) => logs.push(message);
  logger.warn = (message) => logs.push(message);
  const server = await createServer({
    configFile: false,
    customLogger: logger,
    server: { host: "127.0.0.1", port: 0 },
  });
  installDevSignInLink(server, {
    projectSlug: "checkout",
    environmentName: "dev:dev@camox.dev",
    apiUrl: `http://127.0.0.1:${address.port}`,
    authToken: "checkout-session",
  });
  try {
    await server.listen();
    server.printUrls();
    for (let attempt = 0; attempt < 100 && requests === 0; attempt++) {
      await setTimeout(10);
    }
    assert.equal(requests, 1);
    await server.close();
    await setTimeout(1_100);
    assert.equal(requests, 1);
    assert.doesNotMatch(logs.join("\n"), /Camox sign|checkout-session|private-backend-response/);
  } finally {
    await server.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await setTimeout(10);
  assert.ok(condition(), "Expected sign-in activity to finish");
}

function signInFixture(t: TestContext) {
  const logs: string[] = [];
  const warnings: string[] = [];
  const launches: { command: string; args: readonly string[] }[] = [];
  let requests = 0;
  let token: unknown = "test-ott";
  let launchError = false;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ token });
  });
  t.mock.method(
    childProcess,
    "spawn",
    (command: string, args: readonly string[], options: unknown) => {
      launches.push({ command, args });
      assert.deepEqual(options, { stdio: "ignore", detached: true });
      const child = Object.assign(new EventEmitter(), { unref() {} });
      queueMicrotask(() => {
        if (launchError) child.emit("error", new Error(`private-opener-error ${args.join(" ")}`));
        else child.emit("exit", 0);
      });
      return child as ChildProcess;
    },
  );
  function server(
    options: Partial<Parameters<typeof installDevSignInLink>[1]> = {},
    destination = "http://localhost:5173/",
  ) {
    const httpServer = new EventEmitter();
    const vite = {
      httpServer,
      config: {
        root: t.name,
        logger: {
          info: (line: string) => logs.push(line),
          warn: (line: string) => warnings.push(line),
        },
      },
      resolvedUrls: { local: [destination], network: [] },
      printUrls() {},
    } as unknown as ViteDevServer;
    installDevSignInLink(vite, {
      projectSlug: "playground",
      environmentName: "dev:dev@camox.dev",
      apiUrl: "http://localhost:8787",
      authToken: "private-session",
      ...options,
    });
    t.after(() => httpServer.emit("close"));
    return vite;
  }
  return {
    logs,
    warnings,
    launches,
    server,
    requests: () => requests,
    setToken: (value: unknown) => {
      token = value;
    },
    failLaunch: () => {
      launchError = true;
    },
  };
}

void test("auto-opening is opt-in and never opens the plain local URL", async (t) => {
  const fixture = signInFixture(t);
  fixture.server().printUrls();
  await waitFor(() => fixture.logs.length === 1);
  assert.equal(fixture.launches.length, 0);
  assert.equal(fixture.requests(), 1);
});

void test("opens the printed valid token URL only once across Vite installations", async (t) => {
  const fixture = signInFixture(t);
  const server = fixture.server({ open: true });
  server.printUrls();
  server.printUrls();
  await waitFor(() => fixture.launches.length === 1);
  const url = fixture.launches[0]!.args.at(-1)!;
  assert.equal(new URL(url).searchParams.get("ott"), "test-ott");
  assert.ok(fixture.logs[0]!.endsWith(url));
  assert.equal(fixture.requests(), 1);

  fixture.server({ open: true }).printUrls();
  await waitFor(() => fixture.logs.length === 2);
  assert.equal(fixture.launches.length, 1);
  assert.equal(fixture.requests(), 2);
});

void test("auto-opening uses the generated *.localhost destination", async (t) => {
  const fixture = signInFixture(t);
  const server = fixture.server({ open: true });
  server.resolvedUrls = { local: [], network: ["http://checkout.localhost:5178/"] };
  server.printUrls();
  await waitFor(() => fixture.launches.length === 1);
  assert.equal(new URL(fixture.launches[0]!.args.at(-1)!).origin, "http://checkout.localhost:5178");
});

void test("arbitrary network destinations do not mint or open a sign-in link", async (t) => {
  const fixture = signInFixture(t);
  const server = fixture.server({ open: true });
  server.resolvedUrls = { local: [], network: ["http://192.168.1.2:5178/"] };
  server.printUrls();
  await setTimeout(20);
  assert.equal(fixture.requests(), 0);
  assert.equal(fixture.launches.length, 0);
  assert.equal(fixture.logs.length, 0);
});

void test("invalid tokens are retried without opening a browser or claiming the marker", async (t) => {
  const fixture = signInFixture(t);
  const directory = await mkdtemp(join(tmpdir(), "camox-dev-sign-in-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "opened");
  fixture.setToken(null);
  fixture.server({ open: true, openOnceFile: marker }).printUrls();
  await waitFor(() => fixture.requests() === 1);
  assert.equal(fixture.launches.length, 0);
  assert.equal(fixture.logs.length, 0);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  fixture.setToken("valid-token");
  await waitFor(() => fixture.launches.length === 1);
  assert.equal(new URL(fixture.launches[0]!.args.at(-1)!).searchParams.get("ott"), "valid-token");
  assert.equal(await readFile(marker, "utf8"), "");
});

void test("an atomic marker prevents reopening across independent instances and permits a new invocation", async (t) => {
  const fixture = signInFixture(t);
  const directory = await mkdtemp(join(tmpdir(), "camox-dev-sign-in-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "first-invocation");
  fixture.server({ open: true, openOnceFile: marker, projectSlug: "first-instance" }).printUrls();
  fixture.server({ open: true, openOnceFile: marker, projectSlug: "second-instance" }).printUrls();
  await waitFor(() => fixture.logs.length === 2 && fixture.launches.length === 1);
  await setTimeout(30);
  assert.equal(fixture.launches.length, 1);
  assert.equal(await readFile(marker, "utf8"), "");
  // A fresh process has no global registry: only the on-disk claim can prevent reopening.
  childProcess.execFileSync(
    process.execPath,
    [
      ...process.execArgv,
      "--input-type=module",
      "--eval",
      `
        import assert from "node:assert/strict";
        import childProcess from "node:child_process";
        import { installDevSignInLink } from ${JSON.stringify(new URL("./devSignIn.ts", import.meta.url).href)};
        let launches = 0;
        let printed = 0;
        childProcess.spawn = () => { launches++; throw new Error("Unexpected browser launch"); };
        globalThis.fetch = async () => Response.json({ token: "subprocess-token" });
        const server = {
          config: { root: "independent-process", logger: { info() { printed++; }, warn() {} } },
          resolvedUrls: { local: ["http://localhost:5173/"], network: [] },
          printUrls() {},
        };
        installDevSignInLink(server, {
          projectSlug: "playground", environmentName: "dev", apiUrl: "http://localhost:8787",
          authToken: "test-session", open: true, openOnceFile: ${JSON.stringify(marker)},
        });
        server.printUrls();
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(printed, 1);
        assert.equal(launches, 0);
      `,
    ],
    { stdio: "pipe" },
  );
  fixture.server({ open: true, openOnceFile: join(directory, "next-invocation") }).printUrls();
  await waitFor(() => fixture.launches.length === 2);
});

void test("opener failures keep the printed fallback without leaking errors or retrying", async (t) => {
  const fixture = signInFixture(t);
  const directory = await mkdtemp(join(tmpdir(), "camox-dev-sign-in-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { open: true, openOnceFile: join(directory, "opened") };
  fixture.failLaunch();
  fixture.server(options).printUrls();
  await waitFor(() => fixture.warnings.length === 1);
  assert.match(fixture.logs[0]!, /ott=test-ott/);
  assert.doesNotMatch(fixture.warnings.join("\n"), /private-opener-error|test-ott|private-session/);
  fixture.server(options).printUrls();
  await waitFor(() => fixture.logs.length === 2);
  await setTimeout(30);
  assert.equal(fixture.launches.length, 1);
  assert.equal(fixture.requests(), 2);
});

void test("marker failures fail closed, preserving the link without leaking filesystem errors", async (t) => {
  const fixture = signInFixture(t);
  const directory = await mkdtemp(join(tmpdir(), "camox-dev-sign-in-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  fixture
    .server({ open: true, openOnceFile: join(directory, "missing", "private-marker") })
    .printUrls();
  await waitFor(() => fixture.warnings.length === 1);
  assert.equal(fixture.launches.length, 0);
  assert.match(fixture.logs[0]!, /ott=test-ott/);
  assert.doesNotMatch(fixture.warnings.join("\n"), /private-marker|test-ott|private-session/);
  assert.equal(fixture.requests(), 1);
});
