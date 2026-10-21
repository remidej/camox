import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import { CANVAS_SLOT_WIDTH } from "./canvasItems";
import { CANVAS_SHELF_MARKER_OVERHANG } from "./CanvasShelfMarker";

// Keep the real Canvas query/error/selection orchestration, without loading editors.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.endsWith("/CamoxCanvas.tsx")) return nextResolve(specifier, context);
    let source: string | undefined;
    if (specifier === "@tanstack/react-query") source = `export const useMutation = () => ({});`;
    // Each read answers the probe under a name it dispatches on; a frame's names its path.
    if (specifier.endsWith("/studio-reads"))
      source = `export const reads = {
          project: () => ({queryKey: ["project"]}),
          pageList: () => ({queryKey: ["pages"]}),
          page: () => ({queryKey: ["page"]}),
          pagesUsingBlock: ({type}) => ({queryKey: ["blockPages", type]}),
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
    if (specifier.endsWith("/CamoxAppContext"))
      source =
        "export const useCamoxApp = () => ({getLayouts: () => [], getBlocks: () => globalThis.CanvasBlocks, getBlockById: (id) => globalThis.CanvasBlocks.find((block) => block._internal.id === id)})";
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
    if (specifier.endsWith("/CanvasBlockFrame"))
      source = "export const CanvasBlockFrame = (props) => globalThis.CanvasBlockFrameProbe(props)";
    if (specifier.endsWith("/FieldToolbar")) source = "export const FieldToolbar = () => null";
    if (specifier.endsWith("/CanvasSidebar"))
      source = `export const CanvasSidebar = (props) => globalThis.CanvasSidebarProbe("Canvas", props)`;
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
  let failingBlock: string | undefined;
  let blockPages: Record<string, { id: number }[]> = {};
  let initialTarget: { left: number } | undefined;
  let cameraKey = "";
  let cameraRow!: {
    selected?: string | null;
    onDeselect?: () => void;
    onSnap?: () => void;
    onSnapStretched?: () => void;
  };
  let sidebarPathname: string | undefined;
  const blockFrames = new Map<string, { onSelect: () => void }>();
  type SidebarProps = {
    page?: { key: string };
    navigator?: {
      shelves: { key: string; items: { key: string }[] }[];
      selectedKey?: string;
      onShowItem: (key: string) => void;
    };
    catalog?: {
      block: { _internal: { id: string } };
      blocks?: { _internal: { id: string } }[];
      projectId?: number;
    };
    onShowWholeCanvas?: () => void;
  };
  const sidebars = new Map<string, SidebarProps>();
  const flyTo = (key: string) => flights.push(key);
  const keptInView: [number, number][] = [];
  const keepInView = (worldX: number, screenX: number) => keptInView.push([worldX, screenX]);
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
    CanvasBlocks: [] as unknown[],
    CanvasNavigationProbe: (props: {
      location: { pathname: string };
      children: React.ReactNode;
    }) => {
      sidebarPathname = props.location.pathname;
      return props.children;
    },
    CanvasSidebarProbe: (side: string, props: SidebarProps) => {
      sidebars.set(side, props);
      return null;
    },
    CanvasBlockFrameProbe: (props: {
      block: { _internal: { id: string } };
      onSelect: () => void;
    }) => {
      blockFrames.set(props.block._internal.id, props);
      if (props.block._internal.id === failingBlock) throw failure;
      return <div>Block {props.block._internal.id}</div>;
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
      return { viewportRef: null, contentRef: null, flyTo, keepInView, fitAll };
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
              : key === "blockPages"
                ? (blockPages[queryKey[1] as string] ?? [])
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
    await t.test("Pages Shelf Marker spans the Pages above their headers", async () => {
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
          "the marker takes no slot in the row",
        );
        const label = host.querySelector('[data-canvas-shelf-marker-label="shelf:pages"]');
        assert.equal(label?.textContent, "Pages (2)", "the label counts the Pages");
        const bar = host.querySelector('[data-canvas-shelf-marker="shelf:pages"]');
        assert.ok(bar, "the marker draws its bar");
        assert.ok(!row.contains(bar), "the bar keeps a constant on-screen height");
        assert.match(bar.getAttribute("style") ?? "", /2972px/, "the bar spans both Pages");
        assert.deepEqual(
          snapTargets.map(({ key }) => key),
          [...headers.keys()],
          "Pages are snap targets",
        );
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
      }
    });
    await t.test(
      "the Block Catalog follows the Pages with page-content blocks in title order",
      async () => {
        scenario = "";
        includeNewPage = false;
        const block = (id: string, title: string, layoutOnly = false) => ({
          _internal: { id, title, description: `${title} description`, layoutOnly },
        });
        blockPages = { hero: [{ id: 1 }, { id: 2 }], tabs: [{ id: 2 }] };
        globals.CanvasBlocks = [
          block("tabs", "Tabs"),
          block("navbar", "Navbar", true),
          block("hero", "Hero"),
          block("faq", "FAQ"),
        ];
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
        // Opening the Canvas for the first time in the session.
        canvasStore.send({ type: "reset" });
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        let root = createRoot(host as unknown as HTMLElement);
        const blocksMarker = () =>
          host.querySelector('[data-canvas-shelf-marker="shelf:blocks"]') as unknown as HTMLElement;
        try {
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          const row = host.querySelector("[data-canvas-items]")!;
          assert.equal(
            blocksMarker().getAttribute("aria-expanded"),
            "false",
            "the Block Catalog starts collapsed",
          );
          assert.equal(row.querySelector("[data-canvas-block]"), null, "block frames don't mount");
          assert.doesNotMatch(host.textContent, /Block hero/);
          assert.deepEqual(
            snapTargets.map(({ key }) => key),
            [...headers.keys()],
            "collapsed blocks are not snap targets",
          );
          const collapsedWidth = cameraWidth;
          await React.act(async () => blocksMarker().click());
          assert.equal(blocksMarker().getAttribute("aria-expanded"), "true");
          assert.deepEqual(
            [...row.querySelectorAll("[data-canvas-slot]")].map((slot) =>
              slot.getAttribute("data-canvas-slot"),
            ),
            [...headers.keys(), "block:faq", "block:hero", "block:tabs"],
            "blocks follow the Pages alphabetically by title, without Layout-only Blocks",
          );
          assert.match(host.textContent, /Block hero/, "block frames render");
          assert.deepEqual(
            [...host.querySelectorAll("[data-canvas-shelf-marker-label]")].map(
              (label) => label.textContent,
            ),
            ["Pages (2)", "Blocks (3)"],
          );
          const headerLefts = [...host.querySelectorAll("[data-canvas-header]")].map(
            (header) => worldXs((header as unknown as HTMLElement).style.transform)[0]!,
          );
          const pitches = headerLefts.slice(1).map((left, index) => left - headerLefts[index]!);
          const [pagePitch, shelfPitch, ...blockPitches] = pitches;
          assert.deepEqual(
            blockPitches,
            blockPitches.map(() => pagePitch),
            "block slots have the width and gap of Page slots",
          );
          assert.ok(shelfPitch! > pagePitch!, "the Pages and Blocks areas are further apart");
          const blocksBar = host.querySelector(
            '[data-canvas-shelf-marker="shelf:blocks"]',
          ) as unknown as HTMLElement;
          const [blocksStart] = worldXs(blocksBar.style.transform);
          const [blocksEnd] = worldXs(blocksBar.style.width);
          assert.equal(blocksStart, headerLefts[2], "the Blocks area starts at the first block");
          assert.equal(
            blocksEnd,
            headerLefts[4]! + CANVAS_SLOT_WIDTH,
            "the Blocks area ends with the last block",
          );
          assert.deepEqual(
            [...host.querySelectorAll("[data-canvas-header] h2 > :last-child")].map(
              (title) => title.textContent,
            ),
            ["FAQ", "Hero", "Tabs"],
            "block headers show the block title below the usage",
          );
          assert.deepEqual(
            [...host.querySelectorAll("[data-canvas-block-usage]")].map(
              (usage) => usage.textContent,
            ),
            ["Unused", "Used on 2 pages", "Used on 1 page"],
            "block headers show how many Pages use the block",
          );
          assert.deepEqual(
            snapTargets.map(({ key }) => key),
            [...headers.keys(), "block:faq", "block:hero", "block:tabs"],
            "blocks are snap targets",
          );
          assert.equal(
            cameraWidth,
            headerLefts[4]! + CANVAS_SLOT_WIDTH,
            "the Canvas bounds cover Pages and blocks",
          );
          assert.equal(
            collapsedWidth,
            headerLefts[2],
            "collapsed, the Canvas bounds end at the Blocks marker",
          );
          await React.act(async () => blocksMarker().click());
          assert.equal(
            row.querySelector("[data-canvas-block]"),
            null,
            "collapsing unmounts blocks",
          );
          assert.equal(cameraWidth, collapsedWidth, "and shrinks the Canvas bounds again");
          await React.act(async () => root.unmount());
          root = createRoot(host as unknown as HTMLElement);
          globals.CanvasLocation = {
            pathname: "/camox/blocks/hero",
            search: "",
            hash: "",
            source: undefined,
          };
          Object.assign(globalThis, globals);
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          assert.equal(
            blocksMarker().getAttribute("aria-expanded"),
            "true",
            "reopening the Canvas on a block expands the Block Catalog",
          );
          assert.equal(initialTarget?.left, headerLefts[3], "and opens the camera on the block");
          globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
          Object.assign(globalThis, globals);
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          globals.CanvasBlocks = [block("navbar", "Navbar", true)];
          Object.assign(globalThis, globals);
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          assert.deepEqual(
            [...host.querySelectorAll("[data-canvas-shelf-marker-label]")].map(
              (label) => label.textContent,
            ),
            ["Pages (2)", "Blocks (0)"],
            "the Blocks Shelf Marker shows with no blocks",
          );
        } finally {
          await React.act(async () => root.unmount());
          host.remove();
          blockPages = {};
          globals.CanvasBlocks = [];
          Object.assign(globalThis, globals);
        }
      },
    );
    await t.test("blocks are selected by click, header or snap, and by URL", async () => {
      scenario = "";
      includeNewPage = false;
      flights.length = 0;
      actions.length = 0;
      const block = (id: string, title: string, layoutOnly = false) => ({
        _internal: { id, title, description: "", layoutOnly },
      });
      globals.CanvasBlocks = [
        block("faq", "FAQ"),
        block("hero", "Hero"),
        block("nav", "Nav", true),
      ];
      globals.CanvasLocation = {
        pathname: "/camox/blocks/hero",
        search: "",
        hash: "",
        source: undefined,
      };
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
      const headerLeft = (key: string) =>
        worldXs(
          (host.querySelector(`[data-canvas-header="${key}"]`) as unknown as HTMLElement).style
            .transform,
        )[0];
      try {
        await render();
        assert.deepEqual(signals, ["ready"], "a block link prepares the Canvas");
        assert.equal(
          initialTarget?.left,
          headerLeft("block:hero"),
          "a block link opens the Canvas on the block",
        );
        assert.equal(cameraRow.selected, "block:hero");
        assert.equal(flights.length, 0, "mount does not fly");

        let flashes = 0;
        let cancelled = 0;
        Object.defineProperty(host.querySelector("[data-canvas-snap-ring]"), "animate", {
          value: () => {
            flashes++;
            return { cancel: () => cancelled++ };
          },
        });
        for (const [select, path, key] of [
          [() => blockFrames.get("faq")!.onSelect(), "/camox/blocks/faq", "block:faq"],
          [
            () =>
              (
                host.querySelector(
                  '[data-canvas-header="block:hero"] button',
                ) as unknown as HTMLElement
              ).click(),
            "/camox/blocks/hero",
            "block:hero",
          ],
          [() => snap("block:faq"), "/camox/blocks/faq", "block:faq"],
          [() => snap([...headers.keys()][0]!), "/about", [...headers.keys()][0]],
        ] as const) {
          await React.act(async () => select());
          assert.deepEqual(actions.splice(0), ["navigate"]);
          assert.equal(flashes, 0, "selecting never flashes the viewport by itself");
          assert.equal(globals.CanvasLocation.pathname, path);
          await render();
          // The camera flies to a selection it didn't snap to itself.
          assert.equal(cameraRow.selected, key, "the camera holds the selection");
          assert.equal(flights.length, 0, "the Canvas leaves flights to the camera");
        }
        cameraRow.onSnap!();
        assert.equal(flashes, 1, "the camera snapping flashes the viewport");
        cameraRow.onSnapStretched!();
        assert.equal(cancelled, 1, "until a zoom stretches past the snap");

        globals.CanvasLocation = {
          pathname: "/camox/blocks/hero",
          search: "",
          hash: "",
          source: undefined,
        };
        await render();
        assert.equal(cameraRow.selected, "block:hero", "back/forward to a block selects it");
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        await render();
        assert.equal(cameraRow.selected, [...headers.keys()][0], "and back to a Page");

        signals.length = 0;
        globals.CanvasLocation = {
          pathname: "/camox/blocks/nav",
          search: "",
          hash: "",
          source: undefined,
        };
        await render();
        assert.match(
          signals.join(),
          /No canvas page matches/,
          "Layout-only Blocks aren't selectable",
        );
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
        globals.CanvasBlocks = [];
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
      }
    });
    await t.test(
      "a selected block shows its placements in the Canvas sidebar, which leads back to the Canvas navigator",
      async () => {
        scenario = "";
        includeNewPage = false;
        flights.length = 0;
        const block = (id: string, title: string, layoutOnly = false) => ({
          _internal: { id, title, description: "", layoutOnly },
        });
        globals.CanvasBlocks = [
          block("tabs", "Tabs"),
          block("nav", "Nav", true),
          block("faq", "FAQ"),
          block("hero", "Hero"),
        ];
        globals.CanvasLocation = {
          pathname: "/camox/blocks/hero",
          search: "",
          hash: "",
          source: undefined,
        };
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        const render = async () => {
          Object.assign(globalThis, globals);
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
        };
        const shown = (side: string) => {
          const { page, catalog } = sidebars.get(side)!;
          return {
            page: page?.key,
            block: catalog?.block._internal.id,
            projectId: catalog?.projectId,
          };
        };
        const navigator = () => sidebars.get("Canvas")!.navigator!;
        const committingNavigate = globals.CanvasNavigate;
        const navigations: { to: string; source?: "canvas" }[] = [];
        try {
          await render();
          assert.equal(shown("Canvas").page, undefined);
          assert.deepEqual(
            { block: shown("Canvas").block, projectId: shown("Canvas").projectId },
            { block: "hero", projectId: 1 },
            "the Canvas sidebar shows the Pages holding the selected block's placements",
          );
          assert.deepEqual(
            navigator().shelves.map(({ key, items }) => [key, items.map((item) => item.key)]),
            [
              ["shelf:pages", [...headers.keys()]],
              ["shelf:blocks", ["block:faq", "block:hero", "block:tabs"]],
            ],
            "the Canvas sidebar's navigator holds every item, under its shelf, in Canvas order",
          );
          assert.equal(navigator().selectedKey, "block:hero");

          // Picking a block in the navigator selects it without the canvas source.
          globals.CanvasNavigate = (options) => {
            navigations.push(options);
          };
          await render();
          await React.act(async () => navigator().onShowItem("block:tabs"));
          assert.deepEqual(navigations.splice(0), [{ to: "/camox/blocks/tabs" }]);
          globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/camox/blocks/tabs" };
          await render();
          assert.equal(cameraRow.selected, "block:tabs", "the camera flies to the picked block");
          assert.equal(navigator().selectedKey, "block:tabs");
          assert.equal(shown("Canvas").block, "tabs");

          // Picking the selected item again has nothing to select, but still flies to it.
          await React.act(async () => navigator().onShowItem("block:tabs"));
          assert.deepEqual(navigations, []);
          assert.deepEqual(flights, ["block:tabs"]);
          flights.length = 0;

          // Picking a Page in the Canvas sidebar's list of placements selects it the same way.
          globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/contact" };
          await render();
          const contact = [...headers.keys()][1]!;
          assert.equal(cameraRow.selected, contact, "the camera flies to the Page");
          assert.equal(shown("Canvas").page, contact, "the Canvas sidebar shows the Page again");
          assert.equal(shown("Canvas").block, undefined);

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
          globals.CanvasBlocks = [];
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
        const slots: { pageId?: string; hidden?: boolean }[] = [];
        Object.assign(globalThis, {
          CanvasPreviewSlotProbe: (props: { pageId?: string; hidden?: boolean }) =>
            slots.push(props),
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
          assert.equal(slots.at(-1)?.hidden, false);

          // The Preview's frame isn't inside its shelf, so collapsing the shelf hides it.
          const marker = () =>
            host.querySelector(
              '[data-canvas-shelf-marker="shelf:pages"]',
            ) as unknown as HTMLElement;
          await React.act(async () => marker().click());
          assert.equal(slots.at(-1)?.hidden, true, "collapsing its shelf hides the frame");
          await React.act(async () => marker().click());
          assert.equal(slots.at(-1)?.hidden, false, "expanding shows it again");
          keptInView.length = 0;

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
          "the Canvas sidebar shows the Canvas",
        );
        assert.equal(sidebars.get("Canvas")!.catalog, undefined);
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
      "zooming out of a selection goes to the Canvas route, and the Canvas sidebar follows",
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
            "the Canvas sidebar switches to the Canvas at once",
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
    await t.test("a failing block frame stays in its own slot", async () => {
      scenario = "";
      includeNewPage = false;
      const block = (id: string, title: string) => ({
        _internal: { id, title, description: "", layoutOnly: false },
      });
      globals.CanvasBlocks = [block("faq", "FAQ"), block("hero", "Hero")];
      globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
      failingBlock = "faq";
      Object.assign(globalThis, globals);
      const host = dom.document.createElement("div");
      dom.document.body.append(host);
      const root = createRoot(host as unknown as HTMLElement, { onCaughtError: () => {} });
      const errors: Error[] = [];
      try {
        await React.act(async () =>
          root.render(
            <PreviewPreparationContext value={{ ready: () => {}, fail: (e) => errors.push(e) }}>
              <CamoxCanvas runtimeBasePath="" />
            </PreviewPreparationContext>,
          ),
        );
        const slot = (key: string) => host.querySelector(`[data-canvas-slot="${key}"]`)!;
        assert.match(slot("block:faq").textContent, /This block could not be rendered/);
        assert.match(slot("block:hero").textContent, /Block hero/, "other blocks still render");
        assert.equal(
          host.querySelectorAll("[data-canvas-pathname]").length,
          2,
          "Pages still render",
        );
        assert.deepEqual(errors, [], "a block failure does not fail the Canvas preparation");

        failingBlock = undefined;
        const retry = slot("block:faq").querySelector("button") as unknown as HTMLElement;
        await React.act(async () => retry.click());
        assert.match(slot("block:faq").textContent, /Block faq/, "the block can be retried");
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
        failingBlock = undefined;
        globals.CanvasBlocks = [];
        Object.assign(globalThis, globals);
      }
    });
    await t.test("narrower devices center their frames in shaded areas", async () => {
      scenario = "";
      includeNewPage = false;
      globals.CanvasBlocks = [{ _internal: { id: "hero", title: "Hero", layoutOnly: false } }];
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
        [...host.querySelectorAll("[data-canvas-page], [data-canvas-block]")].map(
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
          assert.equal(slots().length, 3, "Pages and blocks all have an area");
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
        globals.CanvasBlocks = [];
        Object.assign(globalThis, globals);
      }
    });
    await t.test("clicking a Shelf Marker collapses and expands its area", async () => {
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
      const marker = () =>
        host.querySelector('[data-canvas-shelf-marker="shelf:pages"]') as unknown as HTMLElement;
      const toggle = () => React.act(async () => marker().click());
      try {
        await render();
        assert.equal(marker().getAttribute("aria-expanded"), "true");
        const expandedWidth = cameraWidth;
        const frame = host.querySelector('[data-canvas-pathname="/about"]');
        await toggle();
        assert.equal(marker().getAttribute("aria-expanded"), "false");
        assert.deepEqual(
          keptInView.splice(0),
          [[0, CANVAS_SHELF_MARKER_OVERHANG]],
          "the collapsed bar takes the place of the marker's visible start",
        );
        assert.equal(host.querySelectorAll("[data-canvas-header]").length, 0, "headers hide");
        assert.deepEqual(snapTargets, [], "hidden Pages are not snap targets");
        assert.equal(
          host.querySelector('[data-canvas-pathname="/about"]'),
          frame,
          "hidden Pages stay mounted",
        );
        assert.ok(frame!.closest('[data-canvas-shelf="shelf:pages"]')!.hasAttribute("inert"));
        assert.ok(cameraWidth! < expandedWidth!, "the Canvas bounds leave out hidden Pages");
        await toggle();
        assert.equal(marker().getAttribute("aria-expanded"), "true");
        assert.equal(cameraWidth, expandedWidth);
        assert.deepEqual(keptInView, [], "expanding does not pan");
        assert.equal(host.querySelectorAll("[data-canvas-header]").length, 2);
        assert.equal(host.querySelector('[data-canvas-pathname="/about"]'), frame);
        assert.ok(!frame!.closest('[data-canvas-shelf="shelf:pages"]')!.hasAttribute("inert"));

        await toggle();
        globals.CanvasLocation.pathname = "/contact";
        await render();
        assert.equal(
          marker().getAttribute("aria-expanded"),
          "true",
          "selecting a hidden Page from outside the Canvas reveals it",
        );
        assert.equal(cameraRow.selected, [...headers.keys()][1], "and flies to it");
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
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
