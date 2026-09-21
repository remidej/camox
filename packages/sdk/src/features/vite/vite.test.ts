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
