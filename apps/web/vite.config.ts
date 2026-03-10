import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { camox } from "../../packages/sdk/src/features/vite/vite";

const config = defineConfig({
  resolve: {
    alias: [
      // Point to SDK source files directly instead of built output
      {
        find: "camox/createApp",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/core/createApp.ts",
        ),
      },
      {
        find: "camox/createBlock",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/core/createBlock.tsx",
        ),
      },
      {
        find: "camox/CamoxPreview",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/features/preview/CamoxPreview.tsx",
        ),
      },
      {
        find: "camox/CamoxContent",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/features/content/CamoxContent.tsx",
        ),
      },
      {
        find: "camox/CamoxProvider",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/features/provider/CamoxProvider.tsx",
        ),
      },
      {
        find: "camox/CamoxStudio",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/features/studio/CamoxStudio.tsx",
        ),
      },
      {
        find: "camox/og",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/og/og.ts",
        ),
      },
      {
        find: "camox/_internal/pageRoute",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/features/routes/pageRoute.tsx",
        ),
      },
      {
        find: "camox/_internal/ogRoute",
        replacement: resolve(
          __dirname,
          "../../packages/sdk/src/features/routes/ogRoute.ts",
        ),
      },
    ],
  },
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json", "../../packages/sdk/tsconfig.json"],
    }),
    tailwindcss(),
    camox({
      convexDeployKey: process.env.CONVEX_DEPLOY_KEY!,
      convexUrl: process.env.VITE_CONVEX_URL!,
    }),
    tanstackStart(),
    viteReact({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ["camox"],
  },
});

export default config;
