import { cloudflare } from "@cloudflare/vite-plugin";
import babelPlugin from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const config = defineConfig({
  server: {
    port: Number(process.env.CAMOX_DEV_DASHBOARD_PORT ?? 3274),
    // The launcher shares this URL with the API and playground. Only it may
    // reallocate the port; Vite must not silently move to a different one.
    strictPort: Boolean(process.env.CAMOX_DEV_DASHBOARD_PORT),
  },
  lint: {
    plugins: ["react"],
    rules: {
      "no-nested-ternary": "error",
    },
    ignorePatterns: ["src/routeTree.gen.ts"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    react(),
    babelPlugin({ presets: [reactCompilerPreset()] }),
  ],
  optimizeDeps: {
    include: ["@daveyplate/better-auth-ui"],
  },
});

export default config;
