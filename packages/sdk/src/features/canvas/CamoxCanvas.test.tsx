import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

// Keep the real Canvas query/error/selection orchestration, without loading editors.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/CamoxCanvas.tsx")) return nextResolve(specifier, context);
    let source: string | undefined;
    if (specifier === "@tanstack/react-query")
      source = "export const useQuery = (options) => globalThis.CanvasQueryProbe(options)";
    if (specifier.endsWith("/auth"))
      source = `export const useProjectSlug = () => "site";
        export const useAuthContext = () => ({apiUrl: "", projectSlug: "site"});`;
    if (specifier.endsWith("/queries"))
      source = `export const projectQueries = {getBySlug: () => ({queryKey: ["project"]})};
        export const pageQueries = {list: () => ({queryKey: ["pages"]})};`;
    if (specifier.endsWith("/navigation"))
      source = `export const useLocation = () => globalThis.CanvasLocation;
        export const useNavigate = () => () => {};`;
    if (specifier.endsWith("/CamoxAppContext"))
      source = "export const useCamoxApp = () => ({getLayouts: () => []})";
    if (specifier === "@xstate/store-react")
      source =
        "export const useSelector = (_, selector) => selector({context: {viewportMode: 'full'}})";
    if (specifier.endsWith("/previewStore"))
      source = `export const previewStore = {send: () => {}};
        export const selectIsCommentMode = () => false;`;
    if (specifier.endsWith("/useCanvasCamera"))
      source = "export const useCanvasCamera = () => ({viewportRef: null, contentRef: null})";
    if (specifier.endsWith("/CanvasPageFrame"))
      source = "export const CanvasPageFrame = (props) => globalThis.CanvasFrameProbe(props)";
    for (const name of [
      "FieldToolbar",
      "CanvasLeftSidebar",
      "CanvasRightSidebar",
      "CanvasPageHeader",
    ]) {
      if (specifier.endsWith(`/${name}`)) source = `export const ${name} = () => null`;
    }
    if (specifier.endsWith("/PreviewPanel"))
      source = "export const CuratedBlockShortcuts = () => null";
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

void test("Canvas startup failures are selected-only and retryable", async (t) => {
  const dom = new Window({ url: "http://localhost/about" });
  const failure = new Error("test preparation failure");
  let scenario = "";
  let retries = 0;
  const globals = {
    React,
    window: dom,
    document: dom.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    CanvasLocation: { pathname: "/about", search: "", hash: "" },
    CanvasQueryProbe: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = queryKey[0];
      const pathname = queryKey[4];
      const errorScenario = scenario.replace(" retry", "");
      const error =
        errorScenario === key ||
        (errorScenario === "selected payload" && pathname === "/about") ||
        (errorScenario === "unselected payload" && pathname === "/contact")
          ? failure
          : null;
      const data =
        key === "project"
          ? { id: 1 }
          : key === "pages"
            ? [
                { id: 1, nickname: "About", fullPath: "/about" },
                { id: 2, nickname: "Contact", fullPath: "/contact" },
              ]
            : { pathname };
      return {
        data,
        error,
        isPending: scenario === "pending" && key === "pages",
        isFetching: scenario.endsWith(" retry"),
        refetch: () => retries++,
      };
    },
    CanvasFrameProbe: ({ selected }: { selected: boolean }) => {
      if (
        (scenario === "selected render" && selected) ||
        (scenario === "unselected render" && !selected)
      )
        throw failure;
      return <div>Page content</div>;
    },
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CamoxCanvas } = await import("./CamoxCanvas");
  const { PreviewPreparationContext } = await import("../preview/previewPreparation");
  try {
    for (const name of [
      "pending",
      "project",
      "project retry",
      "pages",
      "pages retry",
      "selected payload",
      "selected payload retry",
      "unselected payload",
      "selected render",
      "unselected render",
      "unmatched",
    ]) {
      await t.test(name, async () => {
        scenario = name;
        retries = 0;
        globals.CanvasLocation.pathname = name === "unmatched" ? "/missing" : "/about";
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement, { onCaughtError: () => {} });
        const errors: Error[] = [];
        try {
          await React.act(async () => {
            root.render(
              <PreviewPreparationContext
                value={{
                  ready: () => assert.fail("no frame committed"),
                  fail: (error) => errors.push(error),
                }}
              >
                <CamoxCanvas runtimeBasePath="" />
              </PreviewPreparationContext>,
            );
          });
          if (name === "pending" || name.startsWith("unselected") || name.endsWith(" retry")) {
            assert.deepEqual(errors, []);
          } else if (name === "unmatched") {
            assert.equal(errors.length, 1);
            assert.match(errors[0]!.message, /No canvas page matches \/missing/);
          } else {
            assert.deepEqual(errors, [failure]);
          }
          if (name.includes("payload") || name === "project" || name === "pages") {
            const retry = host.querySelector("button")!;
            assert.equal(retry.textContent, "Try again");
            await React.act(async () => retry.click());
            assert.equal(retries, 1);
          }
          if (name.includes("render")) {
            assert.match(host.textContent, /This page could not be rendered/);
            scenario = "";
            await React.act(async () => host.querySelector("button")!.click());
            assert.equal(host.querySelector("[role=alert]"), null);
          }
        } finally {
          await React.act(async () => root.unmount());
          host.remove();
        }
      });
    }
  } finally {
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
