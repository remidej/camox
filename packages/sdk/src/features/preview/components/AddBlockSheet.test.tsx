import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test, type TestContext } from "node:test";

import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import { createDraftScope } from "@/lib/draft-scope";

import { StudioQueryClientProvider, testDraftScope } from "../../../lib/draft-scope.fixtures";

// The add-block sheet over the definitions the API answers, with no code registry. The previewed
// page is stubbed, since the real hook reads it from the studio's location.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/AddBlockSheet.tsx")) {
      if (specifier === "../CamoxPreview")
        source = "export const usePreviewedPage = () => globalThis.testPreviewedPage";
      if (specifier === "@/lib/view-locale") source = "export const useLocalePath = () => '/'";
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

const PROJECT_ID = 1;
const text = { type: "object", properties: { title: { type: "string", fieldType: "String" } } };
const definition = (blockId: string, title: string, extra: Record<string, unknown> = {}) => ({
  blockId,
  title,
  description: `${title} block`,
  contentSchema: text,
  settingsSchema: null,
  defaultContent: { title: "" },
  defaultSettings: {},
  layoutOnly: null,
  synced: false,
  ...extra,
});

/** Renders the open sheet, the API answering each draft's block definitions from `definitions`. */
async function renderSheet(
  t: TestContext,
  definitions: Record<string, ReturnType<typeof definition>[]>,
  { developmentMode = false } = {},
) {
  const window = new Window({ url: "http://localhost/" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    ResizeObserver: window.ResizeObserver,
    IntersectionObserver: window.IntersectionObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { AddBlockSheet } = await import("./AddBlockSheet");
  const { previewStore } = await import("../previewStore");

  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const procedure = new URL(request.url).pathname.replace("/rpc/", "");
    const draft = request.headers.get(DRAFT_HEADER) ?? "live";
    if (procedure === "projects/getByUuid") return Response.json({ json: { id: PROJECT_ID } });
    if (procedure === "blockDefinitions/list") {
      return Response.json({ json: definitions[draft] ?? [] });
    }
    if (procedure === "blocks/getUsageCounts") return Response.json({ json: [] });
    return Response.json({ json: null });
  });

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  Object.assign(globalThis, {
    testPreviewedPage: { page: { id: "page", blockIds: [] }, layout: null },
  });
  previewStore.send({ type: "openAddBlockSheet", afterPosition: null });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <StudioQueryClientProvider
        client={client}
        draftScope={createDraftScope({ queryClient: client, developmentMode })}
      >
        <AuthContext.Provider
          value={{
            projectUuid: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <AddBlockSheet />
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
    );
  });
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  for (let i = 0; i < 3; i++) await settle();

  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    previewStore.send({ type: "closeAddBlockSheet" });
    await window.happyDOM.close();
  });

  const items = () => [...document.querySelectorAll<HTMLElement>("[cmdk-item]")];
  return {
    /** Each listed block's title, with its Synced badge when it has one. */
    listed: () =>
      items().map((item) => item.querySelector(".font-medium")?.parentElement?.textContent),
  };
}

void test("the add-block sheet lists the draft's block definitions from the API, with no code registry", async (t) => {
  const sheet = await renderSheet(t, {
    live: [
      definition("hero", "Hero", { synced: true }),
      definition("navbar", "Navbar", { layoutOnly: true }),
      definition("faq", "FAQ"),
    ],
  });

  assert.deepEqual(sheet.listed(), ["HeroSynced", "FAQ"]);
});

void test("in a development draft, the add-block sheet lists that draft's block definitions", async (t) => {
  const sheet = await renderSheet(
    t,
    {
      live: [definition("hero", "Hero")],
      [DEVELOPMENT_DRAFT]: [definition("hero", "Hero"), definition("pricing", "Pricing")],
    },
    { developmentMode: true },
  );

  assert.deepEqual(sheet.listed(), ["Hero", "Pricing"]);
});
