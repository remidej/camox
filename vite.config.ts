import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  staged: {
    "*": "nx affected -t check",
    "*.{css,html,js,json,jsonc,jsx,md,mdx,scss,ts,tsx,yaml,yml}": "vp fmt",
  },
  fmt: {
    ignorePatterns: ["**/layouts.gen.d.ts", "**/routeTree.gen.ts"],
    sortImports: {},
    sortTailwindcss: {},
  },
});
