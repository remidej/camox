import { defineConfig } from "vite-plus";

export default defineConfig({
  logLevel: "silent",
  test: {
    // Routing is pure logic over its bindings, so the tests fake them and run in Node.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
