import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { camox } from "camox/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 7400,
    // camox-cli:dev-only-start
    host: process.env.CAMOX_DEV_HOSTNAME,
    ...(process.env.CAMOX_DEV_TEMPLATE_PORT
      ? { port: Number(process.env.CAMOX_DEV_TEMPLATE_PORT), strictPort: true }
      : {}),
    // camox-cli:dev-only-end
  },
  plugins: [
    tailwindcss(),
    cloudflare(),
    camox({
      projectId: "01a15fff-627c-7e88-83cd-ceb11f804d47", // camox-cli:replace-project-id
      // camox-cli:dev-only-start
      _internal: {
        authenticationUrl: process.env.VITE_DASHBOARD_URL ?? "http://localhost:3274",
        apiUrl: process.env.VITE_API_URL ?? "http://localhost:8787",
        // The deploy token apps/api's dev seed gives every project.
        seedLiveDeployToken: "camox-dev-deploy-token",
      },
      // camox-cli:dev-only-end
    }),
    react({ compiler: true }),
  ],
});
