import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { DRAFT_HEADER, LOOK_TOKEN_HEADER } from "@camox/api-contract/drafts";
import { Window } from "happy-dom";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createBlock, type Block, type ContentFieldBuilder } from "../../core/createBlock";
import { createCollection } from "../../core/createCollection";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest } from "./runtime";

// The lightweight document the agent's `look` tool captures (ADR 0032): a page of a draft, read
// with the look token its cookie carries, as a visitor would see it, without the studio.

// The URL is supplied by Vite in applications.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("virtual:camox-"))
      return {
        url: `data:text/javascript,export default ${JSON.stringify("/studio.css")}`,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});

const DRAFT = "0199f0a0-0000-7000-8000-0000000000d1";
const TOKEN = "look-token-for-d1";
const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const pageId = "0199f0a0-0000-7000-8000-000000000001";
const blockId = "0199f0a0-0000-7000-8000-000000000002";
const ARTIFACT = "<!doctype html><title>Orbit</title><canvas></canvas>";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description: "A title",
  content: (field: ContentFieldBuilder) => ({
    title: field.string({ default: "" }),
    visual: field.artifact({ size: "fill" }),
  }),
  toReact: () => (
    <>
      <hero.Field name="title">{(props) => <h1 {...props} />}</hero.Field>
      <hero.Artifact name="visual">{(props) => <iframe {...props} />}</hero.Artifact>
    </>
  ),
  toMarkdown: ({ content }: { content: { title: string } }) => [content.title],
  toTitle: () => "Hero",
});
const banner = createBlock({
  id: "banner",
  title: "Banner",
  description: "A banner with points",
  content: (field) => ({
    title: field.string({ default: "Welcome" }),
    points: field.repeater({
      content: (item) => ({ label: item.string({ default: "Point" }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: ({ content }) => [content.label],
      toTitle: () => "Point",
    }),
    visual: field.artifact({ size: "fill" }),
  }),
  settings: (setting) => ({
    colorScheme: setting.enum({ default: "light", options: { light: "Light", dark: "Dark" } }),
  }),
  toReact: ({ settings }): React.ReactElement => (
    <section className={`scheme-${settings.colorScheme}`}>
      <banner.Field name="title">{(props) => <h2 {...props} />}</banner.Field>
      <ul>
        <banner.Repeater name="points">
          {(item) => <item.Field name="label">{(props) => <li {...props} />}</item.Field>}
        </banner.Repeater>
      </ul>
      <banner.Artifact name="visual">{(props) => <iframe {...props} />}</banner.Artifact>
    </section>
  ),
  toMarkdown: ({ content }) => [content.title],
  toTitle: () => "Banner",
});
/** A block only layouts place, with an Artifact. */
const offer = createBlock({
  id: "offer",
  title: "Offer",
  description: "An offer",
  layoutOnly: true,
  content: (field) => ({
    title: field.string({ default: "" }),
    visual: field.artifact({ size: "fill" }),
  }),
  toReact: () => (
    <aside>
      <offer.Field name="title">{(props) => <h2 {...props} />}</offer.Field>
      <offer.Artifact name="visual">{(props) => <iframe {...props} />}</offer.Artifact>
    </aside>
  ),
  toMarkdown: ({ content }) => [content.title],
  toTitle: () => "Offer",
});
const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string() }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});
/** A Singleton Layout at `/offers`, which places an offer before its page. */
const offers = createLayout("offers")({
  title: "Offers",
  description: "",
  kind: "singleton",
  blocks: { before: [offer], after: [] },
  toReact: () => <offers.BeforeBlocks />,
  toTitle: () => "Offers",
  toDescription: () => undefined,
});
/** A Derived Layout whose pages each show an article, found by its slug. */
const article = createLayout("articles.$slug")({
  title: "Article",
  description: "",
  kind: "derived",
  blocks: { before: [], after: [] },
  ...articles.pages({ by: "slug", param: "slug" }),
  toReact: () => <h1>{article.useData().content.title}</h1>,
  toTitle: ({ page }) => page.title,
  toDescription: () => undefined,
});
/** A curated Layout placing an offer before its pages' content. */
const site = createLayout("site")({
  title: "Site",
  description: "",
  kind: "curated",
  blocks: { before: [offer], after: [] },
  toReact: ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <>
      <site.BeforeBlocks />
      <div className="site-content">{children}</div>
    </>
  ),
  toTitle: () => "Site",
  toDescription: () => undefined,
});
const camoxApp = createApp({
  blocks: [hero as unknown as Block, banner as unknown as Block, offer as unknown as Block],
  collections: [articles],
  layouts: [offers, article, site],
});
const layoutBannerId = "0199f0a0-0000-7000-8000-000000000003";
const articleId = "0199f0a0-0000-7000-8000-000000000004";

/**
 * The banner as the API shows it unplaced, its overrides merged on its defaults: a dark scheme,
 * its own title and two points, and its Artifact.
 */
const unplacedBanner = {
  block: {
    id: "unplaced",
    pageId: null,
    layoutId: null,
    type: "banner",
    content: {
      title: "Spring sale",
      points: [{ _itemId: "seed_1" }, { _itemId: "seed_2" }],
      visual: ARTIFACT,
    },
    settings: { colorScheme: "dark" },
    position: "a0",
    references: {},
  },
  repeatableItems: [
    {
      id: "seed_1",
      blockId: "unplaced",
      parentItemId: null,
      fieldName: "points",
      content: { label: "Free shipping" },
      settings: null,
      position: "a0",
      references: {},
    },
    {
      id: "seed_2",
      blockId: "unplaced",
      parentItemId: null,
      fieldName: "points",
      content: { label: "Ends Sunday" },
      settings: null,
      position: "a1",
      references: {},
    },
  ],
  files: [],
};

/**
 * An API where only the look token `TOKEN` reads the draft `DRAFT`, as the API checks it: a
 * request naming a draft without it is refused. Returns the requests it got.
 */
function mockApi(t: { mock: { method: typeof test.mock.method } }) {
  const received: Request[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    received.push(request);
    const url = new URL(request.url);
    const draft = request.headers.get(DRAFT_HEADER);
    if (draft && (draft !== DRAFT || request.headers.get(LOOK_TOKEN_HEADER) !== TOKEN))
      return Response.json(
        { json: { defined: true, code: "UNAUTHORIZED", status: 401, message: "Unauthorized" } },
        { status: 401 },
      );
    const source = draft ? "Draft title" : "Live title";
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    if (url.pathname.endsWith("/blocks/getUnplaced")) {
      const { json } = (await request.clone().json()) as {
        json: { type: string; settings?: { colorScheme?: string } };
      };
      if (json.type !== "banner")
        return Response.json(
          {
            json: {
              defined: true,
              code: "NOT_FOUND",
              status: 404,
              message: 'There\'s no Block Definition named "pricing".',
            },
          },
          { status: 404 },
        );
      if (json.settings?.colorScheme === "purple")
        return Response.json(
          {
            json: {
              defined: true,
              code: "BAD_REQUEST",
              status: 400,
              message: "settings.colorScheme must be one of light, dark",
            },
          },
          { status: 400 },
        );
      return Response.json({ json: unplacedBanner });
    }
    if (url.pathname.endsWith("/layouts/getUnplaced")) {
      const { json } = (await request.clone().json()) as {
        json: { layoutId: string; blocks?: { offer?: { content?: { title?: string } } } };
      };
      if (json.layoutId === "offers")
        return Response.json(
          {
            json: {
              defined: true,
              code: "BAD_REQUEST",
              status: 400,
              message: '"offers" is a Singleton Layout: look at its page, by its path, instead.',
            },
          },
          { status: 400 },
        );
      if (json.layoutId !== "site")
        return Response.json(
          { json: { defined: true, code: "NOT_FOUND", status: 404, message: "No such Layout" } },
          { status: 404 },
        );
      const id = "unplaced-before-offer";
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: { layoutId: "site", beforeBlockIds: [id], afterBlockIds: [] },
          blocks: [
            {
              id,
              type: "offer",
              content: { title: json.blocks?.offer?.content?.title ?? "", visual: ARTIFACT },
              settings: {},
              slot: "before",
              position: "a0",
            },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    }
    if (url.pathname.endsWith("/listBySlug"))
      return pageListResponse([
        { id: pageId, fullPath: "/", pathSegment: "", updatedAt: 1, layoutId: null },
      ]);
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: {
            id: 2,
            layoutId: "offers",
            beforeBlockIds: [layoutBannerId],
            afterBlockIds: [],
          },
          blocks: [
            {
              id: layoutBannerId,
              type: "offer",
              content: { title: `${source} offer`, visual: ARTIFACT },
              settings: {},
              position: "a0",
            },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    if (url.pathname.endsWith("/findRecordsByField")) {
      const { json } = (await request.clone().json()) as { json: { value: string } };
      return Response.json({
        json:
          json.value === "hello"
            ? [
                {
                  id: articleId,
                  title: source,
                  description: null,
                  content: { title: source, slug: "hello" },
                },
              ]
            : [],
      });
    }
    const pagePath = url.pathname.endsWith("/getByPath")
      ? ((await request.clone().json()) as { json: { path: string } }).json.path
      : null;
    // The curated pages: the home page, and one at a Singleton Layout's route, which it shadows.
    if (pagePath !== null && pagePath !== "/" && pagePath !== "/offers")
      return Response.json(
        { json: { defined: true, code: "NOT_FOUND", status: 404, message: "Page not found" } },
        { status: 404 },
      );
    if (pagePath !== null)
      return Response.json({
        json: {
          page: {
            id: pageId,
            fullPath: "/",
            pathSegment: "",
            metaTitle: source,
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
              content: { title: source, visual: ARTIFACT },
              settings: {},
              position: "a0",
            },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    return Response.json({ json: null });
  });
  return received;
}

const PAGE_TARGET = "path=/";

async function look({ token = TOKEN as string | null, draft = DRAFT, target = PAGE_TARGET } = {}) {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { renderPageWithApp } = await import("./pageServer");
  const response = await handleCamoxRequest(
    new Request(`https://site.test/_camox/look?camox-draft=${draft}&${target}`, {
      headers: token ? { Cookie: `other=1; camox_look=${token}` } : {},
    }),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectUuid: "test",
      getCamoxApp: async () => camoxApp,
      renderPage: (input) => renderPageWithApp({ ...input, camoxApp }),
      stylesheetUrl: "/site.css",
      studioStylesheetUrl: "/studio.css",
      blockPreloads: {
        modulePaths: { hero: "/src/blocks/hero.tsx", banner: "/src/blocks/banner.tsx" },
        chunks: null,
      },
    },
  );
  assert.ok(response);
  return { response, html: await response.text() };
}

void test("renders a page of the draft with the draft's content, as a visitor sees it", async (t) => {
  mockApi(t);
  const { response, html } = await look();
  assert.equal(response.status, 200);
  assert.match(html, /<h1><span>Draft title<\/span><\/h1>/);
  // The site's own stylesheet, and the blocks the page's client hydrates.
  assert.match(html, /<link rel="stylesheet" href="\/site.css">/);
  assert.ok(html.includes('<link rel="modulepreload" href="/src/blocks/hero.tsx">'));
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
});

void test("reads the draft's content with the look token", async (t) => {
  const received = mockApi(t);
  await look();
  const reads = received.filter((request) => request.headers.get(DRAFT_HEADER));
  assert.ok(reads.length > 0);
  for (const request of received) assert.equal(request.headers.get(LOOK_TOKEN_HEADER), TOKEN);
});

void test("has no studio markup or stylesheet", async (t) => {
  mockApi(t);
  const { html } = await look();
  assert.ok(!html.includes("/studio.css"));
  // The studio's theme script and stylesheet are marked `data-camox-studio`.
  assert.doesNotMatch(html, /data-camox-studio|Loading Studio/);
});

void test("shows no draft content without a look token, or with one the API refuses", async (t) => {
  mockApi(t);
  for (const token of [null, "expired-or-for-another-draft"]) {
    const { response, html } = await look({ token });
    assert.equal(response.status, 404);
    assert.doesNotMatch(html, /Draft title|Live title/);
  }
});

void test("shows no draft content for a draft its token isn't for", async (t) => {
  mockApi(t);
  const { response, html } = await look({ draft: "0199f0a0-0000-7000-8000-0000000000d2" });
  assert.equal(response.status, 404);
  assert.doesNotMatch(html, /Draft title|Live title/);
});

void test("marks itself ready only once it hydrated and its Artifacts loaded", async (t) => {
  await assertHydratesThenReady(t, PAGE_TARGET);
});

/**
 * Hydrates the look document of `target` without errors, then marks itself ready once its
 * Artifacts loaded.
 */
async function assertHydratesThenReady(t: test.TestContext, target: string) {
  const { window, errors, hydrate, held } = await openLook(t, target);
  const ready = () => window.document.documentElement.hasAttribute("data-camox-ready");
  const frames = () => window.document.querySelectorAll("iframe").length;
  try {
    assert.equal(ready(), false, "not before the page's client hydrated it");
    await hydrate();
    assert.deepEqual(errors, []);
    assert.equal(frames(), 1);
    assert.equal(window.document.readyState, "complete");
    assert.equal(ready(), false, "not while its Artifact is still loading");
    // A browser never loads a lazy frame below the first screen, which would leave it unready.
    const frame = window.document.querySelector("iframe")!;
    assert.notEqual(frame.getAttribute("loading"), "lazy", "its Artifacts load wherever they are");

    for (const callback of held) callback(window.performance.now());
    await window.happyDOM.waitUntilComplete();
    assert.equal(ready(), true);
  } finally {
    await window.happyDOM.close();
  }
}

/**
 * The look document of `target`, written into a browser window, its client not yet hydrated:
 * the frames it asked for are held, keeping its Artifacts loading until the test runs `held`.
 * `cookie` is set on the window first, as a browser that has one sends it. Records the errors
 * React reports and the requests the page makes.
 */
async function openLook(t: test.TestContext, target: string, { cookie }: { cookie?: string } = {}) {
  const received = mockApi(t);
  const { html } = await look({ target });
  const window = new Window({
    url: `https://site.test/_camox/look?camox-draft=${DRAFT}&${target}`,
    settings: { enableJavaScriptEvaluation: true },
  });
  if (cookie) window.document.cookie = cookie;
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    KeyboardEvent: window.KeyboardEvent,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // React reports hydration mismatches as errors.
  const errors: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  Object.assign(globalThis, { reportError: (error: unknown) => errors.push(error) });
  // happy-dom writes a frame's document at once, then fires its `load` on the next animation
  // frame: holding the frames asked for while the page is written keeps its Artifact loading,
  // as one still fetching its libraries would.
  const held: FrameRequestCallback[] = [];
  const holding = t.mock.method(
    window,
    "requestAnimationFrame",
    (callback: FrameRequestCallback) => {
      held.push(callback);
      return undefined as never;
    },
  );
  window.document.write(html.replace(/<script type="module"[^>]*><\/script>/g, ""));
  holding.mock.restore();
  await window.happyDOM.waitUntilComplete();
  const hydrate = async () => {
    const { hydratePageWithApp } = await import("./pageClient");
    await React.act(async () => {
      await hydratePageWithApp(camoxApp);
    });
    await window.happyDOM.waitUntilComplete();
  };
  return { window, errors, received, held, hydrate };
}

void test("asks nothing about a session and offers no sign-in, even in a browser signed in to the studio", async (t) => {
  const { window, received, hydrate } = await openLook(t, PAGE_TARGET, {
    cookie: `camox_auth_cookie=${encodeURIComponent("better-auth.session_token=member-session")}`,
  });
  try {
    const before = received.length;
    await hydrate();
    assert.deepEqual(
      received
        .slice(before)
        .map((request: Request | string) => (typeof request === "string" ? request : request.url)),
      [],
      "no request about the session",
    );
    // The shortcut that signs a visitor in from their page, which would leave it.
    const href = window.location.href;
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    await window.happyDOM.waitUntilComplete();
    assert.equal(window.location.href, href, "no sign-in");
  } finally {
    await window.happyDOM.close();
  }
});

// The Block Definition mode: one block of a Block Definition, placed nowhere, alone in the site's
// shell, with its default content and Block Settings and overrides merged on.

const query = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  ).toString();

const BANNER_TARGET = query({
  blockDefinition: "banner",
  content: { title: "Spring sale", points: [{ label: "Free shipping" }, { label: "Ends Sunday" }] },
  settings: { colorScheme: "dark" },
});

void test("renders a Block Definition's block alone in the site's shell, as the draft shows it with the overrides", async (t) => {
  const received = mockApi(t);
  const { response, html } = await look({ target: BANNER_TARGET });

  assert.equal(response.status, 200);
  assert.match(
    html,
    /<div class="group visual-editing-block" data-camox-viewport-block="unplaced"/,
  );
  assert.match(html, /<section class="scheme-dark"><h2><span>Spring sale<\/span><\/h2>/);
  assert.match(html, /<li><span>Free shipping<\/span><\/li><li><span>Ends Sunday<\/span><\/li>/);
  // No page around it: neither the hero nor the page's title.
  assert.doesNotMatch(html, /Draft title|Live title/);
  assert.match(html, /<link rel="stylesheet" href="\/site.css">/);
  assert.ok(html.includes('<link rel="modulepreload" href="/src/blocks/banner.tsx">'));
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);

  // The overrides reach the draft as the URL gives them, read with the look token.
  const [asked, ...others] = received.filter((request) =>
    new URL(request.url).pathname.endsWith("/blocks/getUnplaced"),
  );
  assert.equal(others.length, 0);
  assert.equal(asked!.headers.get(DRAFT_HEADER), DRAFT);
  assert.equal(asked!.headers.get(LOOK_TOKEN_HEADER), TOKEN);
  const { json } = (await asked!.json()) as { json: Record<string, unknown> };
  assert.deepEqual(json, {
    projectUuid: "test",
    type: "banner",
    content: {
      title: "Spring sale",
      points: [{ label: "Free shipping" }, { label: "Ends Sunday" }],
    },
    settings: { colorScheme: "dark" },
  });
});

void test("answers an override the schema refuses with the schema's message, and an unknown Block Definition with nothing", async (t) => {
  mockApi(t);
  const refused = await look({
    target: query({ blockDefinition: "banner", settings: { colorScheme: "purple" } }),
  });
  assert.equal(refused.response.status, 422);
  assert.match(refused.html, /settings.colorScheme must be one of light, dark/);

  const unknown = await look({ target: query({ blockDefinition: "pricing" }) });
  assert.equal(unknown.response.status, 404);

  const malformed = await look({ target: "blockDefinition=banner&content=%7Bnope" });
  assert.equal(malformed.response.status, 422);
});

void test("shows no Block Definition without a look token the API accepts", async (t) => {
  mockApi(t);
  for (const token of [null, "expired-or-for-another-draft"]) {
    const { response, html } = await look({ token, target: BANNER_TARGET });
    assert.equal(response.status, 404);
    assert.doesNotMatch(html, /Spring sale/);
  }
});

void test("hydrates a Block Definition's block, then marks itself ready once its Artifacts loaded", async (t) => {
  await assertHydratesThenReady(t, BANNER_TARGET);
});

// Pages of Singleton and Derived Layouts, whose blocks all belong to their layout, matched as the
// website serves them: a Singleton Layout's route first, then a curated page, then a Derived
// Layout's route.

void test("renders a Singleton Layout's page with the draft's content, over a curated page at its path", async (t) => {
  const received = mockApi(t);
  const { response, html } = await look({ target: "path=/offers" });
  assert.equal(response.status, 200);
  assert.match(html, /<h2><span>Draft title offer<\/span><\/h2>/);
  assert.doesNotMatch(html, /<h1>/, "not the curated page at its path");
  for (const request of received) assert.equal(request.headers.get(LOOK_TOKEN_HEADER), TOKEN);
});

void test("renders a Derived Layout's page with its record read from the draft", async (t) => {
  const received = mockApi(t);
  const { response, html } = await look({ target: "path=/articles/hello" });
  assert.equal(response.status, 200);
  assert.match(html, /<h1>Draft title<\/h1>/);
  const [found] = received.filter((request) => request.url.endsWith("/findRecordsByField"));
  assert.equal(found!.headers.get(DRAFT_HEADER), DRAFT);
  assert.equal(found!.headers.get(LOOK_TOKEN_HEADER), TOKEN);
});

void test("answers why when a Derived Layout's loader finds nothing at the path", async (t) => {
  mockApi(t);
  const { response, html } = await look({ target: "path=/articles/nope" });
  assert.equal(response.status, 404);
  assert.match(response.headers.get("Content-Type") ?? "", /text\/plain/);
  assert.match(html, /no page at \/articles\/nope/);
});

void test("hydrates a Singleton Layout's page, then marks itself ready once its Artifacts loaded", async (t) => {
  await assertHydratesThenReady(t, "path=/offers");
});

// The Layout Definition mode: a curated Layout, around no page, alone in the site's shell, its
// blocks with their default content and overrides merged on, around a placeholder where a page's
// content goes.

const SITE_TARGET = query({
  layoutDefinition: "site",
  placeholder: "short",
  blocks: { offer: { content: { title: "Spring offer" } } },
});

/** The look document's placeholder for a page's content, in `html`. */
const placeholderIn = (html: string) =>
  /<div[^>]*data-camox-look-placeholder[^>]*>.*?<\/div>/s.exec(html)?.[0];

void test("renders a curated Layout alone in the site's shell, its blocks with the overrides, around a labelled placeholder for page content", async (t) => {
  const received = mockApi(t);
  const { response, html } = await look({ target: SITE_TARGET });

  assert.equal(response.status, 200);
  assert.match(html, /<aside><h2><span>Spring offer<\/span><\/h2>/);
  // The placeholder stands where the Layout puts a page's content, after its blocks.
  assert.match(html, /<div class="site-content"><div[^>]*data-camox-look-placeholder/);
  assert.match(placeholderIn(html) ?? "", /Page content/);
  assert.doesNotMatch(html, /Draft title|Live title/, "no page's content");
  assert.match(html, /<link rel="stylesheet" href="\/site.css">/);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);

  const [asked, ...others] = received.filter((request) =>
    new URL(request.url).pathname.endsWith("/layouts/getUnplaced"),
  );
  assert.equal(others.length, 0);
  assert.equal(asked!.headers.get(DRAFT_HEADER), DRAFT);
  assert.equal(asked!.headers.get(LOOK_TOKEN_HEADER), TOKEN);
  const { json } = (await asked!.json()) as { json: Record<string, unknown> };
  assert.deepEqual(json, {
    projectUuid: "test",
    layoutId: "site",
    blocks: { offer: { content: { title: "Spring offer" } } },
  });
});

void test("renders a short or a tall placeholder, a short one without any", async (t) => {
  mockApi(t);
  /** How tall the look document's placeholder stands. */
  const heightOf = async (placeholder?: string) => {
    const target = query({ layoutDefinition: "site", ...(placeholder && { placeholder }) });
    const shown = placeholderIn((await look({ target })).html) ?? "";
    return /min-height:\s*([^;"]+)/.exec(shown)?.[1];
  };
  const [short, tall, unsaid] = [await heightOf("short"), await heightOf("tall"), await heightOf()];
  assert.ok(short && tall);
  assert.notEqual(short, tall);
  assert.equal(unsaid, short);
});

void test("answers a Layout the API refuses with its message, an unknown one with nothing, and a placeholder of no height with why", async (t) => {
  mockApi(t);
  const refused = await look({ target: query({ layoutDefinition: "offers" }) });
  assert.equal(refused.response.status, 422);
  assert.match(refused.html, /Singleton Layout/);

  const unknown = await look({ target: query({ layoutDefinition: "landing" }) });
  assert.equal(unknown.response.status, 404);

  const heightless = await look({
    target: query({ layoutDefinition: "site", placeholder: "huge" }),
  });
  assert.equal(heightless.response.status, 422);
  assert.match(heightless.html, /short|tall/);

  const malformed = await look({ target: "layoutDefinition=site&blocks=%7Bnope" });
  assert.equal(malformed.response.status, 422);
});

void test("hydrates a curated Layout around its placeholder, then marks itself ready once its Artifacts loaded", async (t) => {
  await assertHydratesThenReady(t, SITE_TARGET);
});
