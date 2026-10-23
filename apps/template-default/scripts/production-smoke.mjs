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
import { block as featureTabs } from "@/blocks/feature-tabs";
import { block as gallery } from "@/blocks/gallery";
import { block as callToAction } from "@/blocks/call-to-action";
import { Carousel, CarouselSlide } from "@/components/ui/carousel";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsItem, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MobileMenu } from "@/components/ui/mobile-menu";
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
    const mobileMenu = renderToStaticMarkup(createElement(MobileMenu, null,
      createElement("a", { href: "/pricing" }, "Pricing")));
    const tabs = renderToStaticMarkup(createElement(Tabs, null,
      ["First tab", "Second tab", "Third tab"].map((label) =>
        createElement(TabsItem, { key: label },
          createElement(TabsTrigger, null, label),
          createElement(TabsContent, null, label + " panel")))));
    const dialog = renderToStaticMarkup(createElement(Dialog, null,
      createElement(DialogTrigger, null, "Open details"),
      createElement(DialogContent, null,
        createElement(DialogTitle, null, "Details"),
        createElement("p", null, "Dialog body"),
        createElement(DialogClose, null, "Done"))));
    const carousel = renderToStaticMarkup(createElement(Carousel, { label: "Gallery" },
      ["First slide", "Second slide", "Third slide"].map((text) =>
        createElement(CarouselSlide, { key: text }, text))));
    const settings = Object.fromEntries(
      [faq, footer, hero, navbar, youtubeVideo, featureTabs, gallery, callToAction].map((block) => [
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
    return Response.json({ html, buttons, mobileMenu, tabs, dialog, carousel, png: Array.from(bytes.slice(0, 8)), settings, sections });
  },
};
`,
  );

  const vitePlus = JSON.stringify(import.meta.resolve("vite-plus"));
  const run = (script, timeout) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root,
      // Hosted projects start from the Template, so it builds with their checks on.
      env: { ...process.env, HOME: home, CAMOX_INTERNAL_RELEASE: "0", CAMOX_INTERNAL_HOSTED: "1" },
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

  // The page default and the four schemes a block's "Color scheme" setting offers. Each
  // sets `color-scheme` and declares the variables the SDK colors highlights and empty images
  // from, so they resolve against that scheme's tokens rather than inheriting the values
  // computed on :root.
  const assetsDir = join(root, "dist/client/assets");
  const cssFiles = (await readdir(assetsDir)).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "The build emitted no stylesheet.");
  const css = (
    await Promise.all(cssFiles.map((file) => readFile(join(assetsDir, file), "utf8")))
  ).join("\n");
  const declared = declarationsBySelector(css);
  for (const scheme of [":root", ".light", ".dark", ".brand", ".tint"]) {
    for (const property of [
      "color-scheme",
      "--camox-highlight",
      "--camox-placeholder",
      "--camox-placeholder-ink",
    ]) {
      assert.ok(
        declared.get(scheme)?.has(property),
        `The built stylesheet doesn't declare ${property} on ${scheme}.`,
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

      // The Mobile menu needs no JS: a control opens the single list of links as a popover.
      const popover = result.mobileMenu.match(/<(\\w+)(?=[^>]*\\bpopover\\b)[^>]*\\bid="([^"]+)"[^>]*>(.*?)<\\/\\1>/);
      assert.ok(popover, result.mobileMenu);
      assert.match(popover[3], /<a href="\\/pricing">Pricing<\\/a>/);
      // HTML attribute names are case-insensitive, and React renders this one as "popoverTarget".
      const target = result.mobileMenu.match(/<button [^>]*\\bpopovertarget="([^"]+)"/i);
      assert.equal(target?.[1], popover[2], result.mobileMenu);

      // Tabs are native: one <details> per tab, sharing one name, so one opens at a time.
      // Every panel is in the markup, opened or not.
      const tabs = [...result.tabs.matchAll(/<details([^>]*)><summary[^>]*>([^<]*)<\\/summary>(.*?)<\\/details>/g)];
      assert.equal(tabs.length, 3, result.tabs);
      const tabNames = tabs.map(([, attributes]) => /\\sname="([^"]+)"/.exec(attributes)?.[1]);
      assert.ok(tabNames[0], result.tabs);
      assert.equal(new Set(tabNames).size, 1, result.tabs);
      for (const [index, label] of ["First tab", "Second tab", "Third tab"].entries()) {
        assert.equal(tabs[index][2], label, result.tabs);
        assert.match(tabs[index][3], new RegExp(label + " panel"), result.tabs);
      }

      // The dialog is a native <dialog>, opened and closed by its buttons' invoker commands,
      // and named by its title. Its content is in the markup while it's closed.
      const dialog = result.dialog.match(/<dialog([^>]*)>(.*?)<\\/dialog>/);
      assert.ok(dialog, result.dialog);
      assert.doesNotMatch(dialog[1], /\\sopen(=|\\s|$)/, result.dialog);
      assert.match(dialog[2], /Dialog body/);
      const dialogId = /\\sid="([^"]+)"/.exec(dialog[1])?.[1];
      assert.ok(dialogId, result.dialog);
      const commands = Object.fromEntries(
        [...result.dialog.matchAll(/<button ([^>]*)>([^<]*)<\\/button>/g)].map(([, attributes, text]) => [
          text,
          {
            command: /\\scommand="([^"]+)"/.exec(attributes)?.[1],
            for: /\\scommandfor="([^"]+)"/.exec(attributes)?.[1],
          },
        ]),
      );
      assert.deepEqual(commands["Open details"], { command: "show-modal", for: dialogId }, result.dialog);
      assert.deepEqual(commands["Done"], { command: "close", for: dialogId }, result.dialog);
      const labelledBy = /\\saria-labelledby="([^"]+)"/.exec(dialog[1])?.[1];
      assert.match(dialog[2], new RegExp('id="' + labelledBy + '"[^>]*>Details<'), result.dialog);

      // The carousel is a labelled scroller the keyboard can reach, with every slide in the markup.
      const carousel = /<\\w+([^>]*\\saria-roledescription="carousel"[^>]*)>/.exec(result.carousel);
      assert.ok(carousel, result.carousel);
      assert.match(carousel[1], /\\saria-label="Gallery"/, result.carousel);
      assert.match(result.carousel, /<\\w+[^>]*\\stabindex="0"/, result.carousel);
      const slides = [...result.carousel.matchAll(/<\\w+[^>]*\\saria-roledescription="slide"[^>]*>([^<]*)</g)];
      assert.deepEqual(slides.map(([, text]) => text), ["First slide", "Second slide", "Third slide"], result.carousel);

      // Editors pick the same color schemes on every Template block.
      const defaultSchemes = {
        hero: "dark",
        navbar: "dark",
        footer: "dark",
        faq: "light",
        "youtube-video": "light",
        "feature-tabs": "light",
        gallery: "light",
        "call-to-action": "brand",
      };
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

/**
 * The properties each selector of a stylesheet declares, comments stripped. Declarations
 * inside a nested at-rule (Tailwind wraps `color-mix()` fallbacks in `@supports`) count for
 * the rule around it.
 */
function declarationsBySelector(css) {
  const declared = new Map();
  const open = [];
  let buffer = "";
  const flushDeclaration = () => {
    const property = /^\s*([\w-]+)\s*:/.exec(buffer)?.[1];
    if (property) {
      for (const selector of open.at(-1) ?? []) {
        declared.set(selector, (declared.get(selector) ?? new Set()).add(property));
      }
    }
    buffer = "";
  };
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      const prelude = buffer.trim();
      open.push(
        prelude.startsWith("@") ? (open.at(-1) ?? []) : prelude.split(",").map((s) => s.trim()),
      );
      buffer = "";
    } else if (char === ";") {
      flushDeclaration();
    } else if (char === "}") {
      flushDeclaration();
      open.pop();
    } else {
      buffer += char;
    }
  }
  return declared;
}
