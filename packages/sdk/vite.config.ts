import { resolve } from "node:path";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    viteReact(),
    dts({
      tsconfigPath: "./tsconfig.json",
      rollupTypes: false,
      outDir: "dist",
      entryRoot: "src",
      include: ["src/**/*"],
      compilerOptions: {
        declarationMap: true,
      },
    }),
  ],
  build: {
    cssCodeSplit: true,
    minify: false,
    lib: {
      entry: {
        "core/createApp": resolve(__dirname, "src/core/createApp.ts"),
        "core/createBlock": resolve(__dirname, "src/core/createBlock.tsx"),
        "core/createLayout": resolve(__dirname, "src/core/createLayout.tsx"),
        "features/preview/CamoxPreview": resolve(
          __dirname,
          "src/features/preview/CamoxPreview.tsx",
        ),
        "features/content/CamoxContent": resolve(
          __dirname,
          "src/features/content/CamoxContent.tsx",
        ),
        "features/provider/CamoxProvider": resolve(
          __dirname,
          "src/features/provider/CamoxProvider.tsx",
        ),
        "features/studio/CamoxStudio": resolve(__dirname, "src/features/studio/CamoxStudio.tsx"),
        "features/vite/vite": resolve(__dirname, "src/features/vite/vite.ts"),
        "features/routes/pageRoute": resolve(__dirname, "src/features/routes/pageRoute.tsx"),
        "features/routes/ogRoute": resolve(__dirname, "src/features/routes/ogRoute.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // Mark all npm packages as external so they're not bundled
      external: (id) => {
        // Let the consuming app's Vite handle the studio CSS ?url import
        if (id === "camox/studio.css?url") return true;
        // Keep our source files and CSS
        if (id.startsWith(".") || id.startsWith("/")) return false;
        if (id.endsWith(".css") || id.includes(".css?")) return false;
        // Everything else (npm packages) is external
        return true;
      },
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        assetFileNames: "[name][extname]",
      },
    },
  },
});

export default config;
