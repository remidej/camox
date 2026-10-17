import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { BundlerOnLog } from "./bundlerLogs";
import { CAMOX_OPTIMIZED_DEPS, camox } from "./vite";

type ConfigEnvironmentHook = Extract<
  NonNullable<ReturnType<typeof camox>["configEnvironment"]>,
  (...args: never[]) => unknown
>;
type ConfigResolvedHook = Extract<
  NonNullable<ReturnType<typeof camox>["configResolved"]>,
  (...args: never[]) => unknown
>;

void test("Camox filters the warnings every Camox app produces from the Worker bundle", () => {
  const plugin = camox({ projectSlug: "smoke" });
  const configEnvironment = plugin.configEnvironment as ConfigEnvironmentHook;
  const result = configEnvironment.call(undefined as never, "ssr", {}, {
    command: "build",
    mode: "production",
    isSsrBuild: true,
  } as never) as { build: { rollupOptions: { onLog: BundlerOnLog } } };
  const logged: unknown[] = [];

  result.build.rollupOptions.onLog(
    "warn",
    {
      code: "MODULE_LEVEL_DIRECTIVE",
      message: 'The module level directive "use client" in "x.js" may not be preserved.',
    },
    (_level, log) => logged.push(log),
  );

  assert.deepEqual(logged, []);
});

void test("Camox refuses to run without the Cloudflare plugin", () => {
  const configResolved = camox({ projectSlug: "smoke" }).configResolved as ConfigResolvedHook;
  assert.throws(
    () => configResolved.call(undefined as never, { plugins: [], root: "/app" } as never),
    /cloudflare\(\)/,
  );
});

void test("Camox pre-bundles every Base UI component the Studio imports", () => {
  // Vite can't see the Studio's imports before it loads, so a missing one is only
  // found at runtime: Vite then optimizes it and reloads the page.
  const sources = ["../../../src", "../../../../ui/src"].map(
    (path) => new URL(path, import.meta.url).pathname,
  );
  const imported = new Set<string>();
  for (const root of sources) {
    for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(file)) continue;
      const code = readFileSync(join(root, file), "utf8");
      for (const [, specifier] of code.matchAll(/from "(@base-ui\/react\/[^"]+)"/g))
        imported.add(specifier);
    }
  }
  assert.ok(imported.size > 0);
  const missing = [...imported].filter(
    (specifier) => !CAMOX_OPTIMIZED_DEPS.includes(`camox > ${specifier}`),
  );
  assert.deepEqual(missing, []);
});
