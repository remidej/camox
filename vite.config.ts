import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    // `react` stays global: a plugin listed in `overrides` turns on none of its
    // default rules (https://github.com/oxc-project/oxc/issues/19779).
    plugins: ["typescript", "unicorn", "oxc", "react"],
    // Apps copied elsewhere before they build, where `camox` resolves.
    ignorePatterns: [
      "**/routeTree.gen.ts",
      "packages/cli/templates/**",
      "packages/sdk/test/fixture-app/**",
      // camox.ai's checkout: a hosted project, checked on its own.
      "sites/**",
      "tools/oxlint/anti-slop/**",
    ],
    jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-widen-then-assert": "error",
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // Tests render probe components that hand hook results back to the test
        // through outer variables. The React Compiler never builds test files.
        files: ["**/*.test.tsx"],
        rules: {
          "react/globals": "off",
          "react/immutability": "off",
          "react/refs": "off",
        },
      },
      {
        // Tests fake DOM and platform objects with `as unknown as`.
        files: [
          "**/*.test.ts",
          "**/*.test.tsx",
          "**/*.fixtures.ts",
          "**/*.fixtures.tsx",
          "**/test/**",
        ],
        rules: { "anti-slop/no-chained-type-assertions": "off" },
      },
    ],
  },
  staged: {
    "*.{css,html,js,json,jsonc,jsx,md,mdx,scss,ts,tsx,yaml,yml}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "**/layouts.gen.d.ts",
      "**/routeTree.gen.ts",
      "sites/**",
      "tools/oxlint/anti-slop/**",
    ],
    sortImports: {},
    sortTailwindcss: {},
  },
});
