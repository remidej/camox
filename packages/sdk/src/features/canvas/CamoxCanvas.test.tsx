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
      source = `export const useQuery = (options) => globalThis.CanvasQueryProbe(options);
        export const useMutation = () => ({});
        export const useQueryClient = () => ({});`;
    if (specifier.endsWith("/auth"))
      source = `export const useProjectSlug = () => "site";
        export const useAuthContext = () => ({apiUrl: "", projectSlug: "site"});`;
    if (specifier.endsWith("/queries"))
      source = `export const projectQueries = {getBySlug: () => ({queryKey: ["project"]})};
        export const pageMutations = {update: () => ({})};
        export const pageQueries = {list: () => ({queryKey: ["pages"]})};
        export const layoutQueries = {list: () => ({queryKey: ["layouts"]})};
        export const blockQueries = {getPagesUsing: (_, type) => ({queryKey: ["blockPages", type]})};`;
    if (specifier.endsWith("/navigation"))
      source = `export const useLocation = () => globalThis.CanvasLocation;
        export const useNavigate = () => globalThis.CanvasNavigate;`;
    if (specifier.endsWith("/CamoxAppContext"))
      source =
        "export const useCamoxApp = () => ({getLayouts: () => [], getBlocks: () => globalThis.CanvasBlocks, getBlockById: (id) => globalThis.CanvasBlocks.find((block) => block._internal.id === id)})";
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
    if (specifier.endsWith("/CanvasBlockFrame"))
      source = "export const CanvasBlockFrame = (props) => globalThis.CanvasBlockFrameProbe(props)";
    if (specifier.endsWith("/FieldToolbar")) source = "export const FieldToolbar = () => null";
    for (const side of ["Left", "Right"]) {
      if (specifier.endsWith(`/Canvas${side}Sidebar`))
        source = `export const Canvas${side}Sidebar = (props) => globalThis.CanvasSidebarProbe("${side}", props)`;
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
  const frames = new Map<string, { onActivate: (owner: never, source: string) => void }>();
  const headers = new Map<string, { onSelect: () => void; onChange: (path: string) => void }>();
  let snap!: (key: string) => void;
  let snapTargets: { key: string }[] = [];
  let cameraWidth: number | undefined;
  let failingBlock: string | undefined;
  let blockPages: Record<string, { id: number }[]> = {};
  let initialTarget: { left: number } | undefined;
  const blockFrames = new Map<string, { onSelect: () => void }>();
  type SidebarProps = {
    page?: { key: string };
    catalog?: {
      block: { _internal: { id: string } };
      blocks?: { _internal: { id: string } }[];
      projectId?: number;
    };
  };
  const sidebars = new Map<string, SidebarProps>();
  const flyTo = (key: string) => flights.push(key);
  const keptInView: [number, number][] = [];
  const keepInView = (worldX: number, screenX: number) => keptInView.push([worldX, screenX]);
  const cancelFlight = () => actions.push("cancel");
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    CanvasLocation: {
      pathname: "/about",
      search: "",
      hash: "",
      source: undefined as "canvas" | undefined,
    },
    CanvasCommentMode: false,
    CanvasBlocks: [] as unknown[],
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
      _key: string,
      target: { left: number } | undefined,
      options: { onSelect: typeof snap; targets: { key: string }[]; width?: number },
    ) => {
      initialTarget = target;
      snap = options.onSelect;
      snapTargets = options.targets;
      cameraWidth = options.width;
      return { viewportRef: null, contentRef: null, flyTo, cancelFlight, keepInView };
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
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as unknown as HTMLElement);
        try {
          await React.act(async () => root.render(<CamoxCanvas runtimeBasePath="" />));
          const row = host.querySelector("[data-canvas-items]")!;
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
        assert.equal(flights.length, 0, "mount does not fly");

        for (const [select, path] of [
          [() => blockFrames.get("faq")!.onSelect(), "/camox/blocks/faq"],
          [
            () =>
              (
                host.querySelector(
                  '[data-canvas-header="block:hero"] button',
                ) as unknown as HTMLElement
              ).click(),
            "/camox/blocks/hero",
          ],
          [() => snap("block:faq"), "/camox/blocks/faq"],
          [() => snap([...headers.keys()][0]!), "/about"],
        ] as const) {
          await React.act(async () => select());
          assert.deepEqual(actions.splice(0), ["cancel", "navigate"]);
          assert.equal(globals.CanvasLocation.pathname, path);
          await render();
          assert.equal(flights.length, 0, "canvas selections do not fly");
        }

        globals.CanvasLocation = {
          pathname: "/camox/blocks/hero",
          search: "",
          hash: "",
          source: undefined,
        };
        await render();
        assert.deepEqual(flights, ["block:hero"], "back/forward to a block flies to it");
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        await render();
        assert.deepEqual(flights, ["block:hero", [...headers.keys()][0]], "and back to a Page");

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
    await t.test("a selected block switches the sidebars to the Block Catalog", async () => {
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
          blocks: catalog?.blocks?.map(({ _internal }) => _internal.id),
          projectId: catalog?.projectId,
        };
      };
      try {
        await render();
        assert.deepEqual(
          shown("Left").blocks,
          ["faq", "hero", "tabs"],
          "the left sidebar lists the Block Catalog in Canvas order",
        );
        assert.equal(shown("Left").block, "hero");
        assert.equal(shown("Left").page, undefined);
        assert.deepEqual(
          { block: shown("Right").block, projectId: shown("Right").projectId },
          { block: "hero", projectId: 1 },
          "the right sidebar shows the Pages holding the selected block's placements",
        );
        assert.equal(shown("Right").page, undefined);

        // Picking a block in the left sidebar navigates without the canvas source.
        globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/camox/blocks/tabs" };
        await render();
        assert.deepEqual(flights, ["block:tabs"], "the camera flies to the picked block");
        assert.equal(shown("Left").block, "tabs");
        assert.equal(shown("Right").block, "tabs");

        // Picking a Page in the right sidebar's list of placements selects it the same way.
        globals.CanvasLocation = { ...globals.CanvasLocation, pathname: "/contact" };
        await render();
        const contact = [...headers.keys()][1]!;
        assert.deepEqual(flights, ["block:tabs", contact], "the camera flies to the Page");
        for (const side of ["Left", "Right"]) {
          assert.equal(shown(side).page, contact, `the ${side} sidebar shows the Page again`);
          assert.equal(shown(side).block, undefined);
        }
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
        globals.CanvasBlocks = [];
        globals.CanvasLocation = { pathname: "/about", search: "", hash: "", source: undefined };
        Object.assign(globalThis, globals);
      }
    });
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
          [[0, 12]],
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
        assert.equal(cameraWidth, expandedWidth, "the Canvas keeps its expanded bounds");
        await toggle();
        assert.equal(marker().getAttribute("aria-expanded"), "true");
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
        assert.deepEqual(flights, [[...headers.keys()][1]], "and flies to it");
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
      }
    });
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
