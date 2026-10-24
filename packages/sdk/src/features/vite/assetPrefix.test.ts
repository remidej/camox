import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { SERVER_AUTH_COOKIE_NAME } from "../../lib/server-auth-cookie";
import { type FixtureBuild, buildFixtureApp } from "./fixtureApp";

const REVISION_PREFIX = "/_camox/r/01a15fff-627b-7fa1-938b-93ab659c1acd/";
const MEMBER = { Cookie: `${SERVER_AUTH_COOKIE_NAME}=member` };

const project = { id: 1, name: "Fixture", slug: "fixture", updatedAt: 1 };
const pageId = "0199f0a0-0000-7000-8000-000000000001";
const blockId = "0199f0a0-0000-7000-8000-000000000002";

/** A Camox API with one Live page, `/`, holding a hero block, where any session is a member. */
async function startApi() {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://api").pathname;
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ json: body }));
    };
    if (path.endsWith("/locales/list")) return json([{ tag: "en", isDefault: true }]);
    if (path.endsWith("/getByUuid")) return json(project);
    if (path.endsWith("/listBySlug"))
      return json({
        projectName: project.name,
        pages: [{ id: pageId, fullPath: "/", pathSegment: "", updatedAt: 1, layoutId: null }],
      });
    if (path.endsWith("/getByPath"))
      return json({
        page: {
          id: pageId,
          fullPath: "/",
          pathSegment: "",
          metaTitle: "Home",
          layoutId: null,
          blockIds: [blockId],
        },
        layout: null,
        project,
        projectName: project.name,
        blocks: [
          {
            id: blockId,
            pageId,
            type: "hero",
            content: { title: "Hello" },
            settings: {},
            position: "a0",
          },
        ],
        files: [],
        repeatableItems: [],
      });
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let api: Awaited<ReturnType<typeof startApi>>;
let build: FixtureBuild;

before(async () => {
  api = await startApi();
  build = await buildFixtureApp({ apiUrl: api.url });
});

after(async () => {
  await build?.cleanup();
  await api?.close();
});

/** The pages a visitor and a member load: the page, the page in the studio, and the studio. */
const RENDERS = [
  { name: "a visitor's page", path: "/", headers: {} },
  { name: "a member's page", path: "/", headers: MEMBER },
  { name: "the studio", path: "/camox", headers: MEMBER },
];

/** Every script, stylesheet and modulepreload URL an HTML document loads. */
function loadedUrls(html: string) {
  const urls = {
    script: [] as string[],
    stylesheet: [] as string[],
    modulepreload: [] as string[],
  };
  for (const [tag] of html.matchAll(/<(script|link)\b[^>]*>/g)) {
    const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
    if (tag.startsWith("<script")) {
      const src = attribute("src");
      if (src) urls.script.push(src);
      continue;
    }
    const rel = attribute("rel");
    const href = attribute("href");
    if (href && (rel === "stylesheet" || rel === "modulepreload")) urls[rel].push(href);
  }
  return urls;
}

/** The file of the client build a URL under `prefix` names, asserting it is under it. */
function builtFile(url: string, prefix: string) {
  assert.ok(url.startsWith(prefix), `${url} isn't under ${prefix}`);
  const file = join(build.clientDir, url.slice(prefix.length));
  assert.ok(existsSync(file), `${url} names no file of the build`);
  return file;
}

async function assertAssetsUnder(prefix: string, served: { assetPrefix?: string }) {
  const worker = await build.serve(served);
  try {
    let cssUrls = 0;
    for (const render of RENDERS) {
      const response = await worker.fetch(render.path, { headers: render.headers });
      const html = await response.text();
      assert.equal(response.status, 200, `${render.name}: ${html}`);
      const urls = loadedUrls(html);
      assert.ok(urls.script.length > 0, `${render.name} loads no script`);
      assert.ok(urls.stylesheet.length > 0, `${render.name} loads no stylesheet`);
      for (const url of [...urls.script, ...urls.modulepreload]) builtFile(url, prefix);
      for (const url of urls.stylesheet) {
        const css = await readFile(builtFile(url, prefix), "utf8");
        for (const [, reference] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
          if (reference!.startsWith("data:") || reference!.startsWith("#")) continue;
          builtFile(new URL(reference!, new URL(url, "http://site")).pathname, prefix);
          cssUrls++;
        }
      }
    }
    assert.ok(cssUrls > 0, "No stylesheet names a file with url()");
  } finally {
    await worker.close();
  }
}

void test("the built server renders every asset URL under / when no prefix is set", async () => {
  await assertAssetsUnder("/", {});
});

void test("the same build renders every asset URL under a revision's prefix when it is set", async () => {
  await assertAssetsUnder(REVISION_PREFIX, { assetPrefix: REVISION_PREFIX });
});

void test("the renderer document loads the build's renderer client, with or without a prefix", async () => {
  for (const prefix of ["/", REVISION_PREFIX]) {
    const worker = await build.serve(prefix === "/" ? {} : { assetPrefix: prefix });
    try {
      const response = await worker.fetch("/_camox/renderer", { headers: MEMBER });
      const html = await response.text();
      assert.equal(response.status, 200, html);
      const [script, ...others] = loadedUrls(html).script;
      assert.equal(others.length, 0);
      builtFile(script!, prefix);
      assert.match(
        script!,
        /\/camox-renderer-client\.mjs$/,
        `${script} isn't the renderer's client`,
      );
    } finally {
      await worker.close();
    }
  }
});

void test("client chunks name every build file relative to themselves, wherever they're served", async () => {
  const chunksDir = join(build.clientDir, "_chunks");
  const builtFiles = new Map<string, string>();
  for (const dir of ["_chunks", "assets"])
    for (const file of await readdir(join(build.clientDir, dir)))
      builtFiles.set(file, join(build.clientDir, dir, file));

  let references = 0;
  for (const chunk of await readdir(chunksDir)) {
    const code = await readFile(join(chunksDir, chunk), "utf8");
    for (const [, path] of code.matchAll(/[`"']([\w./-]+)[`"']/g)) {
      const file = builtFiles.get(path!.slice(path!.lastIndexOf("/") + 1));
      if (!file) continue;
      references++;
      assert.match(path!, /^\.\.?\//, `${chunk} names ${path} by a path that isn't relative`);
      assert.equal(resolve(chunksDir, path!), file, `${chunk} names ${path}`);
    }
  }
  assert.ok(references > 0, "No client chunk names another build file");
});
