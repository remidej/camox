import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  for (const file of ["src", "vite.config.ts", "tsconfig.json", "package.json", "wrangler.jsonc"]) {
    await cp(join(appRoot, file), join(root, file), { recursive: true });
  }
  await symlink(join(appRoot, "node_modules"), join(root, "node_modules"), "dir");

  // Wrap the Camox Worker with a route that exercises what a deployment must bundle.
  const wranglerPath = join(root, "wrangler.jsonc");
  await writeFile(
    wranglerPath,
    (await readFile(wranglerPath, "utf8")).replace('"camox/worker"', '"./smoke-worker.ts"'),
  );
  await writeFile(
    join(root, "smoke-worker.ts"),
    `import { Dialog } from "@base-ui/react/dialog";
import camox from "camox/worker";
import { ImageResponse } from "camox/_internal/imageResponse";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/smoke") return camox.fetch(request);
    const element = createElement("div", { style: { color: "black", background: "white" } }, "Production smoke");
    const image = new ImageResponse(element, { width: 320, height: 160 });
    const bytes = new Uint8Array(await image.arrayBuffer());
    const html = renderToStaticMarkup(createElement(Dialog.Root, null,
      createElement(Dialog.Trigger, null, "Production smoke")));
    return Response.json({ html, png: Array.from(bytes.slice(0, 8)) });
  },
};
`,
  );

  const vitePlus = JSON.stringify(import.meta.resolve("vite-plus"));
  const run = (script, timeout) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root,
      env: { ...process.env, HOME: home, CAMOX_INTERNAL_RELEASE: "0" },
      encoding: "utf8",
      timeout,
      killSignal: "SIGKILL",
    });

  const build = run(
    `
    const { createBuilder } = await import(${vitePlus});
    const builder = await createBuilder({ root: ${JSON.stringify(root)} });
    await builder.buildApp();
  `,
    180_000,
  );
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  // Preview runs the built Worker in workerd, as Cloudflare does.
  const runtime = run(
    `
    import assert from "node:assert/strict";
    const { preview } = await import(${vitePlus});
    const server = await preview({ root: ${JSON.stringify(root)}, preview: { port: 0 }, logLevel: "silent" });
    try {
      const url = server.resolvedUrls.local[0];
      const health = await fetch(new URL("/_camox/health", url));
      assert.equal(health.status, 200, await health.clone().text());
      const response = await fetch(new URL("/smoke", url));
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.match(result.html, /Production smoke/);
      assert.deepEqual(result.png, [137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      await server.close();
    }
  `,
    60_000,
  );
  assert.equal(runtime.status, 0, `${runtime.stdout}\n${runtime.stderr}`);
  console.log("The built Worker rendered HTML and a Takumi PNG in workerd.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
