import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      "lib/auth-core": "src/lib/auth-core.ts",
    },
    format: ["esm"],
    outDir: "dist",
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    dts: true,
    target: false,
  },
});
