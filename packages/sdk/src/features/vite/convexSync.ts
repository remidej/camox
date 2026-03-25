import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { ViteDevServer } from "vite";

export const LOCAL_CONVEX_URL = "http://127.0.0.1:3210";
export const LOCAL_CONVEX_SITE_URL = "http://127.0.0.1:3211";

let convexProcess: ChildProcess | null = null;

function getBackendDir(): string {
  const require = createRequire(import.meta.url);
  const backendPkg = require.resolve("@camox/backend-content/package.json");
  return dirname(backendPkg);
}

/** Parse team and project slugs from .env.local CONVEX_DEPLOYMENT comment */
function parseDeploymentInfo(backendDir: string): { team: string; project: string } | null {
  try {
    const envContent = readFileSync(join(backendDir, ".env.local"), "utf-8");
    const match = envContent.match(/CONVEX_DEPLOYMENT=.*#\s*team:\s*(\S+),\s*project:\s*(\S+)/);
    if (match) {
      return { team: match[1], project: match[2] };
    }
  } catch {
    // .env.local doesn't exist or can't be read
  }
  return null;
}

export function startConvexDev(server: ViteDevServer): Promise<void> {
  const cwd = getBackendDir();
  const log = (msg: string) => server.config.logger.info(`[convex] ${msg}`, { timestamp: true });

  const deploymentInfo = parseDeploymentInfo(cwd);
  if (!deploymentInfo) {
    log("Could not parse team/project from .env.local — skipping local Convex backend");
    return Promise.resolve();
  }

  const args = [
    "convex",
    "dev",
    "--configure",
    "existing",
    "--team",
    deploymentInfo.team,
    "--project",
    deploymentInfo.project,
    "--dev-deployment",
    "local",
    "--local-force-upgrade",
  ];

  log(`Starting: npx ${args.join(" ")}`);
  log(`Working directory: ${cwd}`);

  return new Promise<void>((resolve) => {
    convexProcess = spawn("npx", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    log(`Spawned process with PID: ${convexProcess.pid}`);

    let resolved = false;

    const handleOutput = (stream: string) => (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        log(`[${stream}] ${line}`);

        if (!resolved && /convex functions ready|watching for changes/i.test(line)) {
          log("Backend ready");
          resolved = true;
          resolve();
        }
      }
    };

    convexProcess.stdout?.on("data", handleOutput("stdout"));
    convexProcess.stderr?.on("data", handleOutput("stderr"));

    convexProcess.on("error", (err) => {
      log(`Process error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });

    convexProcess.on("close", (code, signal) => {
      log(`Process exited with code=${code} signal=${signal}`);
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });

    // Clean up on server close
    server.httpServer?.on("close", () => {
      stopConvexDev();
    });
  });
}

export function stopConvexDev(): void {
  if (convexProcess) {
    convexProcess.kill();
    convexProcess = null;
  }
}
