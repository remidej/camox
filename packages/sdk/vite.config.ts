import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "node:path";

const config = defineConfig({
  plugins: [
    tsconfigPaths(),
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
        "features/preview/CamoxPreview": resolve(
          __dirname,
          "src/features/preview/CamoxPreview.tsx",
        ),
        "features/playground/CamoxPlayground": resolve(
          __dirname,
          "src/features/playground/CamoxPlayground.tsx",
        ),
        "features/provider/CamoxProvider": resolve(
          __dirname,
          "src/features/provider/CamoxProvider.tsx",
        ),
        "features/studio/CamoxStudio": resolve(
          __dirname,
          "src/features/studio/CamoxStudio.tsx",
        ),
        "features/vite/vite": resolve(__dirname, "src/features/vite/vite.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // Mark all npm packages as external so they're not bundled
      external: (id) => {
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
