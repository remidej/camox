import babelPlugin from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { camox } from "camox/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

import { checkoutHostname } from "../../scripts/dev-hostname";

const config = defineConfig({
  server: {
    port: Number(process.env.CAMOX_DEV_LANDING_PORT ?? 3001),
    strictPort: Boolean(process.env.CAMOX_DEV_LANDING_PORT),
  },
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
  },
  plugins: [
    checkoutHostname(process.env.CAMOX_DEV_HOSTNAME),
    tailwindcss(),
    nitro(),
    camox({
      projectSlug: "camox-landing",
    }),
    react(),
    babelPlugin({ presets: [reactCompilerPreset()] }),
  ],
  optimizeDeps: {
    include: ["@paper-design/shaders-react"],
  },
});

export default config;
