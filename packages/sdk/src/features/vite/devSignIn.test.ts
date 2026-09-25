import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import { createLogger, createServer } from "vite-plus";

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
