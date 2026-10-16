import { defineConfig } from "nitro";

export default defineConfig({
  preset: "cloudflare_module",
  cloudflare: {
    wrangler: {
      name: "camox-landing",
      compatibility_date: "2026-04-11",
      compatibility_flags: ["nodejs_compat"],
      routes: [{ pattern: "camox.dev", custom_domain: true }],
      observability: {
        logs: {
          enabled: true,
          invocation_logs: true,
        },
        traces: {
          enabled: true,
        },
      },
    },
  },
});
