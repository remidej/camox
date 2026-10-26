import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { useAuthContext, useProjectUuid } from "../../lib/auth";
import { useOptionalDraftScope } from "../../lib/draft-scope";
import { parseLocalePath } from "../../lib/locale-path";
import { pageMutations } from "../../lib/queries";
import { useRoutableLayouts } from "../../lib/studio-definitions";
import { reads, useReadQuery, useStudioCache } from "../../lib/studio-reads";
import { useLocalizedPath } from "../../lib/view-locale";
import { useViewLocale } from "../../lib/view-locale-context";
import { NavigationProvider, useLocation, useNavigate } from "../navigation/navigation";
import { CuratedBlockShortcuts } from "../preview/components/PreviewPanel";
import type { ReleaseEditingFrame } from "../preview/editingFrame";
import { getPageRecord, PageRecordContext } from "../preview/pageRecord";
import { CMS_SIDEBAR_WIDTH } from "../preview/previewConstants";
import {
  CANVAS_CHROME_Z_INDEX,
  PREVIEW_PAGE_SLOT_ATTRIBUTE,
  PreviewPageFrameContext,
} from "../preview/previewPageFrame";
import { PreviewPreparationContext } from "../preview/previewPreparation";
import { previewStore, type EditingOwner } from "../preview/previewStore";
import { useRendererHost } from "../renderer/RendererFrames";
import { FollowAgentContext } from "../studio/followAgentContext";
import { STUDIO_CANVAS_PATH } from "../studio/routes";
import { CANVAS_HEADER_HEIGHT, CANVAS_PAGE_FIT_PADDING } from "./canvasCamera";
import { canvasBlockOverlap } from "./canvasFrameDocument";
import { useCanvasFrameMode, type CanvasFrameMode } from "./canvasFrameMode";
import {
  CANVAS_ITEM_GAP,
  CANVAS_SLOT_WIDTH,
  canvasSnapTargets,
  positionCanvasPages,
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
import { canvasStore } from "./canvasStore";
import {
  CANVAS_THUMBNAIL_MAX_ZOOM,
  canvasThumbnailsSupported,
  CanvasThumbnailsContext,
  createCanvasThumbnails,
  useCanvasThumbnail,
} from "./canvasThumbnails";
import { CanvasWorkspaceContext } from "./canvasZoom";
import { ContentSidebar } from "./sidebar/ContentSidebar";
import { useCanvasCamera, type CanvasInsets } from "./useCanvasCamera";
import { useCanvasNearness } from "./useCanvasNearness";
import { useDiscoveredPreviewPaths } from "./useDiscoveredPreviewPaths";

type CanvasViewport = { width: number; height: number };

/**
 * The Canvas spans the studio under its sidebars, the Content Sidebar on its left and the Agent Sidebar on
 * its right: the camera frames and snaps Pages between them, and above the studio's bottom edge.
 */
const CANVAS_INSETS: CanvasInsets = {
  top: 0,
  right: CMS_SIDEBAR_WIDTH,
  bottom: 8,
  left: CMS_SIDEBAR_WIDTH,
};

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
  { children: React.ReactNode; selected: boolean },
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
        <PreparationFailure error={this.state.error} selected={this.props.selected} />
        <div role="alert">
          <p>This page could not be rendered.</p>
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
  /** Selects the Page, from a click on its still image. */
  onSelect: () => void;
};

/**
 * A Page loads its frame once it first comes near the Canvas viewport, and the
 * selected Page right away, wherever the camera is. The frame then stays
 * mounted, but only runs while selected and the camera is still.
 *
 * Zoomed out, or away from the camera, a Page shows a still image of its frame
 * instead, once it has one: the frame unmounts. Its frame comes back near the
 * camera when zoomed in, out of sight until it settles, so the swap doesn't show.
 * Frames come and go only while the camera is still.
 */
function CanvasPagePreview(props: CanvasPagePreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { near, reached } = useCanvasNearness(ref);
  const mode = useCanvasFrameMode({ near, selected: props.selected });
  const workspaceKey = React.use(CanvasWorkspaceContext)?.workspaceKey;
  const draftId = useOptionalDraftScope().draftId;
  const { locale } = useViewLocale();
  const key = JSON.stringify([
    draftId,
    locale,
    props.runtimeBasePath,
    props.pathname,
    props.derivedLayoutId ?? null,
    props.viewport.width,
  ]);
  const { thumbnails, thumbnail, refreshing } = useCanvasThumbnail(key);
  const zoomedOut = useSelector(canvasStore, (state) => {
    if (!thumbnails || workspaceKey == null) return false;
    return (state.context.views[workspaceKey]?.camera.scale ?? 0.4) < CANVAS_THUMBNAIL_MAX_ZOOM;
  });
  // Once loaded, even only for being selected, a frame stays, unless an image replaces it.
  const [loaded, setLoaded] = React.useState(false);
  if ((reached || props.selected) && !loaded) setLoaded(true);
  const wantsLive = props.selected || (near && !zoomedOut);
  const wantsFrame = loaded && (wantsLive || refreshing || !thumbnail);
  const [frameShown, setFrameShown] = React.useState(false);
  const [settledFrame, setSettledFrame] = React.useState<HTMLIFrameElement | null>(null);
  // Each time the frame settles, it asks for a capture. Captures wait for the
  // camera to stop, like frames coming and going.
  const [settles, setSettles] = React.useState(0);
  const [captured, setCaptured] = React.useState(0);
  const captureRequested = settles > captured;
  const waiting = frameShown !== wantsFrame || captureRequested;
  const moving = useSelector(
    canvasStore,
    (state) =>
      !!thumbnails && waiting && workspaceKey != null && !!state.context.moving[workspaceKey],
  );
  // Without an image, there is nothing to show but the frame.
  if (frameShown !== wantsFrame && (!moving || !thumbnail)) {
    setFrameShown(wantsFrame);
    if (!wantsFrame) {
      setSettledFrame(null);
      setCaptured(settles);
    }
  }
  const imageShown = !!thumbnail && !(frameShown && settledFrame && wantsLive);

  // A stale image refreshes once near the camera, if no frame does it already.
  const stale = !!thumbnail?.stale && near && !wantsLive;
  React.useEffect(() => {
    if (!stale || !thumbnails) return;
    return thumbnails.requestRefresh(key);
  }, [stale, thumbnails, key]);

  const onSettled = (frame: HTMLIFrameElement) => {
    setSettledFrame(frame);
    setSettles((count) => count + 1);
  };
  const resting = mode === "resting";
  const started = React.useRef(0);
  React.useEffect(() => {
    if (!captureRequested || moving || resting || !settledFrame || !thumbnails) return;
    if (started.current >= settles) return;
    const request = settles;
    started.current = request;
    // Sharp up to the zoom the live frame takes over at, with the blocks overlapping as they
    // will in the frame then.
    const pixelRatio = window.devicePixelRatio;
    const options = {
      scale: Math.min(1, CANVAS_THUMBNAIL_MAX_ZOOM * pixelRatio),
      blockOverlap: canvasBlockOverlap(CANVAS_THUMBNAIL_MAX_ZOOM, pixelRatio),
    };
    const tokens = [props.pathname, props.pageId, props.derivedLayoutId].filter(
      (token): token is string => !!token,
    );
    thumbnails
      .capture(key, settledFrame, tokens, options)
      .catch((error: unknown) => {
        thumbnails.abandon(key);
        console.warn(`[camox] Could not capture ${props.pathname} for the Canvas.`, error);
      })
      .finally(() => setCaptured((count) => Math.max(count, request)));
  }, [
    captureRequested,
    settles,
    moving,
    resting,
    settledFrame,
    thumbnails,
    key,
    props.pathname,
    props.pageId,
    props.derivedLayoutId,
  ]);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        minHeight: props.viewport.height,
        // Away from the camera, a frame that doesn't rest yet still isn't drawn.
        visibility: near || props.selected ? undefined : "hidden",
      }}
    >
      {frameShown && (
        // Behind its image, a frame isn't drawn either.
        <div style={{ visibility: imageShown ? "hidden" : undefined }}>
          <CanvasPageFrameLoader
            {...props}
            mode={mode}
            onSettled={thumbnails ? onSettled : undefined}
          />
        </div>
      )}
      {imageShown && thumbnail && (
        <img
          src={thumbnail.url}
          alt=""
          draggable={false}
          data-canvas-thumbnail=""
          onClick={(event) => {
            if (!event.currentTarget.closest("[data-canvas-pan]")) props.onSelect();
          }}
          style={{
            display: "block",
            width: thumbnail.width,
            height: thumbnail.height,
            ...(frameShown ? { position: "absolute", top: 0, left: 0 } : {}),
          }}
        />
      )}
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
  onSettled,
}: CanvasPagePreviewProps & {
  mode: CanvasFrameMode;
  onSettled?: (frame: HTMLIFrameElement) => void;
}) {
  const projectUuid = useProjectUuid();
  const { data, error, isPending, isFetching, refetch } = useReadQuery(
    reads.canvasFrame({ projectUuid, runtimeBasePath, pathname, derivedLayoutId }),
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
      onSettled={onSettled}
    />
  );
}

/**
 * Where a sidebar's scrim starts fading, in px from the studio's edge: past the sidebar's outer
 * gutter (`SIDEBAR_GUTTER`), so it fades across the whole of the sidebar's contents.
 */
const SCRIM_FADE_START = 8;
/** How opaque the scrim gets at most: what's under it always shows through, faintly. */
const SCRIM_MAX_OPACITY = 0.8;
/** Opacity along the fade, relative to the most, eased so it leaves no visible edge where it ends. */
const SCRIM_EASING = [1, 0.92, 0.78, 0.6, 0.42, 0.26, 0.13, 0.05, 0];

/**
 * Fades what the Canvas shows around a sidebar into the Canvas's background, toward the sidebar:
 * from nothing past a snapped Page's edge, to the most only at the sidebar's outer gutter.
 */
function scrimGradient(towards: "left" | "right", inset: number) {
  const from = SCRIM_FADE_START;
  const length = inset + CANVAS_PAGE_FIT_PADDING - SCRIM_FADE_START;
  const stops = SCRIM_EASING.map(
    (alpha, index) =>
      `color-mix(in oklab, var(--color-canvas) ${alpha * SCRIM_MAX_OPACITY * 100}%, transparent) ${from + (length * index) / (SCRIM_EASING.length - 1)}px`,
  );
  return `linear-gradient(to ${towards === "left" ? "right" : "left"}, ${stops.join(", ")})`;
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

/** A Page's area in the Canvas row, with its frame. */
function CanvasPageItem({
  page,
  pathname,
  selected,
  previewed,
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
        <CanvasFrameBoundary key={pathname} selected={selected}>
          {previewed ? (
            <CanvasPreviewPageSlot
              pageId={canvasPageId(page)}
              layoutId={canvasLayoutId(page)}
              width={viewport.width}
              viewportHeight={viewport.height}
              selected={selected}
              hovered={hovered}
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
              onSelect={() => selectPage(pathname)}
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

/** What the Canvas offers to the Content Sidebar beside it. */
type CanvasWorkspaceHandle = {
  /**
   * Shows a Page: selects it as from outside the Canvas, so the camera flies to
   * it. A Page without a path to select, or the selected one, only gets the flight.
   */
  showPage: (key: string) => void;
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

/**
 * The still images of a workspace's Pages, where the browser draws them faithfully. They refresh
 * while the camera is still, and all go stale when the website's code changes: each time another
 * renderer document connects, for a new revision or another draft.
 */
function useWorkspaceThumbnails(workspaceKey: string) {
  const queryClient = useQueryClient();
  const renderer = useRendererHost();
  const [thumbnails] = React.useState(() =>
    canvasThumbnailsSupported() ? createCanvasThumbnails(queryClient) : null,
  );
  React.useEffect(() => thumbnails?.connect(), [thumbnails]);
  React.useEffect(() => {
    if (!thumbnails) return;
    const update = () =>
      thumbnails.setMoving(!!canvasStore.getSnapshot().context.moving[workspaceKey]);
    update();
    const subscription = canvasStore.subscribe(update);
    return () => subscription.unsubscribe();
  }, [thumbnails, workspaceKey]);
  React.useEffect(() => {
    if (!renderer || !thumbnails) return;
    return renderer.subscribe(() => thumbnails.markAllStale());
  }, [renderer, thumbnails]);
  return thumbnails;
}

function CanvasWorkspace({
  ref,
  pages,
  selectedPage,
  previewedPage,
  intendedPageKey,
  runtimeBasePath,
  viewport,
  onActivate,
  onSelectionIntent,
}: {
  pages: CanvasPage[];
  selectedPage: CanvasPage | undefined;
  /** The Page the Preview page frame shows: the selected one, or the last one selected. */
  previewedPage: CanvasPage | undefined;
  /** The key of the Page the Canvas is selecting, even before its location commits. */
  intendedPageKey: string | undefined;
  runtimeBasePath: string;
  viewport: CanvasViewport;
  onActivate: (pathname: string, owner: EditingOwner, release: ReleaseEditingFrame) => void;
  onSelectionIntent: (pathname: string) => void;
  ref?: React.Ref<CanvasWorkspaceHandle>;
}) {
  const { apiUrl, projectUuid } = useAuthContext();
  const renamePage = useRenamePage();
  const location = useLocation();
  const navigate = useNavigate();
  const previewPageFrame = React.use(PreviewPageFrameContext);
  const localized = useLocalizedPath();
  const [hover] = React.useState(createCanvasHover);
  const selectedPath = location.pathname;
  const previewedPath = previewPageFrame?.pathname;
  const follow = React.use(FollowAgentContext);
  // The camera flies to the selected Page, unless it is already snapped to it.
  const goTo = (pathname: string) => {
    onSelectionIntent(pathname);
    void navigate({ to: `${pathname}${location.search}${location.hash}`, source: "canvas" });
  };
  // The editor selecting a Page themselves stops following the agent. The Canvas's own
  // navigations, like the camera leaving a snap as a block reveals itself, don't.
  const selectPage = (pathname: string) => {
    follow?.takeOver();
    goTo(pathname);
  };
  // Frames get a selection callback that keeps its identity across hovers and
  // navigations, so only the frames whose own props change re-render.
  const latestSelectPage = React.useRef(selectPage);
  React.useLayoutEffect(() => {
    latestSelectPage.current = selectPage;
  });
  const selectFramePage = React.useCallback(
    (pathname: string) => latestSelectPage.current(pathname),
    [],
  );
  const workspaceKey = JSON.stringify([apiUrl, projectUuid, runtimeBasePath]);
  // Keep other derived layout previews visible; selection itself is always read from the URL.
  const [previewPathnames, setPreviewPathnames] = React.useState<Partial<Record<string, string>>>(
    {},
  );
  const { items, width } = positionCanvasPages(pages);
  // Each Page, keyed like its item, with the pathname its frame previews and its place in the row.
  const pageSlots = new Map(
    items.map(({ key, page, left }) => [
      key,
      {
        page,
        left,
        pathname:
          key === selectedPage?.key
            ? selectedPath
            : previewedPath && key === previewedPage?.key
              ? previewedPath
              : (previewPathnames[key] ?? page.pathname),
      },
    ]),
  );
  // Narrower devices leave room around frames: their areas are shaded, to explain why frames are centered.
  const framed = viewport.width < CANVAS_SLOT_WIDTH;
  const snapTargets = canvasSnapTargets(items);
  const { viewportRef, contentRef, flyTo, mirrorCamera, reveal, fitAll } = useCanvasCamera(
    workspaceKey,
    snapTargets.find(({ key }) => key === selectedPage?.key),
    {
      targets: snapTargets,
      width,
      onSelect: (key) => {
        const pathname = pageSlots.get(key)?.pathname;
        if (pathname) selectPage(pathname);
      },
      selected: intendedPageKey && pageSlots.has(intendedPageKey) ? intendedPageKey : null,
      onDeselect: () => goTo(localized(STUDIO_CANVAS_PATH)),
      insets: CANVAS_INSETS,
      // The editor moving the camera themselves stops following the agent.
      onEditorMove: () => follow?.takeOver(),
    },
  );
  const workspace = React.useMemo(
    () => ({ workspaceKey, mirrorCamera, reveal }),
    [workspaceKey, mirrorCamera, reveal],
  );
  const thumbnails = useWorkspaceThumbnails(workspaceKey);
  const instructionsId = React.useId();
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
    showPage(key) {
      const slot = pageSlots.get(key);
      if (!slot) return;
      if (slot.pathname && slot.pathname !== selectedPath) {
        void navigate({ to: `${slot.pathname}${location.search}${location.hash}` });
        return;
      }
      flyTo(key);
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
      className="bg-canvas relative min-h-0 min-w-0 flex-1 touch-none overflow-clip outline-none *:*:[--canvas-x:initial] *:*:[--canvas-y:initial] data-[canvas-pan]:cursor-grab data-[canvas-pan]:**:cursor-[inherit]! data-[canvas-pan=dragging]:cursor-grabbing data-[canvas-pan]:[&_iframe]:pointer-events-none"
      style={{
        userSelect: "none",
        overscrollBehavior: "none",
      }}
    >
      <CanvasWorkspaceContext value={workspace}>
        <CanvasThumbnailsContext value={thumbnails}>
          {/* Overlays follow the selection being made, so they hide as soon as zooming out deselects. */}
          <CanvasOverlaysShownContext value={!!intendedPageKey}>
            <div
              ref={contentRef}
              data-canvas-items
              // The camera decides when the row is promoted; see PROMOTED_ZOOM_RANGE.
              className="absolute top-0 left-0 flex w-max items-start in-data-[canvas-promoted]:will-change-transform"
              style={{
                gap: CANVAS_ITEM_GAP,
                transform: CANVAS_WORLD_TRANSFORM,
                transformOrigin: "0 0",
              }}
            >
              {[...pageSlots.values()].map(({ page, pathname }) => (
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
                  framed={framed}
                  viewport={viewport}
                  runtimeBasePath={runtimeBasePath}
                  onActivate={onActivate}
                  selectPage={selectFramePage}
                />
              ))}
            </div>
          </CanvasOverlaysShownContext>
        </CanvasThumbnailsContext>
      </CanvasWorkspaceContext>
      {[...pageSlots.values()].map(({ page, pathname, left }) => (
        <CanvasHeaderSlot key={page.key} itemKey={page.key} left={left}>
          <CanvasPageHeader
            page={page}
            pathname={pathname}
            onRename={
              page.kind === "curated" ? (nickname) => renamePage(page.pageId, nickname) : undefined
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
      ))}
      {!pages.length && <CanvasMessage>No pages to preview yet.</CanvasMessage>}
      <p id={instructionsId} className="sr-only">
        Scroll, or hold Space and drag, to pan. Pinch or Ctrl/⌘ + scroll to zoom. Click a page to
        edit it. Focus the canvas and use plus or minus to zoom, arrow keys to pan, 0 for 100%, or
        Home / Shift+1 to fit all pages.
      </p>
      {/*
       * Under each sidebar, a scrim fades the Pages around it into the Canvas's background, so
       * they don't distract from it. Above the Pages, the Preview frame among them, below the sidebars.
       */}
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          aria-hidden
          data-canvas-scrim={side}
          className="pointer-events-none absolute inset-y-0"
          style={{
            [side]: 0,
            width: CANVAS_INSETS[side] + CANVAS_PAGE_FIT_PADDING,
            background: scrimGradient(side, CANVAS_INSETS[side]),
            zIndex: CANVAS_CHROME_Z_INDEX,
          }}
        />
      ))}
    </div>
  );
}

export function CamoxCanvas({ runtimeBasePath }: { runtimeBasePath: string }) {
  const layouts = useRoutableLayouts();
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
  const projectUuid = useProjectUuid();
  const project = useReadQuery(reads.project({ projectUuid }));
  const pages = useReadQuery(reads.pageList({ projectUuid }), {
    enabled: !!project.data,
  });
  const discoveredPaths = useDiscoveredPreviewPaths(runtimeBasePath);
  const viewLocale = useViewLocale();
  const canvasPages = pages.data
    ? getCanvasPages(pages.data, layouts, discoveredPaths, viewLocale.locale)
    : [];
  // Whether a pathname is the Canvas itself, with nothing selected.
  const isCanvasPath = (runtimePath: string) =>
    parseLocalePath(runtimePath, viewLocale.locales).path === STUDIO_CANVAS_PATH;
  // The Page a pathname selects, if any.
  const pageAt = (runtimePath: string) =>
    isCanvasPath(runtimePath)
      ? undefined
      : selectedCanvasPage(canvasPages, layouts, runtimePath, viewLocale.locales);
  const selectedPage = pageAt(location.pathname);
  const previewedPath = React.use(PreviewPageFrameContext)?.pathname;
  const previewedPage = previewedPath ? pageAt(previewedPath) : undefined;
  // A Canvas selection commits once its route payload loads. Until then, the
  // Content Sidebar and the camera already follow it, so they move as the camera snaps.
  const [intent, setIntent] = React.useState<{ from: string; to: typeof location } | null>(null);
  // An intent ends once the location leaves where it started, committed or not, so
  // coming back there later doesn't revive it.
  if (intent && intent.from !== location.pathname) setIntent(null);
  const intended = intent?.from === location.pathname ? intent.to : location;
  const intendedPage = pageAt(intended.pathname);
  const navigate = useNavigate();
  const workspace = React.useRef<CanvasWorkspaceHandle>(null);
  // The intended frame's data names a record page's record. Its frame loads it; only read here.
  const { data: intendedFrameInput } = useReadQuery(
    reads.canvasFrame({
      projectUuid,
      runtimeBasePath,
      pathname: intended.pathname,
      derivedLayoutId: derivedLayoutIdOf(intendedPage),
    }),
    { enabled: false },
  );
  const recordResult = derivedLayoutIdOf(intendedPage)
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
    if (parseLocalePath(location.pathname, viewLocale.locales).path === STUDIO_CANVAS_PATH) {
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
  return (
    // The Canvas spans the whole row, under the Content Sidebar laid over its left side.
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {selectedPage?.kind === "curated" && <CuratedBlockShortcuts />}
      {/* The Content Sidebar stays mounted and routes to the intended selection, or the Canvas itself. */}
      <NavigationProvider location={intended} navigate={navigate}>
        {/* The record page's record, which its sidebar edits. */}
        <PageRecordContext value={recordResult}>
          <ContentSidebar
            page={intendedPage}
            navigator={{
              pages: canvasPages,
              selectedKey: intendedPage?.key,
              onShowPage: (key) => workspace.current?.showPage(key),
            }}
            onShowWholeCanvas={() => workspace.current?.showWholeCanvas()}
            owner={editingOwner}
            pageRecord={pageRecord}
            runtimeBasePath={runtimeBasePath}
          />
        </PageRecordContext>
      </NavigationProvider>
      <CanvasWorkspace
        ref={workspace}
        key={project.data.id}
        pages={canvasPages}
        selectedPage={selectedPage}
        previewedPage={previewedPage}
        intendedPageKey={intendedPage?.key}
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
