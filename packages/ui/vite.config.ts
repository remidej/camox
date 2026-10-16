import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/components/*.tsx", "src/lib/*.ts"],
    format: "esm",
    outDir: "dist",
    clean: true,
    unbundle: true,
    dts: true,
    minify: false,
    outExtensions: () => ({ js: ".js" }),
    deps: {
      neverBundle: true,
    },
  },
});
