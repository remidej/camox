import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { checkoutHostname } from "../../scripts/dev-hostname";

const config = defineConfig({
  server: {
    port: Number(process.env.CAMOX_DEV_DASHBOARD_PORT ?? 3274),
    // The launcher shares this URL with the API and playground. Only it may
    // reallocate the port; Vite must not silently move to a different one.
    strictPort: Boolean(process.env.CAMOX_DEV_DASHBOARD_PORT),
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    checkoutHostname(process.env.CAMOX_DEV_HOSTNAME),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    react({ compiler: true }),
  ],
  optimizeDeps: {
    include: ["@daveyplate/better-auth-ui"],
  },
});

export default config;
