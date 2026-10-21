import { execFile } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { experimental_readRawConfig, unstable_readConfig } from "wrangler";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

const SANDBOX_CONFIG = "sandbox/wrangler.jsonc";

/**
 * The code mode sandbox Worker as Wrangler deploys it, for the tests to run it as an auxiliary
 * Worker: named as deployed, which the API's binding names, with its entry and QuickJS compiled
 * as its own module.
 */
async function sandboxWorker() {
  const config = unstable_readConfig({ config: path.join(import.meta.dirname, SANDBOX_CONFIG) });
  const require = createRequire(import.meta.url);
  // Wrangler's exports map hides its bin, so locate it from the exported package.json.
  const wrangler = path.join(
    path.dirname(require.resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
  // Its own directory per run, as test shards configure in parallel.
  const outdir = await mkdtemp(path.join(tmpdir(), "camox-codemode-sandbox-"));
  await promisify(execFile)(
    process.execPath,
    [wrangler, "deploy", "--dry-run", "--config", SANDBOX_CONFIG, "--outdir", outdir],
    { cwd: import.meta.dirname },
  );
  const wasm = (await readdir(outdir)).filter((file) => file.endsWith(".wasm"));
  return {
    name: config.name,
    compatibilityDate: config.compatibility_date,
    durableObjects: { CODEMODE_SANDBOX: "CodemodeSandbox" },
    modulesRoot: outdir,
    modules: [
      { type: "ESModule" as const, path: path.join(outdir, "index.js") },
      ...wasm.map((file) => ({ type: "CompiledWasm" as const, path: path.join(outdir, file) })),
    ],
  };
}

/**
 * The API's Wrangler configuration without its Cloudflare Artifacts and email bindings. Artifacts
 * has no local simulator, and Miniflare lets either win over the test's fake of the same name, so
 * the tests run from a copy that leaves them to the fakes. Its own directory per run, as test shards configure in
 * parallel.
 */
async function wranglerConfigForTests() {
  const { rawConfig } = experimental_readRawConfig({
    config: path.join(import.meta.dirname, "wrangler.jsonc"),
  });
  const { artifacts: _artifacts, send_email: _email, ...config } = rawConfig;
  const file = path.join(
    await mkdtemp(path.join(tmpdir(), "camox-api-wrangler-")),
    "wrangler.json",
  );
  await writeFile(
    file,
    JSON.stringify({ ...config, main: path.join(import.meta.dirname, config.main!) }),
  );
  return file;
}

/** Fakes for the release Workflow's bindings, which have no local simulator. */
const releaseFakesWorker = {
  name: "camox-release-fakes",
  compatibilityDate: "2026-03-28",
  compatibilityFlags: ["nodejs_compat"],
  modules: true,
  scriptPath: path.join(import.meta.dirname, "test/release-fakes.js"),
  durableObjects: { SANDBOX: "FakeSandbox" },
};

export default defineConfig({
  logLevel: "silent",
  resolve: {
    alias: {
      // Exercise the real playground collection definition without requiring SDK dist.
      "camox/createCollection": path.resolve(
        import.meta.dirname,
        "../../packages/sdk/src/core/createCollection.ts",
      ),
    },
  },
  test: {
    projects: [
      {
        // Pure logic runs in Node: booting workerd and migrating D1 per file
        // dominates the runtime of the integration project.
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            // Tests must not inherit production-backed bindings (such as EMAIL).
            remoteBindings: false,
            wrangler: { configPath: await wranglerConfigForTests() },
            miniflare: {
              // The sandbox Worker the threads' code mode scripts run in, as deployed beside the
              // API (ADR 0018).
              workers: [await sandboxWorker(), releaseFakesWorker],
              // The release Workflow's Cloudflare Artifacts namespace, sandboxes and email,
              // faked (test/release-fakes.js).
              serviceBindings: {
                ARTIFACTS: { name: releaseFakesWorker.name, entrypoint: "FakeArtifacts" },
                EMAIL: { name: releaseFakesWorker.name, entrypoint: "FakeEmail" },
                RELEASE_FAKES: { name: releaseFakesWorker.name, entrypoint: "ReleaseFakes" },
              },
              durableObjects: {
                SANDBOX: { className: "FakeSandbox", scriptName: releaseFakesWorker.name },
              },
              bindings: {
                CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
                CF_TOKEN: "test-cloudflare-token",
                BETTER_AUTH_SECRET: "test-secret",
                GITHUB_CLIENT_ID: "test-client-id",
                GITHUB_CLIENT_SECRET: "test-client-secret",
                GOOGLE_CLIENT_ID: "test-client-id",
                GOOGLE_CLIENT_SECRET: "test-client-secret",
                OPEN_ROUTER_API_KEY: "test-api-key",
                TEST_MIGRATIONS: migrations,
              },
            },
          })),
        ],
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          // Tests seed Live by publishing drafts, which takes a few statements per write; under a
          // full parallel run the default 5s leaves too little room.
          testTimeout: 15_000,
          setupFiles: [
            "./test/apply-migrations.ts",
            "./test/record-project-rooms.ts",
            "./test/record-generation.ts",
          ],
        },
      },
    ],
  },
});
