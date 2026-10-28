import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseSync } from "vite-plus";

import { type SdkBundleBuild, buildSdkBundle } from "./buildSdkBundle";
import { type SdkBundleSettings, sdkBundleName, sdkBundleSpecifiersFor } from "./sdkBundleName";
import { SDK_BUNDLE_TARGETS, type SdkBundleTarget, sdkBundleEntryFile } from "./specifiers";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const templateRoot = join(repoRoot, "apps/template-default");

/** What the Template's `camox()` compiles in when it builds for production. */
const settings: SdkBundleSettings = {
  iconIds: [],
  telemetryDisabled: false,
  apiUrl: "https://api.camox.ai",
};

/** The bare specifiers a module imports, statically or with a literal `import()`. */
function importsOf(file: string, code: string): string[] {
  const { module } = parseSync(file, code);
  const specifiers = [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) =>
      entry.entries.flatMap((exported) =>
        exported.moduleRequest ? [exported.moduleRequest.value] : [],
      ),
    ),
  ];
  for (const { moduleRequest } of module.dynamicImports) {
    const literal = /^["'`]([^"'`]*)["'`]$/.exec(
      code.slice(moduleRequest.start, moduleRequest.end),
    );
    if (literal) specifiers.push(literal[1]!);
  }
  return specifiers;
}

void describe("the Template's SDK Bundle", () => {
  let outDir: string;
  let build: SdkBundleBuild;

  before(async () => {
    outDir = await mkdtemp(join(tmpdir(), "camox-sdk-bundle-"));
    build = await buildSdkBundle({ root: templateRoot, outDir, settings });
  });
  after(() => rm(outDir, { recursive: true, force: true }));

  void test("is named as the Template's lockfile names it before it's built", async () => {
    // What a cache or the API looks the bundle up by, without building it.
    const lockfile = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    for (const target of SDK_BUNDLE_TARGETS) {
      assert.equal(
        build[target].name,
        await sdkBundleName({ lockfile, importer: "apps/template-default", target, settings }),
        target,
      );
    }
  });

  void test("holds an entry for every specifier on the SDK's list, in both targets", async () => {
    const lockfile = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    for (const target of SDK_BUNDLE_TARGETS) {
      const importer = "apps/template-default";
      for (const specifier of sdkBundleSpecifiersFor({ lockfile, importer, target })) {
        assert.ok(
          existsSync(join(build[target].dir, sdkBundleEntryFile(specifier))),
          `${target}: ${specifier}`,
        );
      }
    }
  });

  void test("imports nothing by bare specifier, which workerd would resolve from the module's folder", async () => {
    for (const target of SDK_BUNDLE_TARGETS) {
      const { dir } = build[target];
      for (const file of await readdir(dir, { recursive: true })) {
        if (!file.endsWith(".mjs")) continue;
        for (const specifier of importsOf(file, await readFile(join(dir, file), "utf8"))) {
          if (specifier.startsWith(".")) {
            assert.ok(
              existsSync(join(dir, dirname(file), specifier)),
              `${target}/${file} imports ${specifier}`,
            );
            continue;
          }
          assert.match(
            specifier,
            target === "workerd" ? /^(node|cloudflare):/ : /^$/,
            `${target}/${file} imports ${specifier}`,
          );
        }
      }
    }
  });

  void test("gives CommonJS packages named exports, built for each target", async () => {
    const entry = (target: SdkBundleTarget, specifier: string) =>
      import(pathToFileURL(join(build[target].dir, sdkBundleEntryFile(specifier))).href) as Promise<
        Record<string, unknown>
      >;
    const react = await entry("workerd", "react");
    const { jsx } = await entry("workerd", "react/jsx-runtime");
    const { renderToReadableStream } = await entry("workerd", "react-dom/server");
    assert.equal(typeof react.useState, "function");
    assert.equal((react.default as Record<string, unknown>).useState, react.useState);
    // workerd's React DOM server renders to web streams, with the bundle's one copy of React.
    const html = await new Response(
      await (renderToReadableStream as (node: unknown) => Promise<ReadableStream>)(
        (jsx as typeof import("react/jsx-runtime").jsx)("p", { children: "Rendered" }),
      ),
    ).text();
    assert.equal(html, "<p>Rendered</p>");
    const { createRoot } = await entry("browser", "react-dom/client");
    assert.equal(typeof createRoot, "function");
  });

  void test("serves the Studio stylesheet from the browser bundle's own path", async () => {
    const stylesheets = (await readdir(build.browser.dir)).filter((file) =>
      /^camox-studio-.*\.css$/.test(file),
    );
    assert.equal(stylesheets.length, 1);
    const url = `/_camox/sdk/${build.browser.name}/${stylesheets[0]}`;
    let named = false;
    for (const file of await readdir(build.workerd.dir)) {
      if (
        file.endsWith(".mjs") &&
        (await readFile(join(build.workerd.dir, file), "utf8")).includes(url)
      )
        named = true;
    }
    assert.ok(named, `the workerd bundle names ${url}`);
  });
});
