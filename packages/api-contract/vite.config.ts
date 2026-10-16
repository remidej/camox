import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: [
      "src/index.ts",
      "src/ids.ts",
      "src/query-keys.ts",
      "src/drafts.ts",
      "src/icon-catalog.ts",
    ],
    format: "esm",
    platform: "neutral",
    outDir: "dist",
    clean: true,
    minify: false,
    outExtensions: () => ({ js: ".js" }),
    // Router reaches into unpublished workspace code (the api app, and
    // @camox/ai-tools through tsconfig paths), which gets inlined into the
    // bundled types. Third-party types stay as imports.
    tsconfig: "tsconfig.dts.json",
    deps: {
      skipNodeModulesBundle: true,
    },
    dts: true,
  },
});
