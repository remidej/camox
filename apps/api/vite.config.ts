import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

/**
 * Bundles the code mode sandbox Worker as Wrangler deploys it, for the tests to run it as an
 * auxiliary Worker: its entry, then QuickJS compiled as its own module.
 */
async function bundleSandboxWorker() {
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
    [wrangler, "deploy", "--dry-run", "--config", "sandbox/wrangler.jsonc", "--outdir", outdir],
    { cwd: import.meta.dirname },
  );
  const wasm = (await readdir(outdir)).filter((file) => file.endsWith(".wasm"));
  return {
    modulesRoot: outdir,
    modules: [
      { type: "ESModule" as const, path: path.join(outdir, "index.js") },
      ...wasm.map((file) => ({ type: "CompiledWasm" as const, path: path.join(outdir, file) })),
    ],
  };
}

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
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // The sandbox Worker the threads' code mode scripts run in, as deployed beside the
              // API (ADR 0018).
              workers: [
                {
                  name: "camox-codemode-sandbox",
                  ...(await bundleSandboxWorker()),
                  compatibilityDate: "2026-03-28",
                  durableObjects: { CODEMODE_SANDBOX: "CodemodeSandbox" },
                },
              ],
              bindings: {
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
