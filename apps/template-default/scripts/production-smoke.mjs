import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    `import camox from "camox/worker";
import { block as faq } from "@/blocks/faq";
import { block as footer } from "@/blocks/footer";
import { block as hero } from "@/blocks/hero";
import { block as navbar } from "@/blocks/navbar";
import { block as youtubeVideo } from "@/blocks/youtube-video";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { NavigationProvider } from "camox/navigation";
import { ImageResponse } from "camox/_internal/imageResponse";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/smoke") return camox.fetch(request);
    const element = createElement("div", { style: { color: "black", background: "white" } }, "Production smoke");
    const image = new ImageResponse(element, { width: 320, height: 160 });
    const bytes = new Uint8Array(await image.arrayBuffer());
    const html = renderToStaticMarkup(createElement(Accordion, null,
      ["Production smoke", "Second question"].map((question) =>
        createElement(AccordionItem, { key: question },
          createElement(AccordionTrigger, null, question),
          createElement(AccordionContent, null, "Answer")))));
    const location = { hash: "", href: "http://localhost/", pathname: "/", search: "" };
    // A link field hands its render prop "to", not "href".
    const buttons = {
      link: renderToStaticMarkup(createElement(NavigationProvider, { initialLocation: location },
        createElement(Button, { to: "/pricing", children: "Get started" }))),
      button: renderToStaticMarkup(createElement(Button, null, "Get started")),
    };
    const settings = Object.fromEntries(
      [faq, footer, hero, navbar, youtubeVideo].map((block) => [
        block._internal.id,
        block._internal.settingsSchema?.properties ?? {},
      ]),
    );
    const sections = Object.fromEntries(
      ["light", "dark", "brand", "tint"].map((scheme) => [
        scheme,
        renderToStaticMarkup(createElement(Section, { scheme }, "Content")),
      ]),
    );
    return Response.json({ html, buttons, png: Array.from(bytes.slice(0, 8)), settings, sections });
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

  // The SDK colors highlights and empty images from these variables. Each color scheme
  // must declare them, so they resolve against that scheme's tokens rather than inheriting
  // the values computed on :root.
  const assetsDir = join(root, "dist/client/assets");
  const cssFiles = (await readdir(assetsDir)).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "The build emitted no stylesheet.");
  const css = (
    await Promise.all(cssFiles.map((file) => readFile(join(assetsDir, file), "utf8")))
  ).join("\n");
  const declarationsBySelector = new Map();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(",").map((s) => s.trim())) {
      declarationsBySelector.set(selector, `${declarationsBySelector.get(selector) ?? ""};${body}`);
    }
  }
  for (const scheme of [":root", ".light", ".dark", ".brand", ".tint"]) {
    for (const variable of [
      "--camox-highlight",
      "--camox-placeholder",
      "--camox-placeholder-ink",
    ]) {
      assert.match(
        declarationsBySelector.get(scheme) ?? "",
        new RegExp(`(^|;)\\s*${variable}\\s*:`),
        `The built stylesheet doesn't declare ${variable} on ${scheme}.`,
      );
    }
  }

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

      // The Accordion is native: its <details> share one name, so only one opens at a time.
      const names = [...result.html.matchAll(/<details[^>]*\\bname="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(names.length, 2, result.html);
      assert.equal(new Set(names).size, 1, result.html);
      assert.match(result.html, /<summary[^>]*>Production smoke/);

      // A Button given a link renders a link; otherwise a <button>.
      assert.match(result.buttons.link, /^<a [^>]*href="\\/pricing"[^>]*>Get started<\\/a>$/);
      assert.match(result.buttons.button, /^<button [^>]*>Get started<\\/button>$/);
      assert.deepEqual(result.png, [137, 80, 78, 71, 13, 10, 26, 10]);

      // Editors pick the same color schemes on every Template block.
      const defaultSchemes = { hero: "dark", navbar: "dark", footer: "dark", faq: "light", "youtube-video": "light" };
      assert.deepEqual(Object.keys(result.settings).sort(), Object.keys(defaultSchemes).sort());
      for (const [blockId, defaultScheme] of Object.entries(defaultSchemes)) {
        const settings = result.settings[blockId];
        assert.equal("theme" in settings, false, blockId + " still has a theme setting.");
        assert.ok(settings.scheme, blockId + " has no scheme setting.");
        assert.equal(settings.scheme.title, "Color scheme", blockId);
        assert.deepEqual(
          settings.scheme.enumLabels,
          { light: "Light", dark: "Dark", brand: "Brand", tint: "Tint" },
          blockId,
        );
        assert.equal(settings.scheme.default, defaultScheme, blockId);
      }

      // A block's Section puts everything inside it in the chosen color scheme.
      for (const [scheme, html] of Object.entries(result.sections)) {
        assert.match(html, new RegExp('^<section class="([^"]* )?' + scheme + '( [^"]*)?">Content</section>$'), scheme);
      }
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
