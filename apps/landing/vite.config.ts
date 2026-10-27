import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { camox } from "camox/vite";
import { defineConfig } from "vite-plus";

import { checkoutHostname } from "../../scripts/dev-hostname";

// Tests render Components and compile the stylesheet in Node: they need neither the Worker
// nor Camox's dev runtime.
const isTest = Boolean(process.env.VITEST);

const config = defineConfig({
  // The footer's copyright year. Inlined at build time so the Worker and the browser render
  // the same text: Workers freeze the clock at the epoch outside a request, so reading it
  // when a module loads gives 1970 on the server.
  define: {
    __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()),
  },
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
    !isTest && cloudflare(),
    !isTest &&
      camox({
        projectId: "01a15fff-627a-72f1-ba3b-dc5fde0bbb45",
      }),
    react({ compiler: true }),
  ],
  test: {
    environment: "node",
    // Process stylesheets, so tests can read the compiled Theme.
    css: true,
  },
  optimizeDeps: {
    include: ["@paper-design/shaders-react"],
  },
});

export default config;
