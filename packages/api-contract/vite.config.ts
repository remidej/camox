import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: [
      "src/index.ts",
      "src/router.ts",
      "src/ids.ts",
      "src/query-keys.ts",
      "src/drafts.ts",
      "src/icon-catalog.ts",
      "src/analytics.ts",
      "src/threads.ts",
      "src/projects.ts",
      "src/locales.ts",
      "src/patrol.ts",
    ],
    format: "esm",
    platform: "neutral",
    outDir: "dist",
    clean: true,
    minify: false,
    outExtensions: () => ({ js: ".js" }),
    // The api imports Markdown files as text (its wrangler `Text` rule); the router's
    // types reach them.
    loader: { ".md": "text" },
    deps: {
      neverBundle: true,
    },
    // tsrs, the Rust port of TypeScript 7, emits the declarations. The tsconfig sits at the repo
    // root, as the generator emits relative to its folder. The router entry reaches into
    // unpublished workspace code (the api app, and @camox/ai-tools through tsconfig paths), which
    // gets inlined into the bundled types. Third-party types stay as imports.
    tsconfig: "../../tsconfig.dts.api-contract.json",
    dts: {
      generator: "tsgo",
      tsgo: { path: fileURLToPath(new URL("bin/tsrs", import.meta.resolve("tsrs/package.json"))) },
    },
  },
});
