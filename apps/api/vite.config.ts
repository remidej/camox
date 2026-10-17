import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

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
          cloudflareTest({
            // Tests must not inherit production-backed bindings (such as EMAIL).
            remoteBindings: false,
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
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
          }),
        ],
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          // Tests seed Live by publishing drafts, which takes a few statements per write; under a
          // full parallel run the default 5s leaves too little room.
          testTimeout: 15_000,
          setupFiles: ["./test/apply-migrations.ts", "./test/record-project-rooms.ts"],
        },
      },
    ],
  },
});
