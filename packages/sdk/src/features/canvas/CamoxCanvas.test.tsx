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
      source = `export const useQuery = (options) => globalThis.CanvasQueryProbe(options);
        export const useMutation = () => ({});
        export const useQueryClient = () => ({});`;
    if (specifier.endsWith("/auth"))
      source = `export const useProjectSlug = () => "site";
        export const useAuthContext = () => ({apiUrl: "", projectSlug: "site"});`;
    if (specifier.endsWith("/queries"))
      source = `export const projectQueries = {getBySlug: () => ({queryKey: ["project"]})};
        export const pageMutations = {update: () => ({})};
        export const pageQueries = {list: () => ({queryKey: ["pages"]})};`;
    if (specifier.endsWith("/navigation"))
      source = `export const useLocation = () => globalThis.CanvasLocation;
        export const useNavigate = () => globalThis.CanvasNavigate;`;
    if (specifier.endsWith("/CamoxAppContext"))
      source = "export const useCamoxApp = () => ({getLayouts: () => []})";
    if (specifier === "@xstate/store-react")
      source =
        "export const useSelector = (_, selector) => selector({context: {viewportMode: 'full'}})";
    if (specifier.endsWith("/previewStore"))
      source = `export const previewStore = {send: () => {}};
        export const selectIsCommentMode = () => globalThis.CanvasCommentMode;`;
    if (specifier.endsWith("/useCanvasCamera"))
      source = "export const useCanvasCamera = (...args) => globalThis.CanvasCameraProbe(...args)";
    if (specifier.endsWith("/CanvasPageFrame"))
      source = "export const CanvasPageFrame = (props) => globalThis.CanvasFrameProbe(props)";
    for (const name of ["FieldToolbar", "CanvasLeftSidebar", "CanvasRightSidebar"]) {
      if (specifier.endsWith(`/${name}`)) source = `export const ${name} = () => null`;
    }
    if (specifier.endsWith("/CanvasPageHeader"))
      source = "export const CanvasPageHeader = (props) => globalThis.CanvasHeaderProbe(props)";
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
  let includeNewPage = false;
  const flights: string[] = [];
  const actions: string[] = [];
  const frames = new Map<string, { onActivate: (owner: never, source: string) => void }>();
  const headers = new Map<string, { onSelect: () => void; onChange: (path: string) => void }>();
  let snap!: (key: string) => void;
  const flyToPage = (key: string) => flights.push(key);
  const cancelFlight = () => actions.push("cancel");
  const globals = {
    React,
    window: dom,
    document: dom.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    CanvasLocation: {
      pathname: "/about",
      search: "",
      hash: "",
      source: undefined as "canvas" | undefined,
    },
    CanvasCommentMode: false,
    CanvasNavigate: (options: { to: string; source?: "canvas" }) => {
      actions.push("navigate");
      assert.equal(options.source, "canvas");
      globals.CanvasLocation = {
        ...globals.CanvasLocation,
        pathname: options.to,
        source: options.source,
      };
    },
    CanvasCameraProbe: (_key: string, _page: unknown, options: { onSelect: typeof snap }) => {
      snap = options.onSelect;
      return { viewportRef: null, contentRef: null, flyToPage, cancelFlight };
    },
    CanvasHeaderProbe: (props: {
      page: { key: string };
      onSelect: () => void;
      onChange: (path: string) => void;
    }) => {
      headers.set(props.page.key, props);
      return null;
    },
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
                ...(includeNewPage ? [{ id: 3, nickname: "New", fullPath: "/new" }] : []),
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
    CanvasFrameProbe: (props: {
      selected: boolean;
      input: { pathname: string };
      onActivate: (owner: never, source: string) => void;
    }) => {
      const { selected } = props;
      frames.set(props.input.pathname, props);
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
    for (const commentMode of [false, true]) {
      await t.test(`navigation flight wiring (comment mode: ${commentMode})`, async () => {
        scenario = "";
        includeNewPage = false;
        flights.length = 0;
        actions.length = 0;
        globals.CanvasCommentMode = commentMode;
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        const render = async () => {
          Object.assign(globalThis, globals);
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
        };
        try {
          await render();
          assert.equal(flights.length, 0, "mount does not fly");
          const header = host.querySelector("[data-canvas-header]") as unknown as HTMLElement;
          assert.equal(
            header.style.transform,
            "translate(calc(var(--canvas-x, 64px) + 0px * var(--canvas-zoom, .4)), calc(var(--canvas-y, 112px) - 52px))",
          );
          assert.equal(header.style.width, "calc(1366px * var(--canvas-zoom, .4))");
          assert.equal(header.style.willChange, "transform");
          globals.CanvasLocation.pathname = "/contact";
          await render();
          assert.equal(flights.length, 1, "external navigation flies");
          assert.equal(flights[0], [...headers.keys()][1], "flight targets the selected page key");
          globals.CanvasLocation.search = "?view=wide";
          globals.CanvasLocation.hash = "#section";
          await render();
          assert.equal(flights.length, 1, "query/hash changes do not fly");
          globals.CanvasLocation.search = "";
          globals.CanvasLocation.hash = "";
          for (const select of [
            () => frames.get("/about")!.onActivate(null as never, "interaction"),
            () => [...headers.values()][1]!.onSelect(),
            () => [...headers.values()][0]!.onChange("/about"),
            () => snap([...headers.keys()][1]!),
          ]) {
            await React.act(async () => select());
            assert.deepEqual(actions.splice(0), ["cancel", "navigate"]);
            await render();
            assert.equal(flights.length, 1, "canvas selections do not fly");
          }
          globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
          await render();
          assert.equal(flights.length, 2, "external navigation after canvas selection flies");
          globals.CanvasLocation.pathname = "/new";
          await render();
          assert.equal(flights.length, 2, "wait for a newly created page to appear in the list");
          includeNewPage = true;
          await render();
          assert.equal(flights.length, 3, "fly once the destination geometry is available");
          await render();
          assert.equal(flights.length, 3, "refreshing the same destination does not refly");
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
