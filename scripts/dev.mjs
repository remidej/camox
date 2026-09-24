import { spawn } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const defaultDashboardUrl = "http://localhost:3274";

// Check both loopback families: Vite and Wrangler need not resolve localhost
// to the same address. Release the probes before starting the real servers.
export async function findAvailablePort(start) {
  for (let port = start; port <= 65535; port++) {
    const probes = [];
    try {
      for (const host of ["127.0.0.1", "::1"]) {
        const server = createServer();
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen({ port, host, exclusive: true }, resolve);
        }).catch((error) => {
          if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) return;
          throw error;
        });
        if (server.listening) probes.push(server);
      }
      return port;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    } finally {
      await Promise.all(probes.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  }
  throw new Error(`No available dev port at or above ${start}`);
}

export async function createDevEnvironment(env = process.env) {
  const apiPort = await findAvailablePort(8787);
  let dashboardPort = await findAvailablePort(3274);
  if (dashboardPort === apiPort) dashboardPort = await findAvailablePort(dashboardPort + 1);
  return {
    ...env,
    CAMOX_DEV_API_PORT: String(apiPort),
    CAMOX_DEV_DASHBOARD_PORT: String(dashboardPort),
    VITE_API_URL: `http://localhost:${apiPort}`,
    VITE_DASHBOARD_URL: `http://localhost:${dashboardPort}`,
  };
}

// The seed belongs to this checkout's database, not to a particular port.
// Alias only checkout-local credentials; never copy credentials from $HOME.
export async function aliasDevCredentials(repoRoot, dashboardUrl) {
  if (dashboardUrl === defaultDashboardUrl) return;
  const file = join(repoRoot, ".camox/auth.json");
  let tokens;
  try {
    tokens = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!Object.hasOwn(tokens, defaultDashboardUrl)) return;
  tokens[dashboardUrl] = tokens[defaultDashboardUrl];
  await writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
}

export function isPortConflict(output) {
  return /EADDRINUSE|ERR_ADDRESS_IN_USE|address already in use|Port \d+ is already in use/i.test(
    output,
  );
}

// Keep Nx as the task runner, but own its process group so retries and Ctrl-C
// stop the whole checkout rather than leaving orphaned dev servers behind.
export async function runDevCommand(
  command,
  args,
  { cwd, env, retryOnPortConflict = false, ownProcessGroup = true },
) {
  const detached = ownProcessGroup && process.platform !== "win32";
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["inherit", "pipe", "pipe"],
    detached,
  });
  let portConflict = false;
  let signal;
  let killTimer;
  let recentOutput = "";
  const kill = (killSignal) => {
    if (!child.pid) return;
    try {
      if (!detached) {
        child.kill(killSignal);
        return;
      }
      process.kill(-child.pid, killSignal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const stop = () => {
    if (killTimer) return;
    kill("SIGTERM");
    killTimer = setTimeout(() => kill("SIGKILL"), 5000);
    killTimer.unref();
  };
  const onSignal = (receivedSignal) => {
    signal = receivedSignal;
    stop();
  };
  const onInterrupt = () => onSignal("SIGINT");
  const onTerminate = () => onSignal("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  for (const [stream, destination] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream.on("data", (chunk) => {
      destination.write(chunk);
      if (!retryOnPortConflict || portConflict) return;
      recentOutput = (recentOutput + chunk.toString()).slice(-4096);
      if (!isPortConflict(recentOutput)) return;
      portConflict = true;
      stop();
    });
  }
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode) => resolve(exitCode ?? 1));
    });
    if (signal) return { code: signal === "SIGINT" ? 130 : 143, portConflict, signal };
    return { code: portConflict ? 1 : code, portConflict, signal };
  } finally {
    // The command has exited; do not leave any remaining members of its group.
    kill("SIGKILL");
    clearTimeout(killTimer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

async function main() {
  const nx = require.resolve("nx/bin/nx.js");
  for (let attempt = 0; attempt < 3; attempt++) {
    const env = await createDevEnvironment();
    await aliasDevCredentials(root, env.VITE_DASHBOARD_URL);
    console.info(`\nCheckout dev servers (${root}):`);
    console.info(`  API:       ${env.VITE_API_URL}`);
    console.info(`  Dashboard: ${env.VITE_DASHBOARD_URL}`);
    console.info("  Other frontends print their URLs when ready.\n");
    const result = await runDevCommand(
      process.execPath,
      [nx, "run-many", "-t", "dev", "--nxBail", "--outputStyle=stream", ...process.argv.slice(2)],
      { cwd: root, env, retryOnPortConflict: true },
    );
    if (result.portConflict && !result.signal && attempt < 2) {
      console.info("\nA dev port was taken during startup; reallocating checkout URLs.\n");
      continue;
    }
    process.exitCode = result.code;
    return;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
