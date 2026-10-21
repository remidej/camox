import { useMutation } from "@tanstack/react-query";
import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import type { Block } from "../../core/createBlock";
import { useAuthContext, useProjectSlug } from "../../lib/auth";
import { parseLocalePath } from "../../lib/locale-path";
import { pageMutations } from "../../lib/queries";
import { reads, useReadQuery, useStudioCache } from "../../lib/studio-reads";
import { useLocalizedPath } from "../../lib/view-locale";
import { useViewLocale } from "../../lib/view-locale-context";
import { NavigationProvider, useLocation, useNavigate } from "../navigation/navigation";
import { CuratedBlockShortcuts } from "../preview/components/PreviewPanel";
import type { ReleaseEditingFrame } from "../preview/editingFrame";
import { getPageRecord, PageRecordContext } from "../preview/pageRecord";
import {
  CANVAS_CHROME_Z_INDEX,
  PREVIEW_PAGE_SLOT_ATTRIBUTE,
  PreviewPageFrameContext,
} from "../preview/previewPageFrame";
import { PreviewPreparationContext } from "../preview/previewPreparation";
import { previewStore, type EditingOwner } from "../preview/previewStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { FollowAgentContext } from "../studio/followAgentContext";
import { blockCatalogPath, matchBlockCatalogPath, STUDIO_CANVAS_PATH } from "../studio/routes";
import { CanvasBlockFrame } from "./CanvasBlockFrame";
import { CanvasBlockHeader } from "./CanvasBlockHeader";
import { CANVAS_HEADER_HEIGHT } from "./canvasCamera";
import { useCanvasFrameMode, type CanvasFrameMode } from "./canvasFrameMode";
import {
  CANVAS_ITEM_GAP,
  CANVAS_SHELF_GAP,
  CANVAS_SLOT_WIDTH,
  canvasBlockKey,
  canvasSnapTargets,
  getBlockCatalog,
  getCanvasShelves,
  getDefaultCollapsedShelves,
  isCanvasBlock,
  isCanvasShelfShown,
  positionCanvasShelves,
} from "./canvasItems";
import { CanvasOverlaysShownContext } from "./CanvasOverlays";
import { CanvasPageEdge } from "./CanvasPageEdge";
import { CanvasPageFrame, type CanvasFrameActivate } from "./CanvasPageFrame";
import { CanvasPageHeader } from "./CanvasPageHeader";
import {
  CANVAS_DEVICES,
  canvasLayoutId,
  canvasPageId,
  derivedLayoutIdOf,
  getCanvasPages,
  type CanvasPage,
} from "./canvasPages";
import { CanvasPreviewPageSlot } from "./CanvasPreviewPageSlot";
import {
  CANVAS_WORLD_TRANSFORM,
  canvasScreenLength,
  canvasScreenAbove,
  canvasScreenX,
} from "./canvasScreenSpace";
import { selectedCanvasPage } from "./canvasSelection";
import { CANVAS_SHELF_MARKER_OVERHANG, CanvasShelfMarkers } from "./CanvasShelfMarker";
import { canvasStore, setShelfCollapsed, useCollapsedShelves } from "./canvasStore";
import { CanvasWorkspaceContext } from "./canvasZoom";
import { CanvasSidebar } from "./sidebar/CanvasSidebar";
import { useCanvasCamera } from "./useCanvasCamera";
import { useCanvasNearness } from "./useCanvasNearness";
import { useDiscoveredPreviewPaths } from "./useDiscoveredPreviewPaths";

type CanvasViewport = { width: number; height: number };

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
  pageId?: string;
  viewport: CanvasViewport;
  selected: boolean;
  hovered: boolean;
  onActivate: CanvasFrameActivate;
};

/**
 * A Page loads its frame once it first comes near the Canvas viewport, and the
 * selected Page right away, wherever the camera is. The frame then stays
 * mounted, but only runs while selected and the camera is still.
 */
function CanvasPagePreview(props: CanvasPagePreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { near, reached } = useCanvasNearness(ref);
  const mode = useCanvasFrameMode({ near, selected: props.selected });
  // Once loaded, even only for being selected, a frame stays.
  const [loaded, setLoaded] = React.useState(false);
  if ((reached || props.selected) && !loaded) setLoaded(true);
  return (
    <div
      ref={ref}
      style={{
        minHeight: props.viewport.height,
        // Away from the camera, a frame that doesn't rest yet still isn't drawn.
        visibility: near || props.selected ? undefined : "hidden",
      }}
    >
      {loaded && <CanvasPageFrameLoader {...props} mode={mode} />}
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
  mode,
  onActivate,
}: CanvasPagePreviewProps & { mode: CanvasFrameMode }) {
  const projectSlug = useProjectSlug();
  const { data, error, isPending, isFetching, refetch } = useReadQuery(
    reads.canvasFrame({ projectSlug, runtimeBasePath, pathname, derivedLayoutId }),
  );
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
      mode={mode}
      onActivate={onActivate}
    />
  );
}

// Quick to appear, slower to fade, so it reads as one pulse.
const SNAP_FLASH_KEYFRAMES: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.15 },
  { opacity: 0 },
];
const SNAP_FLASH_TIMING: KeyframeAnimationOptions = { duration: 600, easing: "ease-out" };

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
        zIndex: CANVAS_CHROME_Z_INDEX,
      }}
    >
      {children}
    </div>
  );
}

/** World-space room above and below a frame narrower than its area. */
const CANVAS_FRAMED_PADDING = 40;

/**
 * An item's area in the Canvas row, which the camera snaps to, with the item's
 * frame centered in it. A frame narrower than its area shows the area in a
 * shade of its own, with room above and below the frame.
 */
function CanvasSlot({
  itemKey,
  framed,
  children,
}: {
  itemKey: string;
  framed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-canvas-slot={itemKey}
      data-canvas-slot-shaded={framed || undefined}
      className="data-canvas-slot-shaded:bg-foreground/5 flex shrink-0 justify-center"
      style={{
        width: CANVAS_SLOT_WIDTH,
        paddingBlock: framed ? CANVAS_FRAMED_PADDING : 0,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The Page whose header the pointer is over, which outlines its frame. Kept out
 * of the Canvas's state, so hovering re-renders only the frames it outlines.
 */
function createCanvasHover() {
  return createStore({
    context: { pageKey: null as string | null },
    on: {
      set: (context, event: { pageKey: string | null }) =>
        context.pageKey === event.pageKey ? context : { pageKey: event.pageKey },
    },
  });
}
type CanvasHover = ReturnType<typeof createCanvasHover>;

/** A Block Catalog block's area in the Canvas row, with its frame. */
function CanvasBlockItem({
  itemKey,
  block,
  projectId,
  runtimeBasePath,
  viewport,
  framed,
  selected,
  selectBlock,
}: {
  itemKey: string;
  block: Block;
  projectId: number;
  runtimeBasePath: string;
  viewport: CanvasViewport;
  framed: boolean;
  selected: boolean;
  selectBlock: (block: Block) => void;
}) {
  return (
    <CanvasSlot itemKey={itemKey} framed={framed}>
      <div
        data-canvas-block={block._internal.id}
        className="bg-background relative shrink-0 shadow-xl ring-1 ring-black/10"
        style={{ width: viewport.width }}
      >
        <CanvasFrameBoundary subject="block">
          <CanvasBlockFrame
            block={block}
            projectId={projectId}
            runtimeBasePath={runtimeBasePath}
            width={viewport.width}
            viewportHeight={viewport.height}
            selected={selected}
            onSelect={() => selectBlock(block)}
          />
        </CanvasFrameBoundary>
        <CanvasPageEdge shaded={framed} />
      </div>
    </CanvasSlot>
  );
}

/** A Page's area in the Canvas row, with its frame. */
function CanvasPageItem({
  page,
  pathname,
  selected,
  previewed,
  collapsed,
  framed,
  viewport,
  runtimeBasePath,
  onActivate,
  selectPage,
  hover,
}: {
  page: CanvasPage;
  pathname: string | null;
  selected: boolean;
  previewed: boolean;
  collapsed: boolean;
  framed: boolean;
  viewport: CanvasViewport;
  runtimeBasePath: string;
  onActivate: (pathname: string, owner: EditingOwner, release: ReleaseEditingFrame) => void;
  selectPage: (pathname: string) => void;
  hover: CanvasHover;
}) {
  const hovered = useSelector(hover, (state) => state.context.pageKey === page.key);
  const onPageActivate: CanvasFrameActivate = (owner, source, release) => {
    if (!pathname) return;
    onActivate(pathname, owner, release);
    if (source === "interaction") selectPage(pathname);
  };
  return (
    <CanvasSlot itemKey={page.key} framed={framed}>
      <div
        data-canvas-page={page.key}
        data-canvas-pathname={pathname}
        {...(previewed ? { [PREVIEW_PAGE_SLOT_ATTRIBUTE]: "" } : {})}
        className="bg-background relative shrink-0 shadow-xl ring-1 ring-black/10"
        style={{ width: viewport.width, minHeight: viewport.height }}
      >
        <CanvasFrameBoundary key={pathname} subject="page" selected={selected}>
          {previewed ? (
            <CanvasPreviewPageSlot
              pageId={canvasPageId(page)}
              layoutId={canvasLayoutId(page)}
              width={viewport.width}
              viewportHeight={viewport.height}
              selected={selected}
              hovered={hovered}
              hidden={collapsed}
              shaded={framed}
              onActivate={onPageActivate}
            />
          ) : pathname ? (
            <CanvasPagePreview
              hovered={hovered}
              pathname={pathname}
              runtimeBasePath={runtimeBasePath}
              derivedLayoutId={derivedLayoutIdOf(page)}
              pageId={canvasPageId(page)}
              viewport={viewport}
              selected={selected}
              onActivate={onPageActivate}
            />
          ) : (
            <CanvasMessage>Choose a page path above to preview this layout.</CanvasMessage>
          )}
        </CanvasFrameBoundary>
        <CanvasPageEdge shaded={framed} />
      </div>
    </CanvasSlot>
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
  const pages = useReadQuery(reads.pagesUsingBlock({ projectId, type: block._internal.id }));
  return <CanvasBlockHeader block={block} pageCount={pages.data?.length} onSelect={onSelect} />;
}

/** What the Canvas offers to the Canvas sidebar beside it. */
type CanvasWorkspaceHandle = {
  /**
   * Shows an item: selects it as from outside the Canvas, so the camera flies to
   * it. A Page without a path to select, or the selected item, only gets the flight.
   */
  showItem: (key: string) => void;
  /** Leaves the selection and zooms out to the whole Canvas. */
  showWholeCanvas: () => void;
};

/** Gives a Page a new nickname, keeping its path. */
function useRenamePage() {
  const studioCache = useStudioCache();
  const updatePage = useMutation(pageMutations.update());
  return async (pageId: string, nickname: string) => {
    const page = await studioCache.ensure(reads.page({ id: pageId }));
    await updatePage.mutateAsync({
      id: pageId,
      nickname,
      pathSegment: page.pathSegment,
      parentPageId: page.parentPageId,
    });
  };
}

function CanvasWorkspace({
  ref,
  projectId,
  pages,
  blocks,
  selectedPage,
  selectedBlock,
  previewedPage,
  intendedItemKey,
  runtimeBasePath,
  viewport,
  onActivate,
  onSelectionIntent,
}: {
  projectId: number;
  pages: CanvasPage[];
  blocks: Block[];
  selectedPage: CanvasPage | undefined;
  selectedBlock: Block | undefined;
  /** The Page the Preview page frame shows: the selected one, or the last one selected. */
  previewedPage: CanvasPage | undefined;
  /** The key of the item the Canvas is selecting, even before its location commits. */
  intendedItemKey: string | undefined;
  runtimeBasePath: string;
  viewport: CanvasViewport;
  onActivate: (pathname: string, owner: EditingOwner, release: ReleaseEditingFrame) => void;
  onSelectionIntent: (pathname: string) => void;
  ref?: React.Ref<CanvasWorkspaceHandle>;
}) {
  const { apiUrl, projectSlug } = useAuthContext();
  const renamePage = useRenamePage();
  const location = useLocation();
  const navigate = useNavigate();
  const previewPageFrame = React.use(PreviewPageFrameContext);
  const localized = useLocalizedPath();
  const [hover] = React.useState(createCanvasHover);
  const selectedPath = location.pathname;
  const previewedPath = previewPageFrame?.pathname;
  const follow = React.use(FollowAgentContext);
  // The camera flies to the selected item, unless it is already snapped to it.
  const goToItem = (pathname: string) => {
    onSelectionIntent(pathname);
    void navigate({ to: `${pathname}${location.search}${location.hash}`, source: "canvas" });
  };
  // The editor selecting an item themselves stops following the agent. The Canvas's own
  // navigations, like the camera leaving a snap as a block reveals itself, don't.
  const selectPage = (pathname: string) => {
    follow?.takeOver();
    goToItem(pathname);
  };
  const selectBlock = (block: Block) => selectPage(localized(blockCatalogPath(block._internal.id)));
  // Frames get selection callbacks that keep their identity across hovers and
  // navigations, so only the frames whose own props change re-render.
  const latestSelect = React.useRef({ selectPage, selectBlock });
  React.useLayoutEffect(() => {
    latestSelect.current = { selectPage, selectBlock };
  });
  const selectFramePage = React.useCallback(
    (pathname: string) => latestSelect.current.selectPage(pathname),
    [],
  );
  const selectFrameBlock = React.useCallback(
    (block: Block) => latestSelect.current.selectBlock(block),
    [],
  );
  const workspaceKey = JSON.stringify([apiUrl, projectSlug, runtimeBasePath]);
  // Keep other derived layout previews visible; selection itself is always read from the URL.
  const [previewPathnames, setPreviewPathnames] = React.useState<Partial<Record<string, string>>>(
    {},
  );
  const shelves = getCanvasShelves(pages, blocks);
  // The selected Page or block, keyed like its item.
  const selectedItemKey =
    selectedPage?.key ?? (selectedBlock && canvasBlockKey(selectedBlock._internal.id));
  const collapsedShelves = useCollapsedShelves(
    workspaceKey,
    getDefaultCollapsedShelves(shelves),
    shelves.find((shelf) => shelf.items.some(({ key }) => key === selectedItemKey))?.key,
  );
  const toggleShelf = (shelfKey: string) =>
    setShelfCollapsed(workspaceKey, shelfKey, !collapsedShelves.has(shelfKey));
  // The Canvas bounds span the row as shown, so zooming out to it fits collapsed shelves too.
  const { items, markers, width } = positionCanvasShelves(shelves, collapsedShelves);
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
            : previewedPath && page.key === previewedPage?.key
              ? previewedPath
              : (previewPathnames[page.key] ?? page.pathname),
      },
    ]),
  );
  const selectedKey = selectedItemKey && positions.has(selectedItemKey) ? selectedItemKey : null;
  const hiddenSelectedShelf = shelves.find(
    (shelf) =>
      collapsedShelves.has(shelf.key) && shelf.items.some(({ key }) => key === selectedItemKey),
  )?.key;
  // Narrower devices leave room around frames: their areas are shaded, to explain why frames are centered.
  const framed = viewport.width < CANVAS_SLOT_WIDTH;
  const snapTargets = canvasSnapTargets(items);
  const snapRingRef = React.useRef<HTMLDivElement>(null);
  const snapFlash = React.useRef<Animation>(null);
  const { viewportRef, contentRef, flyTo, mirrorCamera, keepInView, reveal, fitAll } =
    useCanvasCamera(
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
        onDeselect: () => goToItem(localized(STUDIO_CANVAS_PATH)),
        // The camera snapped onto an item from a scroll, swipe or zoom: flash a
        // ring around the viewport so the snap reads as locking onto it.
        onSnap: () => {
          snapFlash.current =
            snapRingRef.current?.animate(SNAP_FLASH_KEYFRAMES, SNAP_FLASH_TIMING) ?? null;
        },
        // The flash returns as the zoom springs back to the snap.
        onSnapStretched: () => snapFlash.current?.cancel(),
        // The editor moving the camera themselves stops following the agent.
        onEditorMove: () => follow?.takeOver(),
      },
    );
  const workspace = React.useMemo(
    () => ({ workspaceKey, mirrorCamera, reveal }),
    [workspaceKey, mirrorCamera, reveal],
  );
  // A collapsing marker's area may start off-screen. Its vertical bar should take
  // the place of the marker's visible part, so pan before the collapse paints.
  const collapsingShelf = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const marker = markers.find(({ key }) => key === collapsingShelf.current);
    collapsingShelf.current = null;
    if (marker) keepInView(marker.start, CANVAS_SHELF_MARKER_OVERHANG);
  });
  const instructionsId = React.useId();
  const previousPath = React.useRef(selectedPath);
  React.useEffect(() => {
    if (previousPath.current === selectedPath) return;
    // Selecting a hidden Page from outside the Canvas reveals it; the camera then flies to it.
    if (location.source !== "canvas" && hiddenSelectedShelf) {
      setShelfCollapsed(workspaceKey, hiddenSelectedShelf, false);
      return;
    }
    // A newly created page can arrive in the route before the page list refresh.
    if (location.source !== "canvas" && !selectedKey) return;
    previousPath.current = selectedPath;
  }, [selectedPath, location.source, selectedKey, hiddenSelectedShelf, workspaceKey]);
  // An item to fly to once its shelf is expanded and it has a place in the row.
  const [pendingFlight, setPendingFlight] = React.useState<string | null>(null);
  const pendingFlightPlaced = !!pendingFlight && positions.has(pendingFlight);
  React.useEffect(() => {
    if (!pendingFlight || !pendingFlightPlaced) return;
    // oxlint-disable-next-line react/set-state-in-effect -- the flight waits for the item's place in the row
    setPendingFlight(null);
    flyTo(pendingFlight);
  }, [pendingFlight, pendingFlightPlaced, flyTo]);
  // A request from outside the Canvas, like the show whole canvas action, zooms out to all of it.
  React.useEffect(() => {
    let answered = canvasStore.getSnapshot().context.overviewRequests;
    const subscription = canvasStore.subscribe(({ context }) => {
      if (context.overviewRequests === answered) return;
      answered = context.overviewRequests;
      fitAll();
    });
    return () => subscription.unsubscribe();
  }, [fitAll]);
  React.useImperativeHandle(ref, () => ({
    showItem(key) {
      const shelf = shelves.find((candidate) => candidate.items.some((item) => item.key === key));
      const item = shelf?.items.find((candidate) => candidate.key === key);
      if (!shelf || !item) return;
      const pathname =
        item.kind === "block"
          ? localized(blockCatalogPath(item.block._internal.id))
          : pageSlots.get(key)?.pathname;
      if (pathname && pathname !== selectedPath) {
        void navigate({ to: `${pathname}${location.search}${location.hash}` });
        return;
      }
      if (collapsedShelves.has(shelf.key)) toggleShelf(shelf.key);
      setPendingFlight(key);
    },
    showWholeCanvas() {
      selectPage(localized(STUDIO_CANVAS_PATH));
      fitAll();
    },
  }));

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
      // Only this element's children place themselves with the camera's
      // position. Ending its inheritance below them keeps a pan from restyling
      // every frame, header and overlay in the Canvas.
      className="bg-muted relative min-h-0 min-w-0 flex-1 touch-none overflow-clip outline-none *:*:[--canvas-x:initial] *:*:[--canvas-y:initial] data-[canvas-pan]:cursor-grab data-[canvas-pan]:**:cursor-[inherit]! data-[canvas-pan=dragging]:cursor-grabbing data-[canvas-pan]:[&_iframe]:pointer-events-none"
      style={{
        userSelect: "none",
        overscrollBehavior: "none",
      }}
    >
      <CanvasWorkspaceContext value={workspace}>
        {/* Overlays follow the selection being made, so they hide as soon as zooming out deselects. */}
        <CanvasOverlaysShownContext value={!!intendedItemKey}>
          <div
            ref={contentRef}
            data-canvas-items
            // The camera decides when the row is promoted; see PROMOTED_ZOOM_RANGE.
            className="absolute top-0 left-0 flex w-max items-start in-data-[canvas-promoted]:will-change-transform"
            style={{
              gap: CANVAS_SHELF_GAP,
              transform: CANVAS_WORLD_TRANSFORM,
              transformOrigin: "0 0",
            }}
          >
            {shelves.map((shelf) => {
              // An empty shelf that isn't shown has no marker and no place in the row.
              if (!isCanvasShelfShown(shelf)) return null;
              const collapsed = collapsedShelves.has(shelf.key) || shelf.items.length === 0;
              return (
                // A collapsed or empty shelf shrinks to a zero-width slot under its marker.
                // Its items stay mounted in place, so expanding never reloads them, and
                // keep their height, unless the shelf unmounts them while collapsed.
                <div
                  key={shelf.key}
                  data-canvas-shelf={shelf.key}
                  inert={collapsed}
                  className={`flex shrink-0 items-start ${collapsed ? "invisible w-0" : ""}`}
                  style={{ gap: CANVAS_ITEM_GAP }}
                >
                  {(collapsed && shelf.unmountedWhenCollapsed ? [] : shelf.items).map((item) => {
                    if (item.kind === "block") {
                      return (
                        <CanvasBlockItem
                          key={item.key}
                          itemKey={item.key}
                          block={item.block}
                          projectId={projectId}
                          runtimeBasePath={runtimeBasePath}
                          viewport={viewport}
                          framed={framed}
                          selected={item.block._internal.id === selectedBlock?._internal.id}
                          selectBlock={selectFrameBlock}
                        />
                      );
                    }
                    const slot = pageSlots.get(item.key);
                    if (!slot) return null;
                    const { page, pathname } = slot;
                    return (
                      <CanvasPageItem
                        key={page.key}
                        page={page}
                        pathname={pathname}
                        selected={page.key === selectedPage?.key}
                        hover={hover}
                        // The Preview's page shows the Preview's own frame, so toggling the Canvas keeps its
                        // state. Deselecting it keeps it there too, rather than remount it.
                        previewed={
                          !!previewPageFrame &&
                          page.key === previewedPage?.key &&
                          pathname === previewedPath
                        }
                        collapsed={collapsed}
                        framed={framed}
                        viewport={viewport}
                        runtimeBasePath={runtimeBasePath}
                        onActivate={onActivate}
                        selectPage={selectFramePage}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </CanvasOverlaysShownContext>
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
                page.kind === "curated"
                  ? (nickname) => renamePage(page.pageId, nickname)
                  : undefined
              }
              selected={page.key === selectedPage?.key}
              onHoverChange={(hovered) =>
                hover.send({ type: "set", pageKey: hovered ? page.key : null })
              }
              onSelect={() => {
                if (!pathname) return;
                selectPage(pathname);
              }}
              onChange={(path) => {
                const inLocale = localized(path);
                setPreviewPathnames((current) => ({ ...current, [page.key]: inLocale }));
                selectPage(inLocale);
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
      {/* Above the Shelf Markers and the Preview frame laid over the Canvas. */}
      <div
        ref={snapRingRef}
        aria-hidden
        data-canvas-snap-ring
        className="ring-primary pointer-events-none absolute inset-0 opacity-0 ring-3 ring-inset"
        style={{ zIndex: CANVAS_CHROME_Z_INDEX }}
      />
    </div>
  );
}

export function CamoxCanvas({ runtimeBasePath }: { runtimeBasePath: string }) {
  const app = useCamoxApp();
  const renamePage = useRenamePage();
  const location = useLocation();
  const viewportMode = useSelector(previewStore, (state) => state.context.viewportMode);
  const viewport = CANVAS_DEVICES[viewportMode === "full" ? "desktop" : viewportMode];
  const [activeFrame, setActiveFrame] = React.useState<{
    pathname: string;
    owner: EditingOwner;
    release: ReleaseEditingFrame;
  } | null>(null);
  const selectedPath = location.pathname;
  const previousPath = React.useRef(selectedPath);
  React.useLayoutEffect(() => {
    if (previousPath.current === selectedPath) return;
    previousPath.current = selectedPath;
    if (!activeFrame || activeFrame.pathname === selectedPath) return;
    activeFrame.release();
    // oxlint-disable-next-line react/set-state-in-effect -- released together with the editing frame
    setActiveFrame(null);
  }, [activeFrame, selectedPath]);
  React.useEffect(() => {
    previewStore.send({ type: "clearSelection" });
    return () => {
      previewStore.send({ type: "clearSelection" });
      // Each frame releases only its own claim. The Preview may already have
      // claimed its frame again when preparation is cancelled.
    };
  }, []);
  const projectSlug = useProjectSlug();
  const project = useReadQuery(reads.project({ slug: projectSlug }));
  const pages = useReadQuery(reads.pageList({ projectSlug }), {
    enabled: !!project.data,
  });
  const discoveredPaths = useDiscoveredPreviewPaths(runtimeBasePath);
  const viewLocale = useViewLocale();
  const canvasPages = pages.data
    ? getCanvasPages(pages.data, app.getLayouts(), discoveredPaths, viewLocale.locale)
    : [];
  // The Page or block of the Block Catalog a pathname selects, if any.
  const selectionAt = (runtimePath: string) => {
    const pathname = parseLocalePath(runtimePath, viewLocale.locales).path;
    if (pathname === STUDIO_CANVAS_PATH) return {};
    const blockId = matchBlockCatalogPath(pathname);
    if (!blockId)
      return {
        page: selectedCanvasPage(canvasPages, app.getLayouts(), runtimePath, viewLocale.locales),
      };
    const block = app.getBlockById(blockId);
    return { block: block && !block._internal.layoutOnly ? block : undefined };
  };
  const { page: selectedPage, block: selectedBlock } = selectionAt(location.pathname);
  const previewedPath = React.use(PreviewPageFrameContext)?.pathname;
  const previewedPage = previewedPath ? selectionAt(previewedPath).page : undefined;
  // A Canvas selection commits once its route payload loads. Until then, the
  // Canvas sidebar and the camera already follow it, so they move as the camera snaps.
  const [intent, setIntent] = React.useState<{ from: string; to: typeof location } | null>(null);
  // An intent ends once the location leaves where it started, committed or not, so
  // coming back there later doesn't revive it.
  if (intent && intent.from !== location.pathname) setIntent(null);
  const intended = intent?.from === location.pathname ? intent.to : location;
  const intendedSelection = selectionAt(intended.pathname);
  const navigate = useNavigate();
  const workspace = React.useRef<CanvasWorkspaceHandle>(null);
  // The intended frame's data names a record page's record. Its frame loads it; only read here.
  const { data: intendedFrameInput } = useReadQuery(
    reads.canvasFrame({
      projectSlug,
      runtimeBasePath,
      pathname: intended.pathname,
      derivedLayoutId: derivedLayoutIdOf(intendedSelection.page),
    }),
    { enabled: false },
  );
  const recordResult = derivedLayoutIdOf(intendedSelection.page)
    ? intendedFrameInput?.derived?.result
    : undefined;
  const pageRecord = getPageRecord(recordResult);
  usePreparationFailure(
    (!project.isFetching ? project.error : null) ?? (!pages.isFetching ? pages.error : null),
  );
  const preparation = React.useContext(PreviewPreparationContext);
  React.useEffect(() => {
    if (project.isPending || pages.isPending || project.error || pages.error) return;
    // Without a selected Page, no frame needs to load first: the Canvas is ready once laid out.
    if (
      selectedBlock ||
      parseLocalePath(location.pathname, viewLocale.locales).path === STUDIO_CANVAS_PATH
    ) {
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
    viewLocale.locales,
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
  const editingOwner = activeFrame?.pathname === intended.pathname ? activeFrame.owner : null;
  const blockCatalog = getBlockCatalog(app.getBlocks());
  const intendedItemKey =
    intendedSelection.page?.key ??
    (intendedSelection.block && canvasBlockKey(intendedSelection.block._internal.id));
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {selectedPage?.kind === "curated" && <CuratedBlockShortcuts />}
      {/* The Canvas sidebar stays mounted and routes to the intended selection, or the Canvas itself. */}
      <NavigationProvider location={intended} navigate={navigate}>
        {/* The record page's record, which its sidebar edits. */}
        <PageRecordContext value={recordResult}>
          <CanvasSidebar
            page={intendedSelection.page}
            catalog={
              intendedSelection.block && {
                block: intendedSelection.block,
                projectId: project.data.id,
              }
            }
            navigator={{
              shelves: getCanvasShelves(canvasPages, blockCatalog),
              selectedKey: intendedItemKey,
              onShowItem: (key) => workspace.current?.showItem(key),
            }}
            onShowWholeCanvas={() => workspace.current?.showWholeCanvas()}
            onRenamePage={renamePage}
            owner={editingOwner}
            pageRecord={pageRecord}
          />
        </PageRecordContext>
      </NavigationProvider>
      <CanvasWorkspace
        ref={workspace}
        key={project.data.id}
        projectId={project.data.id}
        pages={canvasPages}
        blocks={blockCatalog}
        selectedPage={selectedPage}
        selectedBlock={selectedBlock}
        previewedPage={previewedPage}
        intendedItemKey={intendedItemKey}
        runtimeBasePath={runtimeBasePath}
        viewport={viewport}
        onActivate={(pathname, owner, release) => setActiveFrame({ pathname, owner, release })}
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
    </div>
  );
}
