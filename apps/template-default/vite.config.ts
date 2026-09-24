import babelPlugin from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { camox } from "camox/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    nitro(),
    camox({
      projectSlug: "camox-template-default-01", // camox-cli:replace-slug
      // camox-cli:dev-only-start
      _internal: {
        authenticationUrl: process.env.VITE_DASHBOARD_URL ?? "http://localhost:3274",
        apiUrl: process.env.VITE_API_URL ?? "http://localhost:8787",
      },
      // camox-cli:dev-only-end
    }),
    react(),
    babelPlugin({ presets: [reactCompilerPreset()] }),
  ],
});
