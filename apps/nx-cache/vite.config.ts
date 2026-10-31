import { defineConfig } from "vite-plus";

export default defineConfig({
  logLevel: "silent",
  test: {
    // Serves the Worker in Node, with a fake bucket, to Nx's own cache client.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
