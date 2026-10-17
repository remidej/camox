import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { CAMOX_OPTIMIZED_DEPS, camox } from "./vite";

type Nitro = Parameters<NonNullable<ReturnType<typeof camox>["nitro"]>["setup"]>[0];

const externalOptions: Nitro["options"]["noExternals"][] = [
  undefined,
  false,
  true,
  ["app-dependency", /^custom-/],
];

for (const noExternals of externalOptions) {
  void test(`Camox bundles runtime dependencies while preserving noExternals=${String(noExternals)}`, () => {
    const nitro: Nitro = {
      hooks: { hook: () => {} },
      options: {
        noExternals: Array.isArray(noExternals) ? [...noExternals] : noExternals,
        output: { publicDir: "/public", serverDir: "/server" },
        routes: {},
        virtual: {},
      },
    };
    camox({ projectSlug: "smoke" }).nitro!.setup(nitro);
    if (noExternals === true) {
      assert.equal(nitro.options.noExternals, true);
      return;
    }
    assert.deepEqual(nitro.options.noExternals, [
      ...(Array.isArray(noExternals) ? noExternals : []),
      "camox",
      "tslib",
    ]);
  });
}

void test("Camox filters the warnings every Camox app produces from the server bundle", () => {
  const nitro: Nitro = {
    hooks: { hook: () => {} },
    options: {
      output: { publicDir: "/public", serverDir: "/server" },
      routes: {},
      virtual: {},
    },
  };
  camox({ projectSlug: "smoke" }).nitro!.setup(nitro);
  const logged: unknown[] = [];

  nitro.options.rolldownConfig!.onLog!(
    "warn",
    {
      code: "MODULE_LEVEL_DIRECTIVE",
      message: 'The module level directive "use client" in "x.js" may not be preserved.',
    },
    (_level, log) => logged.push(log),
  );

  assert.deepEqual(logged, []);
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
