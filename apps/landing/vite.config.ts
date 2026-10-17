import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { camox } from "camox/vite";
import { defineConfig } from "vite-plus";

import { checkoutHostname } from "../../scripts/dev-hostname";

const config = defineConfig({
  server: {
    port: Number(process.env.CAMOX_DEV_LANDING_PORT ?? 3001),
    strictPort: Boolean(process.env.CAMOX_DEV_LANDING_PORT),
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    checkoutHostname(process.env.CAMOX_DEV_HOSTNAME),
    tailwindcss(),
    cloudflare(),
    camox({
      projectSlug: "camox-landing",
    }),
    react({ compiler: true }),
  ],
  optimizeDeps: {
    include: ["@paper-design/shaders-react"],
  },
});

export default config;
