import assert from "node:assert/strict";
import { test } from "node:test";

import { installLockfile, waitForCamox } from "../scripts/install-lockfile.mjs";

// What pnpm prints when the registry doesn't serve a version yet.
function notOnRegistryYet() {
  return Object.assign(new Error("Command failed: pnpm install --lockfile-only"), {
    stdout:
      "[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for camox@^9.9.9 while fetching it from https://registry.npmjs.org/\n",
    stderr: "",
  });
}

function pnpmFailing(errors) {
  const calls = [];
  const run = async (bin, argv, options) => {
    calls.push({ bin, argv, cwd: options.cwd });
    const error = errors.shift();
    if (error) throw error;
  };
  return { run, calls };
}

void test("resolving waits for a version the registry doesn't serve yet", async () => {
  const pnpm = pnpmFailing([notOnRegistryYet(), notOnRegistryYet()]);

  await installLockfile("/template", { run: pnpm.run, retryDelayMs: 0 });

  assert.equal(pnpm.calls.length, 3);
  assert.deepEqual(pnpm.calls[2], {
    bin: "pnpm",
    argv: ["install", "--lockfile-only"],
    cwd: "/template",
  });
});

void test("resolving gives up once the registry still doesn't serve the version after every attempt", async () => {
  const pnpm = pnpmFailing([notOnRegistryYet(), notOnRegistryYet(), notOnRegistryYet()]);

  await assert.rejects(
    installLockfile("/template", { run: pnpm.run, attempts: 2, retryDelayMs: 0 }),
    (error) => error.stdout.includes("ERR_PNPM_NO_MATCHING_VERSION"),
  );
  assert.equal(pnpm.calls.length, 2);
});

void test("resolving fails at once on any other error", async () => {
  const broken = Object.assign(new Error("Command failed: pnpm install --lockfile-only"), {
    stdout: "[ERR_PNPM_JSON_PARSE] Unexpected token in package.json\n",
    stderr: "",
  });
  const pnpm = pnpmFailing([broken, undefined]);

  await assert.rejects(installLockfile("/template", { run: pnpm.run, retryDelayMs: 0 }), broken);
  assert.equal(pnpm.calls.length, 1);
});

// A registry where each `name/version` starts serving after it's been asked for `delays[key]` times.
function registry(manifests, delays = {}) {
  const requests = [];
  const fetch = async (url) => {
    const key = url.replace("https://registry.npmjs.org/", "");
    requests.push(key);
    const asked = requests.filter((request) => request === key).length;
    if (!manifests[key] || asked <= (delays[key] ?? 0)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => manifests[key] };
  };
  return { fetch, requests };
}

const camox = {
  "camox/1.2.0": {
    dependencies: { "@camox/ui": "1.2.0", "@camox/cli": "1.2.0", react: "^19.0.0" },
  },
  "@camox/ui/1.2.0": {},
  "@camox/cli/1.2.0": {},
};

void test("waiting for camox waits until npm serves it and its @camox packages", async () => {
  const npm = registry(camox, { "camox/1.2.0": 2, "@camox/ui/1.2.0": 1 });

  await waitForCamox("1.2.0", { fetch: npm.fetch, retryDelayMs: 0 });

  assert.deepEqual(
    npm.requests.toSorted((a, b) => a.localeCompare(b)),
    [
      "@camox/cli/1.2.0",
      "@camox/ui/1.2.0",
      "@camox/ui/1.2.0",
      "camox/1.2.0",
      "camox/1.2.0",
      "camox/1.2.0",
    ],
  );
});

void test("waiting for camox gives up once npm still doesn't serve it after every attempt", async () => {
  const npm = registry(camox, { "camox/1.2.0": 5 });

  await assert.rejects(
    waitForCamox("1.2.0", { fetch: npm.fetch, attempts: 3, retryDelayMs: 0 }),
    /npm doesn't serve camox@1\.2\.0/,
  );
  assert.equal(npm.requests.length, 3);
});
