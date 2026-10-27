import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { type TestContext, test } from "node:test";

import { artifactSourceHash } from "@camox/api-contract";
import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { Window } from "happy-dom";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createBlock, type Block } from "../../core/createBlock";
import { createLayout } from "../../core/createLayout";
import { localesResponse, pageListResponse } from "./api.fixtures";
import { handleCamoxRequest, type RuntimeOptions } from "./runtime";

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

const project = { id: 1, name: "Real project", slug: "test", updatedAt: 1 };
const pageId = "0199f0a0-0000-7000-8000-000000000001";
const blockId = "0199f0a0-0000-7000-8000-000000000002";

const orbit = '<!doctype html><title>Orbit &amp; rings</title><svg id="orbit-scene"></svg>';
const bar = '<!doctype html><title>Bar</title><div id="bar-scene"></div>';
const dot = '<!doctype html><title>Dot</title><i id="dot-scene"></i>';
/** What each source holds that nothing else on the page does. */
const SOURCE_MARKERS = ["orbit-scene", "bar-scene", "dot-scene"];

const showcase = createBlock({
  id: "showcase",
  title: "Showcase",
  description: "",
  content: (field) => ({
    headline: field.string({ default: "" }),
    visual: field.artifact({ size: "fill", data: ["headline"] }),
    bars: field.repeater({
      content: (field) => ({
        label: field.string({ default: "" }),
        bar: field.artifact({ size: "content", data: ["label"] }),
        dots: field.repeater({
          content: (field) => ({
            tone: field.string({ default: "" }),
            dot: field.artifact({ size: "content", data: ["tone"] }),
          }),
          minItems: 1,
          maxItems: 3,
          toMarkdown: () => [],
          toTitle: () => "Dot",
        }),
      }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: () => [],
      toTitle: () => "Bar",
    }),
  }),
  toMarkdown: () => [],
  toReact: () => (
    <>
      <showcase.Artifact name="visual">{(props) => <iframe {...props} />}</showcase.Artifact>
      <showcase.Repeater name="bars">
        {(item) => (
          <>
            <item.Artifact name="bar">{(props) => <iframe {...props} />}</item.Artifact>
            <item.Repeater name="dots">
              {(dot) => <dot.Artifact name="dot">{(props) => <iframe {...props} />}</dot.Artifact>}
            </item.Repeater>
          </>
        )}
      </showcase.Repeater>
    </>
  ),
  toTitle: () => "Showcase",
});
/** A block a singleton layout places, with an artifact. */
const banner = createBlock({
  id: "banner",
  title: "Banner",
  description: "",
  layoutOnly: true,
  content: (field) => ({
    caption: field.string({ default: "" }),
    visual: field.artifact({ size: "fill", data: ["caption"] }),
  }),
  toMarkdown: () => [],
  toReact: () => (
    <banner.Artifact name="visual">{(props) => <iframe {...props} />}</banner.Artifact>
  ),
  toTitle: () => "Banner",
});
const store = createLayout("store")({
  title: "Store",
  description: "",
  kind: "singleton",
  blocks: { before: [banner], after: [] },
  toReact: () => <store.BeforeBlocks />,
  toTitle: () => "Store",
  toDescription: () => undefined,
});
const camoxApp = createApp({
  blocks: [showcase as unknown as Block, banner as unknown as Block],
  layouts: [store],
});
const bannerId = "0199f0a0-0000-7000-8000-000000000003";

function item(
  id: string,
  parentItemId: string | null,
  content: Record<string, unknown>,
  artifactHashes: Record<string, string>,
) {
  return {
    id,
    blockId,
    parentItemId,
    fieldName: parentItemId === null ? "bars" : "dots",
    content,
    settings: null,
    summary: "",
    title: "",
    position: `a${id}`,
    createdAt: 0,
    updatedAt: 0,
    projectId: null,
    sharedContentType: null,
    artifactHashes,
  };
}

/**
 * An API holding a page with one showcase block: a top-level artifact, artifacts in two items,
 * and in a nested item. Each read returns its artifact sources' hashes, and the artifact source
 * store serves every source by its hash. A read naming a draft reads the draft.
 */
function mockApi(t: TestContext) {
  t.mock.method(globalThis, "fetch", async (input: Request | string, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const [orbitHash, barHash, dotHash] = await Promise.all(
      [orbit, bar, dot].map(artifactSourceHash),
    );
    const stored = new Map([
      [orbitHash, orbit],
      [barHash, bar],
      [dotHash, dot],
    ]);
    const source = /^\/artifact-sources\/test\/([^/]+)$/.exec(url.pathname);
    if (source) {
      const found = stored.get(source[1]!);
      return found
        ? new Response(found, {
            headers: { "Cache-Control": "public, max-age=31536000, immutable" },
          })
        : new Response("Not found", { status: 404 });
    }
    const headline = request.headers.get(DRAFT_HEADER) ? "Draft launch" : "Launch";
    if (url.pathname.endsWith("/locales/list")) return localesResponse();
    if (url.pathname.endsWith("/getByUuid")) return Response.json({ json: project });
    if (url.pathname.endsWith("/listBySlug"))
      return pageListResponse([
        { id: pageId, fullPath: "/", pathSegment: "", updatedAt: 1, layoutId: null },
      ]);
    if (url.pathname.endsWith("/getByPath"))
      return Response.json({
        json: {
          page: { id: pageId, fullPath: "/", pathSegment: "", layoutId: null, blockIds: [blockId] },
          layout: null,
          project,
          projectName: project.name,
          blocks: [
            {
              id: blockId,
              pageId,
              type: "showcase",
              content: {
                headline,
                visual: orbit,
                bars: [{ _itemId: "1" }, { _itemId: "2" }],
              },
              settings: {},
              position: "a0",
              summary: "",
              title: "Showcase",
              artifactHashes: { visual: orbitHash },
            },
          ],
          files: [],
          repeatableItems: [
            item("1", null, { label: "Q1", bar, dots: [{ _itemId: "3" }] }, { bar: barHash }),
            item("2", null, { label: "Q2", bar, dots: [] }, { bar: barHash }),
            item("3", "1", { tone: "warm", dot }, { dot: dotHash }),
          ],
        },
      });
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: project.name,
          project,
          layout: { id: 2, layoutId: "store", beforeBlockIds: [bannerId], afterBlockIds: [] },
          blocks: [
            {
              id: bannerId,
              type: "banner",
              content: { caption: "Sale", visual: dot },
              settings: {},
              position: "a0",
              summary: "",
              title: "Banner",
              artifactHashes: { visual: dotHash },
            },
          ],
          files: [],
          repeatableItems: [],
        },
      });
    return Response.json({ json: null });
  });
}

const options: RuntimeOptions = {
  apiUrl: "https://api.test",
  authenticationUrl: "https://auth.test",
  projectUuid: "test",
  getCamoxApp: async () => camoxApp,
  getDocument: async () => ({
    title: "Real website",
    link: [{ rel: "stylesheet", href: "https://fonts.test/inter.css" }],
  }),
  renderPage: async (input) => {
    const { renderPageWithApp } = await import("./pageServer");
    return renderPageWithApp({ ...input, camoxApp });
  },
};

async function request(path: string, init?: RequestInit) {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const response = await handleCamoxRequest(new Request(`https://site.test${path}`, init), options);
  assert.equal(response?.status, 200);
  return response!;
}

/** The attributes of each `<iframe>` in `html`, in document order. */
function frames(html: string) {
  const root = new Window().document.createElement("div");
  root.innerHTML = html;
  return [...root.querySelectorAll("iframe")].map((frame) =>
    Object.fromEntries(frame.getAttributeNames().map((name) => [name, frame.getAttribute(name)])),
  );
}

void test("a public page loads each artifact by URL, with its starting Artifact Data in the fragment, and ships no artifact source", async (t) => {
  mockApi(t);
  const html = await (await request("/")).text();

  const rendered = frames(html);
  assert.deepEqual(
    rendered.map(({ src: _src, ...frame }) => frame),
    [
      {
        sandbox: "allow-scripts",
        allow: "fullscreen; clipboard-write",
        title: "Orbit & rings",
        loading: "lazy",
      },
      {
        sandbox: "allow-scripts",
        allow: "fullscreen; clipboard-write",
        title: "Bar",
        loading: "lazy",
      },
      {
        sandbox: "allow-scripts",
        allow: "fullscreen; clipboard-write",
        title: "Dot",
        loading: "lazy",
      },
      {
        sandbox: "allow-scripts",
        allow: "fullscreen; clipboard-write",
        title: "Bar",
        loading: "lazy",
      },
    ],
  );
  const loaded = rendered.map(({ src }) => {
    const url = new URL(src!, "https://site.test/");
    return { path: url.pathname, data: JSON.parse(decodeURIComponent(url.hash.slice(1))) };
  });
  assert.deepEqual(
    loaded.map(({ data }) => data),
    [{ headline: "Launch" }, { label: "Q1" }, { tone: "warm" }, { label: "Q2" }],
  );

  // Each URL serves its artifact source, in the website's current shell, cached for good.
  for (const [index, source] of [orbit, bar, dot, bar].entries()) {
    const document = await request(loaded[index]!.path);
    assert.match(document.headers.get("Cache-Control")!, /immutable/);
    assert.ok((await document.text()).endsWith(source));
  }

  for (const marker of SOURCE_MARKERS) assert.ok(!html.includes(marker), `${marker} isn't shipped`);
});

void test("the client hydrates a public page's artifact frames from its hydration data, unchanged, and keeps them connected", async (t) => {
  mockApi(t);
  const html = await (await request("/")).text();
  const window = new Window({ url: "https://site.test/" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.document.write(html.replace(/<script type="module"[^>]*><\/script>/g, ""));
  const root = window.document.getElementById("root")!;
  const served = frames(root.innerHTML);
  // What the page's host sends each artifact's runtime.
  const sent = [...root.querySelectorAll("iframe")].map((frame) => {
    const messages: Array<Record<string, unknown>> = [];
    const postMessage = (message: Record<string, unknown>) => messages.push(message);
    Object.defineProperty(frame, "contentWindow", { value: { postMessage } });
    return messages;
  });
  // React reports hydration mismatches as errors.
  const errors: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  Object.assign(globalThis, { reportError: (error: unknown) => errors.push(error) });
  try {
    const { hydratePageWithApp } = await import("./pageClient");
    await React.act(async () => {
      await hydratePageWithApp(camoxApp);
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(frames(root.innerHTML), served);

    // Each runtime, once ready, gets its artifact's current Artifact Data by message.
    for (const messages of sent) {
      const { channel } = messages.find((message) => message.camox === "connect")!;
      window.dispatchEvent(
        new window.MessageEvent("message", { data: { camox: "ready", channel } }),
      );
    }
    assert.deepEqual(
      sent.map((messages) => messages.find((message) => message.camox === "data")?.data),
      [{ headline: "Launch" }, { label: "Q1" }, { tone: "warm" }, { label: "Q2" }],
    );
  } finally {
    await window.happyDOM.close();
  }
});

void test("a visitor's navigation data loads the page's artifacts by the URLs its HTML does, and ships no artifact source", async (t) => {
  mockApi(t);
  const html = await (await request("/")).text();
  const data = await (await request("/_camox/data?path=/")).text();

  for (const { src } of frames(html)) {
    const path = new URL(src!, "https://site.test/").pathname;
    assert.ok(data.includes(JSON.stringify(path)), `${path} is in the navigation data`);
  }
  for (const marker of SOURCE_MARKERS) assert.ok(!data.includes(marker), `${marker} isn't shipped`);
});

void test("a code-owned page's layout blocks load their artifacts by URL, in its HTML and its navigation data", async (t) => {
  mockApi(t);
  const html = await (await request("/store")).text();
  const data = await (await request("/_camox/data?path=/store")).text();

  const [frame] = frames(html);
  const url = new URL(frame!.src!, "https://site.test/");
  assert.deepEqual(JSON.parse(decodeURIComponent(url.hash.slice(1))), { caption: "Sale" });
  assert.equal(frame!.title, "Dot");
  const document = await request(url.pathname);
  assert.ok((await document.text()).endsWith(dot));
  assert.ok(data.includes(JSON.stringify(url.pathname)), "the navigation data loads it by URL");
  for (const shipped of [html, data]) assert.ok(!shipped.includes("dot-scene"), "no source ships");
});

void test("in dev mode, a page inlines its artifacts' sources, so a change shows at once", async (t) => {
  mockApi(t);
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const response = await handleCamoxRequest(new Request("https://site.test/"), {
    ...options,
    developmentDraft: true,
  });
  const rendered = frames(await response!.text());

  assert.equal(rendered.length, 4);
  for (const [index, source] of [orbit, bar, dot, bar].entries()) {
    assert.equal(rendered[index]!.src, undefined);
    assert.ok(rendered[index]!.srcdoc?.endsWith(source));
  }
});

void test("a member's navigation data in a draft holds the artifacts' sources, for the studio to inline", async (t) => {
  mockApi(t);
  const data = await (
    await request("/_camox/data?path=/&camox-draft=d1", {
      headers: { Cookie: "camox_auth_cookie=valid" },
    })
  ).text();

  assert.match(data, /Draft launch/);
  for (const source of [orbit, bar, dot]) assert.ok(data.includes(JSON.stringify(source)));
  assert.ok(!data.includes("/_camox/artifacts/"));
});
