import assert from "node:assert/strict";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build, type Rolldown } from "vite-plus";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const workerEntry = resolve(sdkRoot, "src/features/runtime/worker.ts");

void test("the Worker entry reaches camox's modules only through its package subpaths", async () => {
  // A website's build compiles the Worker entry, which imports its per-project virtual module,
  // while camox's modules come from the package, once.
  const output = (await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      ssr: workerEntry,
      rollupOptions: {
        external: (id) =>
          id.startsWith("camox/") || id.startsWith("virtual:") || id.startsWith("cloudflare:"),
      },
    },
  })) as Rolldown.RolldownOutput;

  const bundled = output.output
    .flatMap((file) => (file.type === "chunk" ? Object.keys(file.modules) : []))
    .filter((id) => id.startsWith(sdkRoot))
    .map((id) => relative(sdkRoot, id));
  assert.deepEqual(bundled, ["src/features/runtime/worker.ts"]);
});
