import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
type ConfigHook = Extract<
  NonNullable<ReturnType<typeof camox>["config"]>,
  (...args: never[]) => unknown
>;
type LoadHook = Extract<
  NonNullable<ReturnType<typeof camox>["load"]>,
  (...args: never[]) => unknown
>;

const PROJECT_ID = "01a15fff-627b-7fa1-938b-93ab659c1acc";

void test("Camox points a config still naming its project by slug to the Project ID", () => {
  assert.throws(
    () => camox({ projectSlug: "camox-playground-01" } as never),
    /projectSlug.*Project ID.*dashboard/s,
  );
});

void test("Camox refuses on startup a Project ID that isn't a lowercase UUIDv7", () => {
  for (const projectId of [
    "camox-playground-01",
    PROJECT_ID.toUpperCase(),
    // A UUIDv4
    "3b241101-e2bb-4255-8caf-4136c566a962",
  ]) {
    assert.throws(() => camox({ projectId }), /Project ID/, projectId);
  }
});

void test("Camox tells the CLI the project's Project ID through runtime.json", () => {
  const root = mkdtempSync(join(tmpdir(), "camox-runtime-"));
  const configResolved = camox({ projectId: PROJECT_ID, _internal: { disableCodeGen: true } })
    .configResolved as ConfigResolvedHook;
  void configResolved.call(
    undefined as never,
    {
      plugins: [{ name: "vite-plugin-cloudflare" }],
      root,
      command: "serve",
      logger: { info() {}, warn() {} },
    } as never,
  );
  const runtime = JSON.parse(
    readFileSync(join(root, "node_modules", ".camox", "runtime.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(runtime.projectId, PROJECT_ID);
  assert.equal("projectSlug" in runtime, false);
});

void test("Camox names the project by its Project ID in the Worker's runtime options", async () => {
  const root = mkdtempSync(join(tmpdir(), "camox-worker-"));
  const plugin = camox({ projectId: PROJECT_ID });
  const config = (await (plugin.config as ConfigHook).call(
    undefined as never,
    { root },
    {
      command: "serve",
      mode: "development",
    },
  )) as { define: Record<string, string> };
  const server = (await (plugin.load as LoadHook).call(
    undefined as never,
    "\0virtual:camox/server",
    { ssr: true },
  )) as string;
  // What Vite's define does to the module before the Worker runs it.
  const compiled = Object.entries(config.define).reduce(
    (code, [name, value]) => code.replaceAll(name, value),
    server,
  );
  const options = /const options = \{([\s\S]*?)\n\};/.exec(compiled)?.[1];
  assert.ok(options);
  assert.match(compiled, /handleRuntimeRequest\(request, options\)/);
  assert.match(options, new RegExp(`projectUuid: "${PROJECT_ID}"`));
  assert.doesNotMatch(options, /projectSlug/);
});

void test("Camox filters the warnings every Camox app produces from the Worker bundle", () => {
  const plugin = camox({ projectId: PROJECT_ID });
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
  const configResolved = camox({ projectId: PROJECT_ID }).configResolved as ConfigResolvedHook;
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
