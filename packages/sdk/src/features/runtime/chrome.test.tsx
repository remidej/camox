import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient, QueryClientProvider, dehydrate } from "@tanstack/react-query";
import * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import type { CamoxApp } from "../../core/createApp";
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
  const html = renderToString(
    createElement(PageApp, { input, queryClient, camoxApp: {} as CamoxApp }),
  );
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
  assert.match(html, /View live page/);
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
      camoxApp: {} as CamoxApp,
    }),
  );
  assert.match(studioHtml, /My actual project/);
  assert.match(studioHtml, /Quick find/);
  assert.doesNotMatch(studioHtml, /camox-loading/);

  const publicInput = { ...input, presentation: "public" as const, project: undefined };
  const publicHtml = renderToString(
    createElement(PageApp, {
      input: publicInput,
      queryClient: new QueryClient(),
      camoxApp: {} as CamoxApp,
    }),
  );
  assert.doesNotMatch(publicHtml, /Quick find|Edit mode|My actual project|studio.css/);
});

void test("feedback only depends on the future flag, not page metadata or authentication", async () => {
  Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true, React });
  const { initApiClient } = await import("../../lib/api-client");
  initApiClient("https://api.test");
  const { PreviewToolbar } = await import("../preview/components/PreviewToolbar");
  const renderToolbar = (pageStatus?: "draft" | "published" | "modified") =>
    renderToString(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(PreviewToolbar, { pageStatus }),
      ),
    );
  const previousFlag = Reflect.get(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
  try {
    for (const enabled of [true, false]) {
      Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: enabled });
      // No auth provider or page metadata is required, including on derived previews.
      for (const status of [undefined, "draft", "published", "modified"] as const) {
        const toolbarHtml = renderToolbar(status);
        if (enabled) {
          assert.match(toolbarHtml, /Feedback/);
          continue;
        }
        assert.doesNotMatch(toolbarHtml, /Feedback/);
      }
    }
  } finally {
    Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: previousFlag });
  }
});
