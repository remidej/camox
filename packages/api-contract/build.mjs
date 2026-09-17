import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

// Emit JS + .d.ts for query-keys (runtime values)
execSync("pnpm exec tsgo -p tsconfig.build.json", { stdio: "inherit" });

// Bundle Router .d.ts (inlines all transitive types from the api app)
execSync(
  "pnpm exec dts-bundle-generator --no-check --project tsconfig.dts.json src/index.ts -o dist/index.d.ts",
  { stdio: "inherit" },
);

// Emit index.js — esbuild strips the type-only Router re-export.
execSync("pnpm exec esbuild src/index.ts --outdir=dist --format=esm --platform=neutral", {
  stdio: "inherit",
});
