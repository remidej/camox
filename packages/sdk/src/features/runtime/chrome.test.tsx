import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient, QueryClientProvider, dehydrate } from "@tanstack/react-query";
import * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { createApp } from "../../core/createApp";
import type { PageRenderInput } from "./runtime";

// The URL is supplied by Vite in applications. Nothing else is mocked: render
// the real Navbar, ProjectMenu, EnvironmentMenu and PreviewToolbar on the server.
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

void test("authenticated documents SSR real chrome and server-loaded project data", async () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { PageApp } = await import("./pageApp");
  const camoxApp = createApp({ blocks: [] });
  const queryClient = new QueryClient();
  const project = {
    id: 1,
    name: "My actual project",
    slug: "test",
    organizationSlug: "team",
  } as NonNullable<PageRenderInput["project"]>;
  queryClient.setQueryData(queryKeys.pages.getByPath("/", "draft"), {
    page: { id: 1, blockIds: [], status: "modified", livePublishedCheckpointId: 1 },
    layout: null,
    project,
    projectName: project.name,
  });
  const input: PageRenderInput = {
    presentation: "studio",
    previewDocument:
      '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/site.css"></head><body><div id="root" data-camox-preview-root><main id="site-content">Site</main></div></body></html>',
    project,
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    environmentName: "production",
    source: "draft",
    href: "https://site.test/",
    pathname: "/",
    runtimeBasePath: "",
    head: {},
    layoutIdentity: null,
    loaderData: null,
    dehydratedState: dehydrate(queryClient),
  };
  const html = renderToString(createElement(PageApp, { input, queryClient, camoxApp }));
  assert.match(html, /My actual project/);
  assert.match(html, /Quick find/);
  assert.match(html, /Edit mode/);
  const editModeLabel =
    html.match(/<label[^>]*for="edit-mode"[^>]*>([\s\S]*?)<\/label>/)?.[1] ?? "";
  // Actions register in effects, but the shortcut must already occupy its
  // space in the server-rendered toolbar.
  assert.match(editModeLabel, /<kbd/);
  assert.match(editModeLabel, /class="camox-platform-mac">⌘ ↵/);
  assert.match(editModeLabel, /class="camox-platform-other">Ctrl ↵/);
  assert.match(html, /class="camox-platform-mac">⌘ K/);
  assert.match(html, /class="camox-platform-other">Ctrl K/);
  assert.match(html, /View live site/);
  assert.match(html, /PROD/);
  assert.doesNotMatch(html, /camox-loading|Loading editor/);
  assert.match(html, /<iframe[^>]+srcDoc=/i);
  assert.match(html, /&lt;main id=&quot;site-content&quot;/);
  assert.doesNotMatch(html, /<main id="site-content"/);

  const studioHtml = renderToString(
    createElement(PageApp, {
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
  assert.match(studioHtml, /Quick find/);
  assert.match(studioHtml, /View live site/);
  assert.ok(studioHtml.indexOf("View live site") < studioHtml.indexOf("Quick find"));
  assert.doesNotMatch(studioHtml, /camox-loading/);

  const { getNavbarLinks } = await import("../studio/components/Navbar");
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
      assert.match(canvasHtml, /My actual project|Quick find/);
      assert.match(canvasHtml, /<div hidden=""[^>]*><menu role="toolbar"/);
      // Navbar and command actions share the same ungated navigation.
      assert.deepEqual(
        getNavbarLinks().map((link) => link.title),
        ["Preview", "Content"],
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
      input: publicInput,
      queryClient: new QueryClient(),
      camoxApp,
    }),
  );
  assert.doesNotMatch(publicHtml, /Quick find|Edit mode|My actual project|studio.css/);
});

void test("feedback is available without experimental features, page metadata or authentication", async () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { initApiClient } = await import("../../lib/api-client");
  initApiClient("https://api.test");
  const { PreviewToolbar } = await import("../preview/components/PreviewToolbar");
  const renderToolbar = () =>
    renderToString(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(PreviewToolbar),
      ),
    );
  const previousFlag = Reflect.get(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
  try {
    for (const flag of [undefined, false]) {
      if (flag === undefined)
        Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
      else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: flag });
      // No auth provider or page metadata is required, including on derived previews.
      assert.match(renderToolbar(), /Feedback/);
    }
  } finally {
    if (previousFlag === undefined)
      Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
    else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: previousFlag });
  }
});
