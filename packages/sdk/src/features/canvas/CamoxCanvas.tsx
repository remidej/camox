import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import type { Block } from "../../core/createBlock";
import { useAuthContext, useProjectSlug } from "../../lib/auth";
import {
  blockQueries,
  layoutQueries,
  pageMutations,
  pageQueries,
  projectQueries,
} from "../../lib/queries";
import { NavigationProvider, useLocation, useNavigate } from "../navigation/navigation";
import { PageStatusBadge } from "../preview/components/PageStatusBadge";
import { CuratedBlockShortcuts } from "../preview/components/PreviewPanel";
import { PageRecordContext } from "../preview/pageRecord";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import { PreviewPreparationContext } from "../preview/previewPreparation";
import { previewStore, selectIsCommentMode, type EditingOwner } from "../preview/previewStore";
import { getPageRecord } from "../preview/publication";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { runtimePath } from "../runtime/navigationTarget";
import { blockCatalogPath, matchBlockCatalogPath, STUDIO_CANVAS_PATH } from "../studio/routes";
import { CanvasBlockFrame } from "./CanvasBlockFrame";
import { CanvasBlockHeader } from "./CanvasBlockHeader";
import { CANVAS_HEADER_HEIGHT, type CanvasInsets } from "./canvasCamera";
import { CanvasPageCommentIndicators } from "./CanvasCommentIndicators";
import {
  CANVAS_ITEM_GAP,
  CANVAS_SHELF_GAP,
  CANVAS_SLOT_WIDTH,
  canvasBlockKey,
  canvasSnapTargets,
  getBlockCatalog,
  getCanvasShelves,
  isCanvasBlock,
  isCanvasShelfShown,
  positionCanvasShelves,
} from "./canvasItems";
import { CanvasLeftSidebar } from "./CanvasLeftSidebar";
import { CanvasPageFrame } from "./CanvasPageFrame";
import { CanvasPageHeader } from "./CanvasPageHeader";
import { CANVAS_DEVICES, canvasPageQuery, getCanvasPages, type CanvasPage } from "./canvasPages";
import { CanvasRightSidebar } from "./CanvasRightSidebar";
import {
  CANVAS_WORLD_TRANSFORM,
  canvasScreenLength,
  canvasScreenAbove,
  canvasScreenX,
} from "./canvasScreenSpace";
import { selectedCanvasPage } from "./canvasSelection";
import { CANVAS_SHELF_MARKER_OVERHANG, CanvasShelfMarkers } from "./CanvasShelfMarker";
import { CanvasWorkspaceContext } from "./canvasZoom";
import { useCanvasCamera } from "./useCanvasCamera";
import { useCanvasNearness } from "./useCanvasNearness";

type CanvasViewport = { width: number; height: number };

/** The sidebars overlay the Canvas at each side while an item is selected. */
const CANVAS_SIDEBAR_INSETS: CanvasInsets = { left: CMS_SIDEBAR_WIDTH, right: CMS_SIDEBAR_WIDTH };
/** How the sidebars, and Canvas overlays making room for them, slide in and out. */
const SIDEBAR_SLIDE = "duration-300 ease-out motion-reduce:transition-none";

function usePreparationFailure(error: Error | null, selected = true) {
  const preparation = React.useContext(PreviewPreparationContext);
  React.useEffect(() => {
    if (error && selected) preparation?.fail(error);
  }, [error, selected, preparation]);
}

function PreparationFailure({ error, selected }: { error: Error; selected: boolean }) {
  usePreparationFailure(error, selected);
  return null;
}

function CanvasMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground grid min-h-64 place-items-center p-8 text-center text-sm">
      {children}
    </div>
  );
}

/** A per-card error boundary, so a failing frame never takes the Canvas down. */
class CanvasFrameBoundary extends React.Component<
  { children: React.ReactNode; subject: "page" | "block"; selected?: boolean },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <CanvasMessage>
        <PreparationFailure error={this.state.error} selected={this.props.selected ?? false} />
        <div role="alert">
          <p>This {this.props.subject} could not be rendered.</p>
          <p className="mt-2">{this.state.error.message}</p>
          <button className="mt-4 underline" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </CanvasMessage>
    );
  }
}

type CanvasPagePreviewProps = {
  pathname: string;
  runtimeBasePath: string;
  derivedLayoutId?: string;
  pageId?: number;
  viewport: CanvasViewport;
  selected: boolean;
  hovered: boolean;
  onActivate: (owner: EditingOwner, source: "selection" | "interaction") => void;
};

/**
 * A Page loads its frame once it first comes near the Canvas viewport, and the
 * selected Page right away, wherever the camera is. The frame then stays
 * mounted, but only the selected Page's stays live away from the camera.
 */
function CanvasPagePreview(props: CanvasPagePreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { near, reached } = useCanvasNearness(ref);
  // Once loaded, even only for being selected, a frame stays.
  const [loaded, setLoaded] = React.useState(false);
  if ((reached || props.selected) && !loaded) setLoaded(true);
  return (
    <div ref={ref} style={{ minHeight: props.viewport.height }}>
      {loaded && <CanvasPageFrameLoader {...props} active={near || props.selected} />}
    </div>
  );
}

function CanvasPageFrameLoader({
  pathname,
  runtimeBasePath,
  derivedLayoutId,
  pageId,
  viewport,
  selected,
  hovered,
  active,
  onActivate,
}: CanvasPagePreviewProps & { active: boolean }) {
  const projectSlug = useProjectSlug();
  const { data, error, isPending, isFetching, refetch } = useQuery({
    ...canvasPageQuery(projectSlug, runtimeBasePath, pathname, derivedLayoutId),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  usePreparationFailure(isFetching ? null : error, selected);
  if (isPending)
    return (
      <CanvasMessage>
        <span role="status">Loading page…</span>
      </CanvasMessage>
    );
  if (error) {
    return (
      <CanvasMessage>
        <div role="alert">
          <p>{error.message}</p>
          <button className="mt-4 underline" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      </CanvasMessage>
    );
  }
  return (
    <CanvasPageFrame
      input={data}
      width={viewport.width}
      viewportHeight={viewport.height}
      pageId={pageId}
      selected={selected}
      hovered={hovered}
      active={active}
      onActivate={onActivate}
    />
  );
}

/** A frame header above an item's slot, at a constant on-screen height. */
function CanvasHeaderSlot({
  itemKey,
  left,
  children,
}: {
  itemKey: string;
  left: number;
  children: React.ReactNode;
}) {
  return (
    <div
      data-canvas-header={itemKey}
      className="@container/canvas-header absolute top-0 left-0 pb-3"
      style={{
        height: CANVAS_HEADER_HEIGHT,
        transform: `translate(${canvasScreenX(left)}, ${canvasScreenAbove(CANVAS_HEADER_HEIGHT)})`,
        width: canvasScreenLength(CANVAS_SLOT_WIDTH),
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
}

/** A block header with the number of Pages placing the block. */
function CanvasBlockUsageHeader({
  projectId,
  block,
  onSelect,
}: {
  projectId: number;
  block: Block;
  onSelect: () => void;
}) {
  const pages = useQuery(blockQueries.getPagesUsing(projectId, block._internal.id));
  return <CanvasBlockHeader block={block} pageCount={pages.data?.length} onSelect={onSelect} />;
}

type CanvasPageStatus = Pick<
  React.ComponentProps<typeof PageStatusBadge>,
  "status" | "modifiedReason"
>;

function CanvasWorkspace({
  projectId,
  pages,
  blocks,
  statuses,
  selectedPage,
  selectedBlock,
  intendedItemKey,
  leftSidebarOpen,
  runtimeBasePath,
  viewport,
  onActivate,
  onSelectionIntent,
}: {
  projectId: number;
  pages: CanvasPage[];
  blocks: Block[];
  statuses: Map<string, CanvasPageStatus>;
  selectedPage: CanvasPage | undefined;
  selectedBlock: Block | undefined;
  /** The key of the item the Canvas is selecting, even before its location commits. */
  intendedItemKey: string | undefined;
  leftSidebarOpen: boolean;
  runtimeBasePath: string;
  viewport: CanvasViewport;
  onActivate: (pathname: string, owner: EditingOwner) => void;
  onSelectionIntent: (pathname: string) => void;
}) {
  const { apiUrl, projectSlug, environmentName } = useAuthContext();
  const queryClient = useQueryClient();
  const updatePage = useMutation(pageMutations.update());
  const renamePage = async (pageId: number, nickname: string) => {
    const page = await queryClient.fetchQuery(pageQueries.getById(pageId));
    await updatePage.mutateAsync({
      id: pageId,
      nickname,
      pathSegment: page.pathSegment,
      parentPageId: page.parentPageId,
    });
  };
  const location = useLocation();
  const navigate = useNavigate();
  const [hoveredPageKey, setHoveredPageKey] = React.useState<string | null>(null);
  const selectedPath = location.pathname;
  const selectPage = (pathname: string) => {
    onSelectionIntent(pathname);
    cancelFlight();
    void navigate({ to: `${pathname}${location.search}${location.hash}`, source: "canvas" });
  };
  const selectBlock = (block: Block) => selectPage(blockCatalogPath(block._internal.id));
  const workspaceKey = JSON.stringify([
    apiUrl,
    projectSlug,
    environmentName ?? "production",
    runtimeBasePath,
  ]);
  // Keep other derived layout previews visible; selection itself is always read from the URL.
  const [previewPathnames, setPreviewPathnames] = React.useState<Partial<Record<string, string>>>(
    {},
  );
  const [collapsedShelves, setCollapsedShelves] = React.useState<ReadonlySet<string>>(new Set());
  const toggleShelf = (key: string) => {
    setCollapsedShelves((collapsed) => {
      const next = new Set(collapsed);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const shelves = getCanvasShelves(pages, blocks);
  const { items, markers } = positionCanvasShelves(shelves, collapsedShelves);
  // Collapsing only hides items: the Canvas keeps its expanded bounds, so the camera stays put.
  const { width } = positionCanvasShelves(shelves);
  const positions = new Map(items.map((item) => [item.key, item.left]));
  const blocksByKey = new Map(items.filter(isCanvasBlock).map((item) => [item.key, item.block]));
  // Each Page, keyed like its item, with the pathname its frame previews and
  // its place in the row; Pages of collapsed shelves have none.
  const pageSlots = new Map(
    pages.map((page) => [
      page.key,
      {
        page,
        left: positions.get(page.key),
        pathname:
          page.key === selectedPage?.key
            ? selectedPath
            : (previewPathnames[page.key] ?? page.pathname),
      },
    ]),
  );
  // The selected Page or block, keyed like its item.
  const selectedItemKey =
    selectedPage?.key ?? (selectedBlock && canvasBlockKey(selectedBlock._internal.id));
  const selectedKey = selectedItemKey && positions.has(selectedItemKey) ? selectedItemKey : null;
  const hiddenSelectedShelf = shelves.find(
    (shelf) =>
      collapsedShelves.has(shelf.key) && shelf.items.some(({ key }) => key === selectedItemKey),
  )?.key;
  const snapTargets = canvasSnapTargets(items);
  const { viewportRef, contentRef, flyTo, cancelFlight, zoomAt, keepInView } = useCanvasCamera(
    workspaceKey,
    snapTargets.find(({ key }) => key === selectedKey),
    {
      targets: snapTargets,
      width,
      onSelect: (key) => {
        const block = blocksByKey.get(key);
        if (block) return selectBlock(block);
        const pathname = pageSlots.get(key)?.pathname;
        if (pathname) selectPage(pathname);
      },
      selected: intendedItemKey && positions.has(intendedItemKey) ? intendedItemKey : null,
      onDeselect: () => selectPage(STUDIO_CANVAS_PATH),
      insets: CANVAS_SIDEBAR_INSETS,
    },
  );
  // A collapsing marker's area may start off-screen. Its vertical bar should take
  // the place of the marker's visible part, so pan before the collapse paints.
  const collapsingShelf = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const marker = markers.find(({ key }) => key === collapsingShelf.current);
    collapsingShelf.current = null;
    if (!marker) return;
    const sidebarLeft = leftSidebarOpen ? CANVAS_SIDEBAR_INSETS.left : 0;
    keepInView(marker.start, sidebarLeft + CANVAS_SHELF_MARKER_OVERHANG);
  });
  const instructionsId = React.useId();
  const previousPath = React.useRef(selectedPath);
  React.useEffect(() => {
    if (previousPath.current === selectedPath) return;
    // Selecting a hidden Page from outside the Canvas reveals it; the flight follows.
    if (location.source !== "canvas" && hiddenSelectedShelf) {
      toggleShelf(hiddenSelectedShelf);
      return;
    }
    // A newly created page can arrive in the route before the page list refresh.
    if (location.source !== "canvas" && !selectedKey) return;
    previousPath.current = selectedPath;
    if (location.source === "canvas" || !selectedKey) return;
    flyTo(selectedKey);
  }, [selectedPath, location.source, selectedKey, hiddenSelectedShelf, flyTo]);

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="Page canvas"
      aria-describedby={instructionsId}
      tabIndex={0}
      data-camox-canvas
      // While Space arms the hand tool, the whole canvas (page frames and their
      // controls included) shows the hand and hands the drag to the camera.
      className="bg-muted relative isolate min-h-0 min-w-0 flex-1 touch-none overflow-clip outline-none data-[canvas-pan]:cursor-grab data-[canvas-pan]:**:cursor-[inherit]! data-[canvas-pan=dragging]:cursor-grabbing data-[canvas-pan]:[&_iframe]:pointer-events-none"
      style={{
        userSelect: "none",
        overscrollBehavior: "none",
      }}
    >
      <CanvasWorkspaceContext value={{ workspaceKey, zoomAt }}>
        <div
          ref={contentRef}
          data-canvas-items
          className="absolute top-0 left-0 flex w-max items-start"
          style={{
            gap: CANVAS_SHELF_GAP,
            transform: CANVAS_WORLD_TRANSFORM,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {shelves.map((shelf) => {
            // An empty shelf that isn't shown has no marker and no place in the row.
            if (!isCanvasShelfShown(shelf)) return null;
            const collapsed = collapsedShelves.has(shelf.key) || shelf.items.length === 0;
            return (
              // A collapsed or empty shelf shrinks to a zero-width slot under its marker.
              // Its items stay mounted in place, so expanding never reloads them, and
              // keep their height, so the Canvas bounds and camera don't move.
              <div
                key={shelf.key}
                data-canvas-shelf={shelf.key}
                inert={collapsed}
                className={`flex shrink-0 items-start ${collapsed ? "invisible w-0" : ""}`}
                style={{ gap: CANVAS_ITEM_GAP }}
              >
                {shelf.items.map((item) => {
                  if (item.kind === "block") {
                    return (
                      <div
                        key={item.key}
                        data-canvas-slot={item.key}
                        className="flex shrink-0 justify-start"
                        style={{ width: CANVAS_SLOT_WIDTH }}
                      >
                        <div
                          data-canvas-block={item.block._internal.id}
                          className="bg-background shrink-0 shadow-xl ring-1 ring-black/10"
                          style={{ width: viewport.width }}
                        >
                          <CanvasFrameBoundary subject="block">
                            <CanvasBlockFrame
                              block={item.block}
                              projectId={projectId}
                              runtimeBasePath={runtimeBasePath}
                              width={viewport.width}
                              viewportHeight={viewport.height}
                              onSelect={() => selectBlock(item.block)}
                            />
                          </CanvasFrameBoundary>
                        </div>
                      </div>
                    );
                  }
                  const slot = pageSlots.get(item.key);
                  if (!slot) return null;
                  const { page, pathname } = slot;
                  return (
                    <div
                      key={page.key}
                      data-canvas-slot={page.key}
                      className="flex shrink-0 justify-start"
                      style={{ width: CANVAS_SLOT_WIDTH }}
                    >
                      <div
                        data-canvas-page={page.key}
                        data-canvas-pathname={pathname}
                        className="bg-background shrink-0 shadow-xl ring-1 ring-black/10"
                        style={{ width: viewport.width, minHeight: viewport.height }}
                      >
                        <CanvasFrameBoundary
                          key={pathname}
                          subject="page"
                          selected={page.key === selectedPage?.key}
                        >
                          {pathname ? (
                            <CanvasPagePreview
                              hovered={hoveredPageKey === page.key}
                              pathname={pathname}
                              runtimeBasePath={runtimeBasePath}
                              derivedLayoutId={page.derivedLayoutId}
                              pageId={page.pageId}
                              viewport={viewport}
                              selected={page.key === selectedPage?.key}
                              onActivate={(owner, source) => {
                                onActivate(pathname, owner);
                                if (source === "interaction") selectPage(pathname);
                              }}
                            />
                          ) : (
                            <CanvasMessage>
                              Choose a page path above to preview this layout.
                            </CanvasMessage>
                          )}
                        </CanvasFrameBoundary>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </CanvasWorkspaceContext>
      <CanvasShelfMarkers
        markers={markers}
        onToggle={(marker) => {
          if (!marker.collapsed) collapsingShelf.current = marker.key;
          toggleShelf(marker.key);
        }}
      />
      {[...pageSlots.values()].map(({ page, pathname, left }) =>
        left === undefined ? null : (
          <CanvasHeaderSlot key={page.key} itemKey={page.key} left={left}>
            <CanvasPageHeader
              page={page}
              pathname={pathname}
              onRename={
                page.pageId != null ? (nickname) => renamePage(page.pageId!, nickname) : undefined
              }
              status={
                statuses.has(page.key) ? (
                  <PageStatusBadge size="sm" {...statuses.get(page.key)!} />
                ) : null
              }
              comments={
                page.pageId != null && pathname ? (
                  <CanvasPageCommentIndicators
                    pageId={page.pageId}
                    targets={[]}
                    placement="header"
                    activate={() => {
                      previewStore.send({ type: "activatePage", pageId: page.pageId! });
                      onActivate(pathname, { kind: "page", pageId: page.pageId! });
                      selectPage(pathname);
                    }}
                  />
                ) : null
              }
              selected={page.key === selectedPage?.key}
              onHoverChange={(hovered) => setHoveredPageKey(hovered ? page.key : null)}
              onSelect={(commenting) => {
                if (!pathname) return;
                // Keep the clicked page's ownership through URL navigation, just
                // like an interaction inside its frame.
                if (commenting && page.pageId != null) {
                  onActivate(pathname, { kind: "page", pageId: page.pageId });
                }
                selectPage(pathname);
              }}
              onChange={(path) => {
                setPreviewPathnames((current) => ({ ...current, [page.key]: path }));
                selectPage(path);
              }}
            />
          </CanvasHeaderSlot>
        ),
      )}
      {items.filter(isCanvasBlock).map(({ key, left, block }) => (
        <CanvasHeaderSlot key={key} itemKey={key} left={left}>
          <CanvasBlockUsageHeader
            projectId={projectId}
            block={block}
            onSelect={() => selectBlock(block)}
          />
        </CanvasHeaderSlot>
      ))}
      {!pages.length && <CanvasMessage>No pages to preview yet.</CanvasMessage>}
      <p id={instructionsId} className="sr-only">
        Scroll, or hold Space and drag, to pan. Pinch or Ctrl/⌘ + scroll to zoom. Click a page to
        edit it. Focus the canvas and use plus or minus to zoom, arrow keys to pan, 0 for 100%, or
        Home / Shift+1 to fit all pages.
      </p>
    </div>
  );
}

/**
 * A sidebar overlaid on one side of the Canvas, which keeps its full size. It
 * slides out of view on its own side when closed.
 */
function CanvasSidebarPanel({
  side,
  open,
  onClosed,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  onClosed: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-canvas-sidebar={side}
      data-state={open ? "open" : "closed"}
      inert={!open}
      className={`bg-background absolute inset-y-0 z-10 flex transition-transform ${SIDEBAR_SLIDE} ${side === "left" ? "left-0 data-[state=closed]:-translate-x-full" : "right-0 data-[state=closed]:translate-x-full"}`}
      style={{ width: CMS_SIDEBAR_WIDTH }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) onClosed();
      }}
    >
      {children}
    </div>
  );
}

/** Each derived layout's first discovered page, keyed by layout id. */
function useDiscoveredPreviewPaths(runtimeBasePath: string) {
  const projectSlug = useProjectSlug();
  const layouts = useCamoxApp()
    .getLayouts()
    .filter((layout) => layout._internal.kind === "derived" && layout._internal.routes);
  return useQueries({
    queries: layouts.map(({ _internal: { id } }) => ({
      queryKey: ["camox", "canvas", "routes", projectSlug, runtimeBasePath, id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const url = new URL(runtimePath("/_camox/routes", runtimeBasePath), window.location.origin);
        url.searchParams.set("layoutId", id);
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
        if (!response.ok) throw new Error(`Could not discover pages of ${id}.`);
        return [id, ((await response.json()) as { path: string | null }).path] as const;
      },
      staleTime: Infinity,
      retry: false,
    })),
    // Without a discovered page, the frame asks for a path, as it does without routes.
    combine: (results) =>
      new Map(results.flatMap(({ data }) => (data?.[1] ? [[data[0], data[1]] as const] : []))),
  });
}

export function CamoxCanvas({ runtimeBasePath }: { runtimeBasePath: string }) {
  const app = useCamoxApp();
  const location = useLocation();
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);
  const viewport = CANVAS_DEVICES[viewportMode === "full" ? "desktop" : viewportMode];
  const [activeFrame, setActiveFrame] = React.useState<{
    pathname: string;
    owner: EditingOwner;
  } | null>(null);
  const selectedPath = location.pathname;
  const previousPath = React.useRef(selectedPath);
  React.useLayoutEffect(() => {
    if (previousPath.current === selectedPath) return;
    previousPath.current = selectedPath;
    if (!activeFrame || activeFrame.pathname === selectedPath) return;
    previewStore.send({ type: "clearSelection" });
    previewStore.send({ type: "setIframeElement", element: null });
    setActiveFrame(null);
  }, [activeFrame, selectedPath]);
  React.useEffect(() => {
    previewStore.send({ type: "clearSelection" });
    return () => {
      previewStore.send({ type: "clearSelection" });
      // Each frame releases only its own iframe. The read-only preview may
      // already have reclaimed ownership when preparation is cancelled.
    };
  }, []);
  const projectSlug = useProjectSlug();
  const project = useQuery(projectQueries.getBySlug(projectSlug));
  const pages = useQuery({
    ...pageQueries.list(project.data?.id ?? 0),
    enabled: !!project.data,
  });
  const layouts = useQuery({
    ...layoutQueries.list(project.data?.id ?? 0),
    enabled: !!project.data,
  });
  const discoveredPaths = useDiscoveredPreviewPaths(runtimeBasePath);
  const canvasPages = pages.data
    ? getCanvasPages(pages.data, app.getLayouts(), discoveredPaths)
    : [];
  const pageById = new Map(pages.data?.map((page) => [page.id, page]));
  const layoutStatusById = new Map(layouts.data?.map((layout) => [layout.layoutId, layout.status]));
  const statuses = new Map<string, CanvasPageStatus>();
  for (const page of canvasPages) {
    const record = page.pageId != null ? pageById.get(page.pageId) : undefined;
    if (record) {
      statuses.set(page.key, { status: record.status, modifiedReason: record.modifiedReason });
      continue;
    }
    const status = page.layoutId && layoutStatusById.get(page.layoutId);
    if (status) statuses.set(page.key, { status });
  }
  // The Page or block of the Block Catalog a pathname selects, if any.
  const selectionAt = (pathname: string) => {
    if (pathname === STUDIO_CANVAS_PATH) return {};
    const blockId = matchBlockCatalogPath(pathname);
    if (!blockId) return { page: selectedCanvasPage(canvasPages, app.getLayouts(), pathname) };
    const block = app.getBlockById(blockId);
    return { block: block && !block._internal.layoutOnly ? block : undefined };
  };
  const { page: selectedPage, block: selectedBlock } = selectionAt(location.pathname);
  // A Canvas selection commits once its route payload loads. Until then, the
  // sidebars and the camera already follow it, so they move as the camera snaps.
  const [intent, setIntent] = React.useState<{ from: string; to: typeof location } | null>(null);
  const intended = intent?.from === location.pathname ? intent.to : location;
  const intendedSelection = selectionAt(intended.pathname);
  const sidebarsOpen = !!(intendedSelection.page || intendedSelection.block);
  // The sidebars keep showing the last selection while they slide out of view.
  const [sidebarLocation, setSidebarLocation] = React.useState(location);
  if (sidebarsOpen && sidebarLocation !== intended) setSidebarLocation(intended);
  const navigate = useNavigate();
  const shown = sidebarsOpen ? intendedSelection : selectionAt(sidebarLocation.pathname);
  // Feedback stays at hand: while commenting, the right sidebar keeps the last selection.
  const rightSidebarOpen = sidebarsOpen || (isCommentMode && !!(shown.page || shown.block));
  // The shown frame's data names a record page's record. Its frame loads it; only read here.
  const { data: shownFrameInput } = useQuery({
    ...canvasPageQuery(
      projectSlug,
      runtimeBasePath,
      sidebarsOpen ? intended.pathname : sidebarLocation.pathname,
      shown.page?.derivedLayoutId,
    ),
    enabled: false,
  });
  const shownRecordResult = shown.page?.derivedLayoutId
    ? shownFrameInput?.derived?.result
    : undefined;
  const pageRecord = getPageRecord(shownRecordResult);
  usePreparationFailure(
    (!project.isFetching ? project.error : null) ?? (!pages.isFetching ? pages.error : null),
  );
  const preparation = React.useContext(PreviewPreparationContext);
  React.useEffect(() => {
    if (project.isPending || pages.isPending || project.error || pages.error) return;
    // Without a selected Page, no frame needs to load first: the Canvas is ready once laid out.
    if (selectedBlock || location.pathname === STUDIO_CANVAS_PATH) {
      preparation?.ready();
      return;
    }
    if (selectedPage) return;
    preparation?.fail(new Error(`No canvas page matches ${location.pathname}.`));
  }, [
    project.isPending,
    pages.isPending,
    project.error,
    pages.error,
    selectedPage,
    selectedBlock,
    location.pathname,
    preparation,
  ]);
  if (project.error || pages.error) {
    return (
      <CanvasMessage>
        <div role="alert">
          <p>Could not load the site’s pages.</p>
          <button
            className="mt-4 underline"
            onClick={() => {
              if (project.error) void project.refetch();
              else void pages.refetch();
            }}
          >
            Try again
          </button>
        </div>
      </CanvasMessage>
    );
  }
  if (project.isPending || pages.isPending)
    return (
      <CanvasMessage>
        <span role="status">Loading canvas…</span>
      </CanvasMessage>
    );
  const editingOwner =
    sidebarsOpen && activeFrame?.pathname === intended.pathname ? activeFrame.owner : null;
  const blockCatalog = getBlockCatalog(app.getBlocks());
  return (
    <div
      className={`relative flex min-h-0 flex-1 overflow-hidden transition-[--canvas-sidebar-left] ${SIDEBAR_SLIDE}`}
      style={
        {
          "--canvas-sidebar-left": `${sidebarsOpen ? CANVAS_SIDEBAR_INSETS.left : 0}px`,
        } as React.CSSProperties
      }
    >
      {selectedPage?.pageId != null && !isCommentMode && <CuratedBlockShortcuts />}
      <CanvasWorkspace
        key={project.data.id}
        projectId={project.data.id}
        pages={canvasPages}
        blocks={blockCatalog}
        statuses={statuses}
        selectedPage={selectedPage}
        selectedBlock={selectedBlock}
        leftSidebarOpen={sidebarsOpen}
        intendedItemKey={
          intendedSelection.page?.key ??
          (intendedSelection.block && canvasBlockKey(intendedSelection.block._internal.id))
        }
        runtimeBasePath={runtimeBasePath}
        viewport={viewport}
        onActivate={(pathname, owner) => setActiveFrame({ pathname, owner })}
        onSelectionIntent={(pathname) =>
          setIntent({
            from: location.pathname,
            to: {
              ...location,
              pathname,
              href: new URL(`${pathname}${location.search}${location.hash}`, window.location.href)
                .href,
            },
          })
        }
      />
      {/* Sliding out, the sidebars still show their selection's location, not the current one. */}
      <NavigationProvider location={sidebarLocation} navigate={navigate}>
        <CanvasSidebarPanel
          side="left"
          open={sidebarsOpen}
          onClosed={() => {
            if (!rightSidebarOpen) setSidebarLocation(intended);
          }}
        >
          <CanvasLeftSidebar
            page={shown.page}
            catalog={shown.block && { block: shown.block, blocks: blockCatalog }}
            owner={editingOwner}
            pageRecord={pageRecord}
          />
        </CanvasSidebarPanel>
        <CanvasSidebarPanel
          side="right"
          open={rightSidebarOpen}
          onClosed={() => setSidebarLocation(intended)}
        >
          {/* The record page's record, which its sidebar edits. */}
          <PageRecordContext value={shownRecordResult}>
            <CanvasRightSidebar
              page={shown.page}
              catalog={shown.block && { block: shown.block, projectId: project.data.id }}
              owner={editingOwner}
            />
          </PageRecordContext>
        </CanvasSidebarPanel>
      </NavigationProvider>
    </div>
  );
}
