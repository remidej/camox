import { createRequire } from "node:module";
import path from "node:path";

import { findAvailablePort, runDevCommand } from "../../../scripts/dev.mjs";

const require = createRequire(import.meta.url);
// Wrangler's exports map hides its bin, so locate it from the exported package.json.
const wranglerBin = path.join(
  path.dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const coordinated = Boolean(process.env.CAMOX_DEV_API_PORT);

for (let attempt = 0; attempt < 3; attempt++) {
  const port = process.env.CAMOX_DEV_API_PORT ?? String(await findAvailablePort(8787));
  const args = [
    wranglerBin,
    "dev",
    "--port",
    port,
    "--ip",
    "127.0.0.1",
    "--host",
    `${process.env.CAMOX_DEV_HOSTNAME ?? "localhost"}:${port}`,
  ];
  if (process.env.VITE_DASHBOARD_URL) {
    args.push("--var", `DASHBOARD_URL:${process.env.VITE_DASHBOARD_URL}`);
  }
  const result = await runDevCommand(process.execPath, [...args, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    retryOnPortConflict: !coordinated,
    // Under Nx, stay in the launcher's group so its shutdown also owns workerd.
    ownProcessGroup: !coordinated,
  });
  if (result.portConflict && !result.signal && attempt < 2) continue;
  process.exitCode = result.code;
  break;
}
