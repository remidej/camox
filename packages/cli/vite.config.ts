import { fileURLToPath } from "node:url";

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
    // tsrs, the Rust port of TypeScript 7, emits the declarations. The tsconfig sits at the repo
    // root, as the generator emits relative to its folder.
    tsconfig: "../../tsconfig.dts.cli.json",
    dts: {
      generator: "tsgo",
      tsgo: { path: fileURLToPath(new URL("bin/tsrs", import.meta.resolve("tsrs/package.json"))) },
    },
    target: false,
  },
});
