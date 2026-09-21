import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "camox-production-"));

try {
  const root = join(temp, "app");
  const home = join(temp, "home");
  await mkdir(join(home, ".camox"), { recursive: true });
  await writeFile(
    join(home, ".camox/auth.json"),
    JSON.stringify({
      "http://localhost:3274": { token: "smoke", name: "Smoke", email: "smoke@example.com" },
    }),
  );
  await mkdir(root);
  await mkdir(join(temp, "node_modules"));
  // Nitro resolves its builder from the project root. Match Vite+'s own Vite
  // dependency without relying on workspace hoisting in this temporary app.
  const vitePackage = createRequire(import.meta.resolve("vite-plus")).resolve("vite/package.json");
  await symlink(dirname(vitePackage), join(temp, "node_modules/vite"), "dir");
  for (const file of ["src", "vite.config.ts", "tsconfig.json", "package.json"]) {
    await cp(join(appRoot, file), join(root, file), { recursive: true });
  }
  await symlink(join(appRoot, "node_modules"), join(root, "node_modules"), "dir");
  const configPath = join(root, "vite.config.ts");
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace(
      "nitro()",
      'nitro({ routes: { "/smoke": "./routes/smoke.ts" } })',
    ),
  );
  await mkdir(join(root, "routes"), { recursive: true });
  await writeFile(
    join(root, "routes/smoke.ts"),
    `import { Dialog } from "@base-ui/react/dialog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageResponse } from "camox/_internal/imageResponse";

export default async () => {
  const element = createElement("div", { style: { color: "black", background: "white" } }, "Production smoke");
  const image = new ImageResponse(element, { width: 320, height: 160 });
  const bytes = new Uint8Array(await image.arrayBuffer());
  const html = renderToStaticMarkup(createElement(Dialog.Root, null,
    createElement(Dialog.Trigger, null, "Production smoke")));
  return Response.json({ html, png: Array.from(bytes.slice(0, 8)) });
};
`,
  );
  const build = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { createBuilder } = await import(${JSON.stringify(import.meta.resolve("vite-plus"))});
    const builder = await createBuilder({ root: ${JSON.stringify(root)} });
    await builder.buildApp();
  `,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        CAMOX_INTERNAL_RELEASE: "0",
        NITRO_PRESET: "node-middleware",
      },
      encoding: "utf8",
      timeout: 180_000,
      killSignal: "SIGKILL",
    },
  );
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  // Move only the deployment artifact away from all workspace node_modules.
  const deployment = join(temp, "deployment");
  await cp(join(root, ".output"), deployment, { recursive: true });
  await rm(root, { recursive: true, force: true });
  await rm(join(temp, "node_modules"), { recursive: true, force: true });
  const runtime = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { createServer } from "node:http";
    const { middleware } = await import("./server/index.mjs");
    const server = createServer(middleware);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch("http://127.0.0.1:" + server.address().port + "/smoke");
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.match(result.html, /Production smoke/);
      assert.deepEqual(result.png, [137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  `,
    ],
    {
      cwd: deployment,
      env: { ...process.env, NODE_PATH: "", NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 30_000,
      killSignal: "SIGKILL",
    },
  );
  assert.equal(runtime.status, 0, `${runtime.stdout}\n${runtime.stderr}`);
  console.log("Production server rendered HTML and a Takumi PNG from an isolated deployment.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
