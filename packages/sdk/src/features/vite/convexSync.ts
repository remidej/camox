import type { ViteDevServer } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let convexProcess: ChildProcess | null = null;

interface ConvexDevOptions {
  server: ViteDevServer;
  deployKey: string;
}

export function startConvexDev({ server, deployKey }: ConvexDevOptions): void {
  // Get the SDK root path (where package.json exists)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sdkRoot = resolve(__dirname, "../../..");

  server.config.logger.info(`[camox] Starting convex dev from: ${sdkRoot}`, {
    timestamp: true,
  });

  // Spawn convex dev process from SDK root
  convexProcess = spawn("npx", ["convex", "dev"], {
    cwd: sdkRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: {
      ...process.env,
      CONVEX_DEPLOY_KEY: deployKey,
    },
  });

  convexProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        server.config.logger.info(`[convex] ${line}`, { timestamp: true });
      }
    });
  });

  convexProcess.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        server.config.logger.error(`[convex] ${line}`, { timestamp: true });
      }
    });
  });

  convexProcess.on("close", (code) => {
    if (code !== 0 && code !== null) {
      server.config.logger.error(
        `[camox] convex dev exited with code ${code}`,
        { timestamp: true },
      );
    }
  });

  // Clean up on server close
  server.httpServer?.on("close", () => {
    stopConvexDev();
  });
}

export function stopConvexDev(): void {
  if (convexProcess) {
    convexProcess.kill();
    convexProcess = null;
  }
}
