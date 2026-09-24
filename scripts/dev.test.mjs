import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  aliasDevCredentials,
  createDevEnvironment,
  findAvailablePort,
  isPortConflict,
  runDevCommand,
} from "./dev.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultUrl = "http://localhost:3274";
const alternateUrl = "http://localhost:3275";
const inspectorWarning = "Default inspector port 9229 not available, using 9230 instead";

async function listen(t, host, port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

async function temporaryCheckout(t) {
  const directory = join(root, "tmp");
  await mkdir(directory, { recursive: true });
  const checkout = await mkdtemp(join(directory, "dev-test-"));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  return checkout;
}

async function writeAuth(checkout, tokens) {
  await mkdir(join(checkout, ".camox"), { recursive: true });
  await writeFile(join(checkout, ".camox/auth.json"), JSON.stringify(tokens));
}

async function readAuth(checkout) {
  return JSON.parse(await readFile(join(checkout, ".camox/auth.json"), "utf8"));
}

for (const host of ["127.0.0.1", "::1"]) {
  await test(`findAvailablePort skips occupied ${host} and releases its probes`, async (t) => {
    let occupied;
    try {
      occupied = await listen(t, host);
    } catch (error) {
      if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) {
        t.skip("IPv6 loopback is unavailable");
        return;
      }
      throw error;
    }
    const available = await findAvailablePort(occupied);
    assert.ok(available > occupied);
    assert.ok(available <= 65535);
    await listen(t, "127.0.0.1", available);
    if (host === "::1") await listen(t, "::1", available);
  });
}

await test("createDevEnvironment replaces stale checkout ports and URLs without mutating other variables", async () => {
  const original = {
    PATH: "/fake/bin",
    CUSTOM_SETTING: "preserved",
    CAMOX_DEV_API_PORT: "1",
    CAMOX_DEV_DASHBOARD_PORT: "2",
    VITE_API_URL: "https://stale-api.invalid",
    VITE_DASHBOARD_URL: "https://stale-dashboard.invalid",
  };
  const snapshot = { ...original };
  const env = await createDevEnvironment(original);
  assert.notEqual(env, original);
  assert.deepEqual(original, snapshot);
  assert.equal(env.PATH, original.PATH);
  assert.equal(env.CUSTOM_SETTING, original.CUSTOM_SETTING);
  assert.match(env.CAMOX_DEV_API_PORT, /^\d+$/);
  assert.match(env.CAMOX_DEV_DASHBOARD_PORT, /^\d+$/);
  assert.ok(Number(env.CAMOX_DEV_API_PORT) >= 8787);
  assert.ok(Number(env.CAMOX_DEV_DASHBOARD_PORT) >= 3274);
  assert.notEqual(env.CAMOX_DEV_API_PORT, env.CAMOX_DEV_DASHBOARD_PORT);
  assert.equal(env.VITE_API_URL, `http://localhost:${env.CAMOX_DEV_API_PORT}`);
  assert.equal(env.VITE_DASHBOARD_URL, `http://localhost:${env.CAMOX_DEV_DASHBOARD_PORT}`);
});

for (const credential of ["fake-test-token-not-a-secret", null]) {
  await test(`aliasDevCredentials copies checkout-local ${credential === null ? "null tombstones" : "tokens"}`, async (t) => {
    const checkout = await temporaryCheckout(t);
    const original = {
      [defaultUrl]: credential,
      [alternateUrl]: "fake-stale-token",
      "https://unrelated.invalid": "fake-unrelated-token",
    };
    await writeAuth(checkout, original);
    await aliasDevCredentials(checkout, alternateUrl);
    assert.deepEqual(await readAuth(checkout), {
      ...original,
      [alternateUrl]: credential,
    });
    if (process.platform !== "win32") {
      assert.equal((await stat(join(checkout, ".camox/auth.json"))).mode & 0o777, 0o600);
    }
  });
}

await test("aliasDevCredentials leaves a missing checkout-local auth file missing", async (t) => {
  const checkout = await temporaryCheckout(t);
  await aliasDevCredentials(checkout, alternateUrl);
  await assert.rejects(readFile(join(checkout, ".camox/auth.json")), { code: "ENOENT" });
});

await test("aliasDevCredentials preserves entries when the default URL has no credential", async (t) => {
  const checkout = await temporaryCheckout(t);
  const original = { [alternateUrl]: "fake-existing-token", "https://other.invalid": null };
  await writeAuth(checkout, original);
  await aliasDevCredentials(checkout, alternateUrl);
  assert.deepEqual(await readAuth(checkout), original);
});

await test("aliasDevCredentials does not rewrite credentials for the default URL", async (t) => {
  const checkout = await temporaryCheckout(t);
  await writeAuth(checkout, { [defaultUrl]: "fake-test-token" });
  const file = join(checkout, ".camox/auth.json");
  const before = await readFile(file, "utf8");
  await aliasDevCredentials(checkout, defaultUrl);
  assert.equal(await readFile(file, "utf8"), before);
});

await test("isPortConflict distinguishes fatal bind errors from inspector fallback warnings", () => {
  for (const message of [
    "listen EADDRINUSE: 127.0.0.1:8787",
    "ERR_ADDRESS_IN_USE",
    "Address already in use",
    "Error: Port 3274 is already in use",
  ]) {
    assert.equal(isPortConflict(message), true, message);
  }
  for (const message of [inspectorWarning, "Server ready", "Build failed"]) {
    assert.equal(isPortConflict(message), false, message);
  }
});

function runChild(source, retryOnPortConflict = false) {
  return runDevCommand(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root,
    env: { ...process.env, NODE_OPTIONS: "" },
    retryOnPortConflict,
  });
}

await test("runDevCommand propagates child failures and restores signal listeners", async () => {
  const interruptListeners = process.listeners("SIGINT");
  const terminateListeners = process.listeners("SIGTERM");
  assert.deepEqual(await runChild("process.exitCode = 23"), {
    code: 23,
    portConflict: false,
    signal: undefined,
  });
  assert.deepEqual(process.listeners("SIGINT"), interruptListeners);
  assert.deepEqual(process.listeners("SIGTERM"), terminateListeners);
});

await test("runDevCommand leaves inspector fallback warnings running successfully", async () => {
  const result = await runChild(
    `console.error(${JSON.stringify(inspectorWarning)}); setTimeout(() => process.exit(0), 100);`,
    true,
  );
  assert.deepEqual(result, { code: 0, portConflict: false, signal: undefined });
});

await test("runDevCommand shuts down a live child on a port conflict", async () => {
  const result = await runChild(
    'setTimeout(() => process.exit(99), 3000); console.error("listen EADDRINUSE: 127.0.0.1:8787");',
    true,
  );
  assert.equal(result.portConflict, true);
  assert.notEqual(result.code, 99, "the conflict should stop the child before its fallback exit");
  assert.equal(result.signal, undefined);
});

await test("runDevCommand does not retry port conflicts unless enabled", async () => {
  const result = await runChild('console.error("EADDRINUSE"); process.exitCode = 24;');
  assert.deepEqual(result, { code: 24, portConflict: false, signal: undefined });
});

await test("runDevCommand reports a conflict as failure even when the child shuts down successfully", async () => {
  const result = await runChild(
    'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000); console.error("EADDRINUSE");',
    true,
  );
  assert.deepEqual(result, { code: 1, portConflict: true, signal: undefined });
});

await test(
  "forced shutdown reaches a coordinated worker even if its wrapper handles SIGTERM late",
  { skip: process.platform === "win32", timeout: 10000 },
  async (t) => {
    const checkout = await temporaryCheckout(t);
    const pidFile = join(checkout, "worker.pid");
    const worker = `
      import { writeFileSync } from "node:fs";
      process.on("SIGTERM", () => {});
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      setInterval(() => {}, 1000);
      console.error("EADDRINUSE");
    `;
    const wrapper = `
      import { runDevCommand } from ${JSON.stringify(new URL("./dev.mjs", import.meta.url).href)};
      process.on("SIGTERM", () => {
        const until = Date.now() + 50;
        while (Date.now() < until) {}
      });
      await runDevCommand(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(worker)}], {
        cwd: process.cwd(), env: process.env, ownProcessGroup: false
      });
    `;
    // Clean up the synthetic worker even if this regression test fails.
    let pid;
    t.after(() => {
      if (!pid) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    });
    const result = await runChild(wrapper, true);
    pid = Number(await readFile(pidFile, "utf8"));
    assert.equal(result.code, 1);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);
