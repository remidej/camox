import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "react"],
    ignorePatterns: ["**/routeTree.gen.ts", "packages/cli/templates/**"],
    options: { typeAware: true, typeCheck: true },
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
