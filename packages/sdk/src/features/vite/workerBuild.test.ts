import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ViteBuilder } from "vite-plus";

import { buildClientThenWorker } from "./workerBuild";

function write(path: string, content = "") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

void test("the client builds before the Worker, which hands it the assets it imports", async () => {
  const root = mkdtempSync(join(tmpdir(), "camox-worker-build-"));
  try {
    const built: string[] = [];
    const environment = (name: string) => ({ name, config: { build: { outDir: `dist/${name}` } } });
    const builder = {
      config: { root },
      environments: { ssr: environment("ssr"), client: environment("client") },
      async build(env: { name: string }) {
        built.push(env.name);
        if (env.name === "client") write(join(root, "dist/client/assets/shared.css"));
        if (env.name !== "ssr") return;
        write(
          join(root, "dist/ssr/.vite/manifest.json"),
          JSON.stringify({ "index.js": { assets: ["assets/app.css", "assets/shared.css"] } }),
        );
        write(join(root, "dist/ssr/assets/app.css"));
        write(join(root, "dist/ssr/assets/shared.css"));
        write(join(root, "dist/ssr/assets/renderer.wasm"));
      },
    } as unknown as ViteBuilder;

    await buildClientThenWorker(builder);

    assert.deepEqual(built, ["client", "ssr"]);
    assert.ok(existsSync(join(root, "dist/client/assets/app.css")));
    assert.ok(!existsSync(join(root, "dist/ssr/assets/app.css")));
    assert.ok(!existsSync(join(root, "dist/ssr/assets/shared.css")));
    // The Worker's own modules stay with it.
    assert.ok(existsSync(join(root, "dist/ssr/assets/renderer.wasm")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
