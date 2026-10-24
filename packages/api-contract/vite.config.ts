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
    ],
    format: "esm",
    platform: "neutral",
    outDir: "dist",
    clean: true,
    minify: false,
    outExtensions: () => ({ js: ".js" }),
    // The router entry reaches into unpublished workspace code (the api app, and
    // @camox/ai-tools through tsconfig paths), which gets inlined into the
    // bundled types. Third-party types stay as imports.
    tsconfig: "tsconfig.dts.json",
    // The api imports Markdown files as text (its wrangler `Text` rule); the router's
    // types reach them.
    loader: { ".md": "text" },
    deps: {
      neverBundle: true,
    },
    dts: true,
  },
});
