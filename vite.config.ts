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
    ],
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
    ],
  },
  staged: {
    "*.{css,html,js,json,jsonc,jsx,md,mdx,scss,ts,tsx,yaml,yml}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["**/layouts.gen.d.ts", "**/routeTree.gen.ts", "sites/**"],
    sortImports: {},
    sortTailwindcss: {},
  },
});
