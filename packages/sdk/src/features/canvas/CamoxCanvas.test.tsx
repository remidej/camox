import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import { CANVAS_SLOT_WIDTH } from "./canvasItems";

// Keep the real Canvas query/error/selection orchestration, without loading editors.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/CamoxCanvas.tsx")) return nextResolve(specifier, context);
    let source: string | undefined;
    if (specifier === "@tanstack/react-query")
      source = `export const useMutation = () => ({});
        export const useQueryClient = () => null;`;
    // Each read answers the probe under a name it dispatches on; a frame's names its path.
    if (specifier.endsWith("/studio-reads"))
      source = `export const reads = {
          project: () => ({queryKey: ["project"]}),
          pageList: () => ({queryKey: ["pages"]}),
          page: () => ({queryKey: ["page"]}),
          canvasFrame: ({projectUuid, runtimeBasePath, pathname}) =>
            ({queryKey: ["canvasFrame", projectUuid, runtimeBasePath, null, pathname]}),
          discoveredPath: () => ({queryKey: ["discoveredPath"]}),
        };
        export const useReadQuery = (read, options) => globalThis.CanvasQueryProbe({...read, ...options});
        export const useReadQueries = (list, combine) => combine(list.map(() => ({})));
        export const useStudioCache = () => ({});`;
    // No derived layout has a discovered page.
    if (specifier.endsWith("/useDiscoveredPreviewPaths"))
      source = "export const useDiscoveredPreviewPaths = () => new Map()";
    if (specifier.endsWith("/auth"))
      source = `export const useProjectUuid = () => "site";
        export const useAuthContext = () => ({apiUrl: "", projectUuid: "site"});`;
    if (specifier.endsWith("/queries"))
      source = `export const pageMutations = {update: () => ({})};`;
    if (specifier.endsWith("/navigation"))
      source = `export const useLocation = () => globalThis.CanvasLocation;
        export const useNavigate = () => globalThis.CanvasNavigate;
        export const NavigationProvider = (props) => globalThis.CanvasNavigationProbe(props);`;
    // No layout pages: the draft's definitions list no layouts, and the studio has no code.
    if (specifier.endsWith("/studio-definitions"))
      source = "export const useRoutableLayouts = () => []";
    if (specifier.endsWith("/CamoxAppContext"))
      source = "export const useOptionalCamoxApp = () => undefined";
    if (specifier === "@xstate/store-react")
      source =
        "export const useSelector = (_, selector) => selector({context: {viewportMode: globalThis.CanvasViewportMode ?? 'full'}})";
    if (specifier.endsWith("/previewStore"))
      source = "export const previewStore = {send: () => {}};";
    if (specifier.endsWith("/useCanvasCamera"))
      source = "export const useCanvasCamera = (...args) => globalThis.CanvasCameraProbe(...args)";
    if (specifier.endsWith("/CanvasPageFrame"))
      source = "export const CanvasPageFrame = (props) => globalThis.CanvasFrameProbe(props)";
    if (specifier.endsWith("/CanvasPreviewPageSlot"))
      source =
        "export const CanvasPreviewPageSlot = (props) => { globalThis.CanvasPreviewSlotProbe?.(props); return null }";
    if (specifier.endsWith("/FieldToolbar")) source = "export const FieldToolbar = () => null";
    if (specifier.endsWith("/ContentSidebar"))
      source = `export const ContentSidebar = (props) => globalThis.ContentSidebarProbe("Canvas", props)`;
    if (specifier.endsWith("/CanvasPageHeader"))
      source = "export const CanvasPageHeader = (props) => globalThis.CanvasHeaderProbe(props)";
    if (specifier.endsWith("/PreviewPanel"))
      source = "export const CuratedBlockShortcuts = () => null";
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/** World x positions in a style placed through the Canvas camera, in order. */
function worldXs(style: string) {
  return [...style.matchAll(/(-?[\d.]+)px \* var\(--canvas-zoom/g)].map(([, x]) => Number(x));
}

void test("Canvas startup failures are selected-only and retryable", async (t) => {
  const dom = new Window({ url: "http://localhost/about" });
  const failure = new Error("test preparation failure");
  let scenario = "";
  let retries = 0;
  let includeNewPage = false;
  const flights: string[] = [];
  const actions: string[] = [];
  const frames = new Map<
    string,
    { mode?: string; onActivate: (owner: never, source: string, release: () => void) => void }
  >();
  /** Whether Page frames are near the camera as soon as they are observed. */
  let nearByDefault = true;
  const nearness: { element: Element; report: (isIntersecting: boolean) => void }[] = [];
  class TestIntersectionObserver {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe(element: Element) {
      const report = (isIntersecting: boolean) => this.callback([{ isIntersecting }]);
      nearness.push({ element, report });
      if (nearByDefault) report(true);
    }
    disconnect() {}
  }
  const headers = new Map<string, { onSelect: () => void; onChange: (path: string) => void }>();
  let snap!: (key: string) => void;
  let snapTargets: { key: string }[] = [];
  let cameraWidth: number | undefined;
  let initialTarget: { left: number } | undefined;
  let cameraKey = "";
  let cameraRow!: {
    selected?: string | null;
    onDeselect?: () => void;
  };
  let sidebarPathname: string | undefined;
  type SidebarProps = {
    page?: { key: string };
    navigator?: {
      pages: { key: string }[];
      selectedKey?: string;
      onShowPage: (key: string) => void;
    };
    onShowWholeCanvas?: () => void;
  };
  const sidebars = new Map<string, SidebarProps>();
  const flyTo = (key: string) => flights.push(key);
  const fitAll = () => actions.push("fit all");
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IntersectionObserver: TestIntersectionObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    CanvasLocation: {
      pathname: "/about",
      search: "",
      hash: "",
      source: undefined as "canvas" | undefined,
    },
    CanvasNavigationProbe: (props: {
      location: { pathname: string };
      children: React.ReactNode;
    }) => {
      sidebarPathname = props.location.pathname;
      return props.children;
    },
    ContentSidebarProbe: (side: string, props: SidebarProps) => {
      sidebars.set(side, props);
      return null;
    },
    CanvasNavigate: (options: { to: string; source?: "canvas" }) => {
      actions.push("navigate");
      assert.equal(options.source, "canvas");
      globals.CanvasLocation = {
        ...globals.CanvasLocation,
        pathname: options.to,
        source: options.source,
      };
    },
    CanvasCameraProbe: (
      key: string,
      target: { left: number } | undefined,
      options: {
        onSelect: typeof snap;
        targets: { key: string }[];
        width?: number;
      } & typeof cameraRow,
    ) => {
      cameraKey = key;
      initialTarget = target;
      cameraRow = options;
      snap = options.onSelect;
      snapTargets = options.targets;
      cameraWidth = options.width;
      return { viewportRef: null, contentRef: null, flyTo, fitAll };
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
            : key === "layouts"
              ? []
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
      mode?: string;
      input: { pathname: string };
      onActivate: (owner: never, source: string, release: () => void) => void;
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
  const { canvasStore } = await import("./canvasStore");
  const { PreviewPreparationContext } = await import("../preview/previewPreparation");
  const { FollowAgentContext } = await import("../studio/followAgentContext");
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
    await t.test("Pages sit side by side as snap targets, within the Canvas bounds", async () => {
      scenario = "";
      includeNewPage = false;
      globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
      Object.assign(globalThis, globals);
      const host = dom.document.createElement("div");
      dom.document.body.append(host);
      const root = createRoot(host as unknown as HTMLElement);
      try {
        await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
        const row = host.querySelector("[data-canvas-items]")!;
        assert.deepEqual(
          [...row.querySelectorAll("[data-canvas-pathname]")].map((frame) =>
            frame.getAttribute("data-canvas-pathname"),
          ),
          ["/about", "/contact"],
        );
        assert.deepEqual(
          snapTargets.map(({ key }) => key),
          [...headers.keys()],
          "Pages are snap targets",
        );
        const headerLefts = [...host.querySelectorAll("[data-canvas-header]")].map(
          (header) => worldXs((header as unknown as HTMLElement).style.transform)[0]!,
        );
        assert.equal(
          cameraWidth,
          headerLefts.at(-1)! + CANVAS_SLOT_WIDTH,
          "the Canvas bounds end with the last Page",
        );
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
      }
    });
    await t.test(
      "the Content Sidebar's navigator shows the picked Page, and the back button the whole Canvas",
      async () => {
        scenario = "";
        includeNewPage = false;
        flights.length = 0;
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        const render = async () => {
          Object.assign(globalThis, globals);
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
        };
        const navigator = () => sidebars.get("Canvas")!.navigator!;
        const committingNavigate = globals.CanvasNavigate;
        const navigations: { to: string; source?: "canvas" }[] = [];
        try {
          await render();
          const [about, contact] = [...headers.keys()];
          assert.deepEqual(
            navigator().pages.map(({ key }) => key),
            [about, contact],
            "the navigator holds every Page, in Canvas order",
          );
          assert.equal(navigator().selectedKey, about);

          // Picking a Page in the navigator selects it without the canvas source.
          globals.CanvasNavigate = (options) => {
            navigations.push(options);
          };
          await render();
          await React.act(async () => navigator().onShowPage(contact!));
          assert.deepEqual(navigations.splice(0), [{ to: "/contact" }]);
          globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/contact" };
          await render();
          assert.equal(cameraRow.selected, contact, "the camera flies to the picked Page");
          assert.equal(navigator().selectedKey, contact);
          assert.equal(sidebars.get("Canvas")!.page?.key, contact);

          // Picking the selected Page again has nothing to select, but still flies to it.
          await React.act(async () => navigator().onShowPage(contact!));
          assert.deepEqual(navigations, []);
          assert.deepEqual(flights, [contact]);
          flights.length = 0;

          // The back button leaves the selection from the Canvas, then zooms out to all of it.
          actions.length = 0;
          await React.act(async () => sidebars.get("Canvas")!.onShowWholeCanvas!());
          assert.deepEqual(navigations.splice(0), [{ to: "/camox/canvas", source: "canvas" }]);
          assert.deepEqual(actions, ["fit all"]);

          // A request from outside the Canvas, like the show whole canvas action, zooms out too.
          actions.length = 0;
          await React.act(async () => canvasStore.send({ type: "requestOverview" }));
          assert.deepEqual(actions, ["fit all"]);
        } finally {
          globals.CanvasNavigate = committingNavigate;
          await React.act(async () => root.unmount());
          host.remove();
          globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
          Object.assign(globalThis, globals);
        }
      },
    );
    await t.test("Pages load once near the camera, and stay live only while near", async () => {
      scenario = "";
      includeNewPage = false;
      globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
      Object.assign(globalThis, globals);
      nearByDefault = false;
      nearness.length = 0;
      frames.clear();
      const host = dom.document.createElement("div");
      dom.document.body.append(host);
      const root = createRoot(host as unknown as HTMLElement);
      const reportNear = (pathname: string, near: boolean) => {
        const slot = host.querySelector(`[data-canvas-pathname="${pathname}"]`)!;
        const observed = nearness.filter(({ element }) => slot.contains(element as never));
        assert.equal(observed.length, 1, `${pathname} is observed once`);
        return React.act(async () => observed[0]!.report(near));
      };
      const render = () =>
        React.act(async () =>
          root.render(
            <PreviewPreparationContext value={{ ready: () => {}, fail: () => {} }}>
              <CamoxCanvas runtimeBasePath="" />
            </PreviewPreparationContext>,
          ),
        );
      try {
        await render();
        const mode = (pathname: string) => frames.get(pathname)?.mode;
        assert.equal(mode("/about"), "live", "the selected Page loads right away");
        assert.equal(frames.has("/contact"), false, "other Pages wait for the camera");

        await reportNear("/contact", true);
        assert.equal(mode("/contact"), "paused", "a Page loads once near, paused");
        await reportNear("/contact", false);
        assert.equal(mode("/contact"), "resting", "away, its frame stays but rests");
        await reportNear("/contact", true);
        assert.equal(mode("/contact"), "paused");

        const setMoving = (moving: boolean) =>
          React.act(async () =>
            canvasStore.send({ type: "setCameraMoving", workspaceKey: cameraKey, moving }),
          );
        await setMoving(true);
        assert.equal(mode("/about"), "paused", "the camera moving pauses even the selection");
        assert.equal(mode("/contact"), "paused");
        await setMoving(false);
        assert.equal(mode("/about"), "live");

        await reportNear("/about", false);
        assert.equal(mode("/about"), "live", "the selected Page stays live away");
        globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/contact" };
        Object.assign(globalThis, globals);
        await render();
        assert.equal(mode("/contact"), "live", "the newly selected Page goes live");
        frames.clear();
        await render();
        assert.equal(mode("/about"), "resting", "the deselected one stays loaded but rests");
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
        nearByDefault = true;
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
      }
    });
    await t.test(
      "the Preview's Page shows the Preview's own frame, following the selection",
      async () => {
        scenario = "";
        includeNewPage = false;
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
        frames.clear();
        const slots: { pageId?: string }[] = [];
        Object.assign(globalThis, {
          CanvasPreviewSlotProbe: (props: { pageId?: string }) => slots.push(props),
        });
        const { PreviewPageFrame, PreviewPageFrameContext } =
          await import("../preview/previewPageFrame");
        const frame = new PreviewPageFrame();
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        // The Preview names the page its frame shows.
        const render = (pathname = globals.CanvasLocation.pathname) =>
          React.act(async () =>
            root.render(
              <PreviewPageFrameContext value={{ frame, revealed: true, pathname }}>
                <PreviewPreparationContext value={{ ready: () => {}, fail: () => {} }}>
                  <CamoxCanvas runtimeBasePath="" />
                </PreviewPreparationContext>
              </PreviewPageFrameContext>,
            ),
          );
        const previewed = () =>
          [...host.querySelectorAll("[data-canvas-preview-page]")].map((page) =>
            page.getAttribute("data-canvas-pathname"),
          );
        try {
          await render();
          assert.deepEqual(previewed(), ["/about"]);
          assert.ok(slots.length > 0, "its slot takes the Preview page frame");
          assert.equal(frames.has("/about"), false, "the Canvas renders no second frame of it");
          assert.ok(frames.has("/contact"), "other Pages keep frames of their own");

          // Zooming out deselects the Page, but the Preview still shows it.
          globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/camox/canvas" };
          Object.assign(globalThis, globals);
          await render("/about");
          assert.deepEqual(previewed(), ["/about"], "the deselected Page keeps the Preview frame");
          assert.equal(frames.has("/about"), false, "and never remounts in a frame of its own");

          globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/contact" };
          Object.assign(globalThis, globals);
          frames.clear();
          await render();
          assert.deepEqual(previewed(), ["/contact"]);
          assert.ok(frames.has("/about"), "the deselected Page gets a frame of its own");
          assert.equal(frames.has("/contact"), false);
        } finally {
          await React.act(async () => root.unmount());
          host.remove();
          Reflect.deleteProperty(globalThis, "CanvasPreviewSlotProbe");
          globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
          Object.assign(globalThis, globals);
        }
      },
    );
    await t.test("the Canvas route opens the Canvas with nothing selected", async () => {
      scenario = "";
      includeNewPage = false;
      flights.length = 0;
      globals.CanvasLocation = {
        pathname: "/camox/canvas",
        search: "",
        hash: "",
        source: undefined,
      };
      Object.assign(globalThis, globals);
      const host = dom.document.createElement("div");
      dom.document.body.append(host);
      const root = createRoot(host as unknown as HTMLElement);
      const signals: string[] = [];
      try {
        await React.act(async () =>
          root.render(
            <PreviewPreparationContext
              value={{
                ready: () => signals.push("ready"),
                fail: (error) => signals.push(error.message),
              }}
            >
              <CamoxCanvas runtimeBasePath="" />
            </PreviewPreparationContext>,
          ),
        );
        assert.deepEqual(signals, ["ready"], "no frame needs to load first");
        assert.equal(initialTarget, undefined, "the camera starts on the overview");
        assert.equal(cameraRow.selected, null);
        assert.equal(
          sidebars.get("Canvas")!.page,
          undefined,
          "the Content Sidebar shows the Canvas",
        );
        assert.equal(
          sidebars.get("Canvas")!.navigator!.selectedKey,
          undefined,
          "nothing is current",
        );
        assert.equal(sidebarPathname, "/camox/canvas");
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
      }
    });
    await t.test(
      "zooming out of a selection goes to the Canvas route, and the Content Sidebar follows",
      async () => {
        scenario = "";
        includeNewPage = false;
        flights.length = 0;
        actions.length = 0;
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        const signals: string[] = [];
        const render = async () => {
          Object.assign(globalThis, globals);
          await React.act(async () =>
            root.render(
              <PreviewPreparationContext
                value={{
                  ready: () => signals.push("ready"),
                  fail: (error) => signals.push(error.message),
                }}
              >
                <CamoxCanvas runtimeBasePath="" />
              </PreviewPreparationContext>,
            ),
          );
        };
        const shownPage = (side: string) => sidebars.get(side)!.page?.key;
        const committingNavigate = globals.CanvasNavigate;
        try {
          await render();
          const [about, contact] = [...headers.keys()];
          assert.equal(cameraRow.selected, about);

          // Navigation commits once the route payload loads; hold it to see what moves first.
          const navigations: { to: string; source?: "canvas" }[] = [];
          globals.CanvasNavigate = (options) => {
            navigations.push(options);
          };
          const commit = async () => {
            committingNavigate(navigations.splice(0).at(-1)!);
            await render();
          };

          await render();
          let released = 0;
          await React.act(async () =>
            frames
              .get("/about")!
              .onActivate({ kind: "page", pageId: "1" } as never, "selection", () => released++),
          );
          await React.act(async () => cameraRow.onDeselect!());
          assert.deepEqual(navigations, [{ to: "/camox/canvas", source: "canvas" }]);
          assert.equal(released, 0, "the Page keeps the editing frame until the route commits");
          assert.equal(cameraRow.selected, null, "the camera has nothing left to deselect");
          assert.equal(
            shownPage("Canvas"),
            undefined,
            "the Content Sidebar switches to the Canvas at once",
          );
          assert.equal(sidebarPathname, "/camox/canvas");

          await commit();
          assert.equal(released, 1, "on the Canvas route, the Page lets the editing frame go");
          assert.deepEqual(signals, ["ready"]);
          assert.equal(flights.length, 0, "deselecting does not fly");
          assert.equal(cameraRow.selected, null);
          assert.equal(shownPage("Canvas"), undefined);
          assert.equal(sidebarPathname, "/camox/canvas");

          // Going back from outside the Canvas, to the Page it was left from, selects it again.
          globals.CanvasLocation = {
            ...globals.CanvasLocation,
            pathname: "/about",
            source: undefined,
          };
          await render();
          assert.equal(cameraRow.selected, about);
          assert.equal(shownPage("Canvas"), about, "the deselection is over, not intended again");
          assert.equal(sidebarPathname, "/about");
          globals.CanvasLocation = {
            ...globals.CanvasLocation,
            pathname: "/camox/canvas",
            source: "canvas",
          };
          await render();
          flights.length = 0;

          await React.act(async () => snap(contact!));
          assert.equal(cameraRow.selected, contact);
          assert.equal(shownPage("Canvas"), contact, "snapping to a Page switches them at once");
          assert.equal(sidebarPathname, "/contact");

          await commit();
          assert.equal(shownPage("Canvas"), contact);
          assert.equal(sidebarPathname, "/contact");
          assert.equal(flights.length, 0, "selecting by snapping does not fly");
        } finally {
          globals.CanvasNavigate = committingNavigate;
          await React.act(async () => root.unmount());
          host.remove();
          globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
          Object.assign(globalThis, globals);
        }
      },
    );
    await t.test(
      "the editor's own Canvas selections stop following the agent; the camera deselecting by itself doesn't",
      async () => {
        scenario = "";
        includeNewPage = false;
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        let takeOvers = 0;
        const follow = { receive: () => {}, resume: () => {}, takeOver: () => takeOvers++ };
        const render = async () => {
          Object.assign(globalThis, globals);
          await React.act(async () =>
            root.render(
              <FollowAgentContext value={follow}>
                <PreviewPreparationContext value={{ ready: () => {}, fail: () => {} }}>
                  <CamoxCanvas runtimeBasePath="" />
                </PreviewPreparationContext>
              </FollowAgentContext>,
            ),
          );
        };
        try {
          await render();
          // The camera leaves the page's snap without the editor, as a block reveals itself.
          await React.act(async () => cameraRow.onDeselect!());
          assert.equal(takeOvers, 0);
          await render();
          for (const select of [
            () => [...headers.values()][1]!.onSelect(),
            () => frames.get("/about")!.onActivate(null as never, "interaction", () => {}),
            () => [...headers.values()][0]!.onChange("/about"),
            () => sidebars.get("Canvas")!.onShowWholeCanvas!(),
          ]) {
            const before: number = takeOvers;
            await React.act(async () => select());
            assert.equal(takeOvers, before + 1);
            await render();
          }
        } finally {
          await React.act(async () => root.unmount());
          host.remove();
        }
      },
    );
    await t.test("narrower devices center their frames in shaded areas", async () => {
      scenario = "";
      includeNewPage = false;
      globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
      Object.assign(globalThis, globals);
      const host = dom.document.createElement("div");
      dom.document.body.append(host);
      const root = createRoot(host as unknown as HTMLElement);
      const slots = () =>
        [...host.querySelectorAll("[data-canvas-slot]")].map(
          (slot) => slot as unknown as HTMLElement,
        );
      const frames = () =>
        [...host.querySelectorAll("[data-canvas-page]")].map(
          (frame) => frame as unknown as HTMLElement,
        );
      const frameWidths = () => frames().map((frame) => frame.style.width);
      try {
        for (const mode of ["full", "desktop"]) {
          Object.assign(globalThis, { CanvasViewportMode: mode });
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          assert.deepEqual(
            frameWidths(),
            slots().map(() => `${CANVAS_SLOT_WIDTH}px`),
            `${mode} frames fill their areas`,
          );
          assert.ok(
            slots().every((slot) => !slot.hasAttribute("data-canvas-slot-shaded")),
            `${mode} areas are not shaded`,
          );
          assert.ok(
            slots().every((slot) => !parseFloat(slot.style.paddingBlock)),
            `${mode} frames touch the top of their areas`,
          );
        }
        for (const mode of ["tablet", "mobile"]) {
          Object.assign(globalThis, { CanvasViewportMode: mode });
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          assert.equal(slots().length, 2, "every Page has an area");
          assert.ok(
            frameWidths().every((width) => parseFloat(width) < CANVAS_SLOT_WIDTH),
            `${mode} frames are narrower than their areas`,
          );
          assert.ok(
            slots().every((slot) => slot.hasAttribute("data-canvas-slot-shaded")),
            `${mode} areas are shaded`,
          );
          assert.ok(
            slots().every((slot) => parseFloat(slot.style.paddingBlock) > 0),
            `${mode} frames keep apart from the edges of their areas`,
          );
        }
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
        Object.assign(globalThis, { CanvasViewportMode: undefined });
        Object.assign(globalThis, globals);
      }
    });
    await t.test("selection wiring", async () => {
      scenario = "";
      includeNewPage = false;
      flights.length = 0;
      actions.length = 0;
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
        const [about, contact] = [...headers.keys()];
        assert.equal(cameraRow.selected, about);
        const header = host.querySelector("[data-canvas-header]") as unknown as HTMLElement;
        assert.equal(
          header.style.transform,
          "translate(calc(var(--canvas-x, 64px) + 0px * var(--canvas-zoom, .4)), calc(var(--canvas-y, 112px) - 52px))",
        );
        assert.equal(header.style.width, "calc(1366px * var(--canvas-zoom, .4))");
        assert.equal(header.style.willChange, "transform");
        globals.CanvasLocation.pathname = "/contact";
        await render();
        assert.equal(cameraRow.selected, contact, "external navigation selects in the camera");
        globals.CanvasLocation.search = "?view=wide";
        globals.CanvasLocation.hash = "#section";
        await render();
        assert.equal(cameraRow.selected, contact, "query/hash changes keep the selection");
        globals.CanvasLocation.search = "";
        globals.CanvasLocation.hash = "";
        for (const [select, key] of [
          [() => frames.get("/about")!.onActivate(null as never, "interaction", () => {}), about],
          [() => [...headers.values()][1]!.onSelect(), contact],
          [() => [...headers.values()][0]!.onChange("/about"), about],
          [() => snap(contact!), contact],
        ] as const) {
          await React.act(async () => select());
          assert.deepEqual(actions.splice(0), ["navigate"]);
          assert.equal(cameraRow.selected, key, "Canvas selections reach the camera at once");
          await render();
          assert.equal(cameraRow.selected, key);
        }
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        await render();
        assert.equal(cameraRow.selected, about, "external navigation after canvas selection");
        globals.CanvasLocation.pathname = "/new";
        await render();
        assert.equal(
          cameraRow.selected,
          null,
          "wait for a newly created page to appear in the list",
        );
        includeNewPage = true;
        await render();
        assert.ok(cameraRow.selected, "select once the destination geometry is available");
        assert.ok(![about, contact].includes(cameraRow.selected));
        assert.equal(flights.length, 0, "the Canvas leaves flights to the camera");
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
      }
    });
  } finally {
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
