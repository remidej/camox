import assert from "node:assert/strict";
import { test } from "node:test";

import { installLockfile } from "../scripts/install-lockfile.mjs";

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
