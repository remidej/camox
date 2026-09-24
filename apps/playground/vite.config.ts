import { resolve } from "node:path";

import babelPlugin from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

import { camox } from "../../packages/sdk/src/features/vite/vite";

const config = defineConfig({
  lint: {
    plugins: ["react"],
    rules: {
      "no-nested-ternary": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: [
      // Point to SDK source files directly instead of built output
      {
        find: "camox/createApp",
        replacement: resolve(__dirname, "../../packages/sdk/src/core/createApp.ts"),
      },
      {
        find: "camox/createBlock",
        replacement: resolve(__dirname, "../../packages/sdk/src/core/createBlock.tsx"),
      },
      {
        find: "camox/createLayout",
        replacement: resolve(__dirname, "../../packages/sdk/src/core/createLayout.tsx"),
      },
      {
        find: "camox/document",
        replacement: resolve(__dirname, "../../packages/sdk/src/core/defineDocument.ts"),
      },
      {
        find: "camox/CamoxPreview",
        replacement: resolve(__dirname, "../../packages/sdk/src/features/preview/CamoxPreview.tsx"),
      },
      {
        find: "camox/CamoxContent",
        replacement: resolve(__dirname, "../../packages/sdk/src/features/content/CamoxContent.tsx"),
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
        replacement: resolve(__dirname, "../../packages/sdk/src/features/studio/CamoxStudio.tsx"),
      },
      {
        find: "camox/og",
        replacement: resolve(__dirname, "../../packages/sdk/src/og/og.ts"),
      },
      {
        find: "camox/metadata",
        replacement: resolve(__dirname, "../../packages/sdk/src/features/metadata/sitemap.ts"),
      },
    ],
  },
  plugins: [
    tailwindcss(),
    nitro(),
    camox({
      projectSlug: "camox-playground-01",
      icons: "lucide",
      _internal: {
        authenticationUrl: "http://localhost:3274",
        apiUrl: "http://localhost:8787",
        runtimeBasePath: "/",
        enableExperimentalFeatures: true,
      },
    }),
    react(),
    babelPlugin({ presets: [reactCompilerPreset()] }),
  ],
  optimizeDeps: {
    exclude: ["camox"],
  },
});

export default config;
