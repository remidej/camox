import { resolve } from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { camox } from "../../packages/sdk/src/features/vite/vite";
import { checkoutHostname } from "../../scripts/dev-hostname";
import { seedDemoArticles } from "./demoArticles";
import { seedHeroGlobe } from "./demoGlobe";

const config = defineConfig({
  server: {
    port: Number(process.env.CAMOX_DEV_PLAYGROUND_PORT ?? 3000),
    strictPort: Boolean(process.env.CAMOX_DEV_PLAYGROUND_PORT),
  },
  resolve: {
    tsconfigPaths: true,
    alias: [
      // Point to SDK source files directly instead of built output
      {
        find: "camox/createCollection",
        replacement: resolve(__dirname, "../../packages/sdk/src/core/createCollection.ts"),
      },
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
    ],
  },
  plugins: [
    checkoutHostname(process.env.CAMOX_DEV_HOSTNAME),
    tailwindcss(),
    cloudflare(),
    camox({
      projectId: "01a15fff-627b-7fa1-938b-93ab659c1acc",
      icons: "lucide",
      _internal: {
        authenticationUrl: process.env.VITE_DASHBOARD_URL ?? "http://localhost:3274",
        apiUrl: process.env.VITE_API_URL ?? "http://localhost:8787",
        runtimeBasePath: "/",
        devSignIn: {
          open: Boolean(process.env.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE),
          openOnceFile: process.env.CAMOX_DEV_OPEN_PLAYGROUND_ONCE_FILE,
        },
        afterSync: async (context) => {
          await seedDemoArticles(context);
          await seedHeroGlobe(context);
        },
        // The deploy token apps/api's dev seed gives every project: each save releases to
        // local Live with it.
        localDeployToken: "camox-dev-deploy-token",
      },
    }),
    react({ compiler: true }),
  ],
  optimizeDeps: {
    exclude: ["camox"],
  },
});

export default config;
