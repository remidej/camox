import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    // `react` stays global: a plugin listed in `overrides` turns on none of its
    // default rules (https://github.com/oxc-project/oxc/issues/19779).
    plugins: ["typescript", "unicorn", "oxc", "react"],
    ignorePatterns: ["**/routeTree.gen.ts"],
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
    ignorePatterns: ["**/layouts.gen.d.ts", "**/routeTree.gen.ts"],
    sortImports: {},
    sortTailwindcss: {},
  },
});
