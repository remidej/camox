import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient, dehydrate } from "@tanstack/react-query";
import * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { createApp } from "../../core/createApp";
import { authPageStyles } from "../../lib/auth-page-styles";
import { handleCamoxRequest, type PageRenderInput } from "./runtime";

// The URL is supplied by Vite in applications. Nothing else is mocked: render
// the real Navbar, ProjectMenu, DraftPicker and PreviewToolbar on the server.
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

/** The chat sidebar, rendered but hidden. */
const HIDDEN_CHAT = /<aside(?=[^>]*data-chat-sidebar)(?=[^>]*\shidden[\s=>])[^>]*>/;

void test("token links SSR a styled sign-in page before loading any content or stylesheets", async (t) => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { PageApp } = await import("./pageApp");
  const { testDraftScope } = await import("../../lib/draft-scope.fixtures");
  const camoxApp = createApp({ blocks: [] });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("The handoff must not load content before authentication");
  });
  const response = await handleCamoxRequest(
    new Request("http://localhost:3000/new-page?camox-preview=target&ott=token"),
    {
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectUuid: "test",
      pageClientEntryUrl: "/client.js",
      renderPage: async (input) =>
        renderToString(
          createElement(PageApp, {
            input,
            queryClient: new QueryClient(),
            camoxApp,
            draftScope: testDraftScope(),
          }),
        ),
    },
  );
  assert.equal(response?.status, 200);
  const html = await response!.text();
  assert.ok(html.includes(`<style>${authPageStyles}</style>`));
  assert.match(html, /role="status" data-camox-preview="pending"/);
  assert.match(html, /class="camox-auth-spinner"/);
  assert.match(html, /Signing in to draft preview…/);
  assert.doesNotMatch(html, /rel="stylesheet"/);
});

void test("authenticated documents SSR real chrome and server-loaded project data", async () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { PageApp } = await import("./pageApp");
  const { testDraftScope, testStudioCache } = await import("../../lib/draft-scope.fixtures");
  const { reads } = await import("../../lib/studio-reads");
  const camoxApp = createApp({ blocks: [] });
  const queryClient = new QueryClient();
  const project = {
    id: 1,
    name: "My actual project",
    slug: "test",
    organizationSlug: "team",
  } as NonNullable<PageRenderInput["project"]>;
  testStudioCache(queryClient).set(reads.pageStructure({ path: "/", projectUuid: "test" }), {
    page: { id: 1, blockIds: [] },
    layout: null,
    project,
    projectName: project.name,
  });
  const input: PageRenderInput = {
    locale: { tag: "en", isDefault: true },
    locales: [{ tag: "en", isDefault: true }],
    presentation: "studio",
    previewDocument:
      '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/site.css"></head><body><div id="root" data-camox-preview-root><main id="site-content">Site</main></div></body></html>',
    project,
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    href: "https://site.test/",
    pathname: "/",
    runtimeBasePath: "",
    head: {},
    layoutIdentity: null,
    loaderData: null,
    dehydratedState: dehydrate(queryClient),
  };
  // Like the server renderer, load the members-only chrome before rendering a member's document.
  const { loadRuntimeChrome } = await import("./runtimeChromeLoader");
  await loadRuntimeChrome();
  const html = renderToString(
    createElement(PageApp, { input, queryClient, camoxApp, draftScope: testDraftScope() }),
  );
  assert.match(html, /My actual project/);
  assert.match(html, /Show canvas/);
  const showCanvasLabel =
    html.match(/<label[^>]*for="show-canvas"[^>]*>([\s\S]*?)<\/label>/)?.[1] ?? "";
  // Actions register in effects, but the shortcut must already occupy its
  // space in the server-rendered toolbar.
  assert.match(showCanvasLabel, /<kbd/);
  assert.match(showCanvasLabel, /class="camox-platform-mac">⌘ ↵/);
  assert.match(showCanvasLabel, /class="camox-platform-other">Ctrl ↵/);
  assert.match(html, />Live</);
  assert.doesNotMatch(html, /camox-loading|Loading editor/);
  assert.match(html, /<iframe[^>]+srcDoc=/i);
  assert.match(html, /&lt;main id=&quot;site-content&quot;/);
  assert.doesNotMatch(html, /<main id="site-content"/);
  // The Preview hides the chat. It keeps its thread, so the Preview follows the editor's runs.
  assert.match(html, HIDDEN_CHAT);

  const studioHtml = renderToString(
    createElement(PageApp, {
      draftScope: testDraftScope(),
      input: {
        ...input,
        pathname: "/camox/content",
        href: "https://site.test/camox/content",
        routeKind: "studio-content",
      },
      queryClient: new QueryClient(),
      camoxApp,
    }),
  );
  assert.match(studioHtml, /My actual project/);
  assert.doesNotMatch(studioHtml, /camox-loading/);
  // The chat is part of the Canvas: other Studio pages hide it but keep its thread.
  assert.match(studioHtml, HIDDEN_CHAT);

  // With the Canvas shown, a page location shows the chat.
  const { previewStore } = await import("../preview/previewStore");
  previewStore.send({ type: "showCanvas" });
  try {
    const canvasPageHtml = renderToString(
      createElement(PageApp, { input, queryClient, camoxApp, draftScope: testDraftScope() }),
    );
    assert.match(canvasPageHtml, /data-chat-sidebar/);
    assert.doesNotMatch(canvasPageHtml, HIDDEN_CHAT);
  } finally {
    previewStore.send({ type: "reset" });
  }

  const { getNavbarLinks, isContentNavbarPath } = await import("../studio/components/Navbar");
  assert.equal(isContentNavbarPath("/camox/content"), true);
  assert.equal(isContentNavbarPath("/camox/content/assets"), true);
  assert.equal(isContentNavbarPath("/camox/content/collections/articles/new"), true);
  assert.equal(isContentNavbarPath("/camox/contentful"), false);
  const { CamoxStudio } = await import("../studio/CamoxStudio");
  const { AuthenticatedCamoxProvider } = await import("../provider/AuthenticatedCamoxProvider");
  const { EditablePageExperience } = await import("../preview/EditablePageExperience");
  const canvasExperience = EditablePageExperience({
    camoxApp,
    queryClient,
    input: { ...input, pathname: "/camox/canvas/blog/post", routeKind: "studio-nested" },
  });
  assert.equal(canvasExperience.type, AuthenticatedCamoxProvider);
  const { CompleteBlockEditingRuntimeProvider } =
    await import("../../core/editing/CompleteBlockEditingRuntime");
  assert.equal(canvasExperience.props.children.type, CompleteBlockEditingRuntimeProvider);
  const studio = canvasExperience.props.children.props.children;
  assert.equal(studio.type, CamoxStudio);
  assert.equal(studio.props.children.props.children, "Studio page not found");
  const previousFlag = Reflect.get(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
  try {
    for (const flag of [undefined, false, true]) {
      if (flag === undefined)
        Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
      else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: flag });
      const canvasHtml = renderToString(
        createElement(PageApp, {
          draftScope: testDraftScope(),
          input: {
            ...input,
            pathname: "/camox/canvas/blog/post",
            href: "https://site.test/mounted/camox/canvas/blog/post",
            runtimeBasePath: "/mounted",
            routeKind: "studio-nested",
          },
          queryClient: new QueryClient(),
          camoxApp,
        }),
      );
      assert.match(canvasHtml, /My actual project/);
      assert.match(canvasHtml, /<div hidden=""[^>]*><menu role="toolbar"/);
      // Navbar and command actions share the same ungated navigation.
      assert.deepEqual(
        getNavbarLinks().map((link) => link.title),
        ["Website", "Content", "Settings"],
      );
      assert.doesNotMatch(canvasHtml, /href="\/camox\/canvas"/);
    }
  } finally {
    if (previousFlag === undefined)
      Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
    else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: previousFlag });
  }

  const publicInput = { ...input, presentation: "public" as const, project: undefined };
  const publicHtml = renderToString(
    createElement(PageApp, {
      draftScope: testDraftScope(),
      input: publicInput,
      queryClient: new QueryClient(),
      camoxApp,
    }),
  );
  assert.doesNotMatch(publicHtml, /Show canvas|My actual project|studio.css/);
});
