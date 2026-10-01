import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepareDevOpen } from "./dev-open.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function temporaryCheckout(t) {
  const directory = join(root, "tmp");
  await mkdir(directory, { recursive: true });
  const checkout = await mkdtemp(join(directory, "dev-open-test-"));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  return checkout;
}

await test("normal dev never inherits another invocation's browser-open marker", async (t) => {
  const checkout = await temporaryCheckout(t);
  const env = { PATH: "/test/bin", CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE: "/old/marker" };
  const launch = await prepareDevOpen(checkout, ["-p", "playground"], env);
  assert.deepEqual(launch.args, ["-p", "playground"]);
  assert.deepEqual(launch.env, { PATH: "/test/bin" });
  assert.equal(env.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE, "/old/marker");
  await assert.rejects(stat(join(checkout, ".camox")), { code: "ENOENT" });
  await launch.cleanup();
});

await test("--open is consumed and each invocation gets its own empty-marker path", async (t) => {
  const checkout = await temporaryCheckout(t);
  const args = ["-p", "playground", "--open", "--parallel=4"];
  const first = await prepareDevOpen(checkout, args, { PATH: "/test/bin" });
  const second = await prepareDevOpen(checkout, args, {});
  t.after(first.cleanup);
  t.after(second.cleanup);
  assert.deepEqual(first.args, ["-p", "playground", "--parallel=4"]);
  assert.deepEqual(args, ["-p", "playground", "--open", "--parallel=4"]);
  assert.equal(first.env.PATH, "/test/bin");
  const marker = first.env.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE;
  assert.equal(dirname(marker), join(checkout, ".camox"));
  assert.notEqual(marker, second.env.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE);
  await assert.rejects(stat(marker), { code: "ENOENT" });

  // Simulate the SDK claiming the invocation. Cleanup touches only that marker.
  const credentials = join(checkout, ".camox/auth.json");
  await writeFile(credentials, "{}");
  await writeFile(marker, "", { flag: "wx" });
  await first.cleanup();
  await first.cleanup();
  await assert.rejects(stat(marker), { code: "ENOENT" });
  assert.equal(await readFile(credentials, "utf8"), "{}");
});
