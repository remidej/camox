import assert from "node:assert/strict";
import { test } from "node:test";

import { camox } from "./vite";

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
