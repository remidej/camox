import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { useAuthContext, useProjectSlug } from "../../lib/auth";
import { layoutQueries, pageMutations, pageQueries, projectQueries } from "../../lib/queries";
import { useLocation, useNavigate } from "../navigation/navigation";
import { PageStatusBadge } from "../preview/components/PageStatusBadge";
import { CuratedBlockShortcuts } from "../preview/components/PreviewPanel";
import { PreviewPreparationContext } from "../preview/previewPreparation";
import { previewStore, selectIsCommentMode, type EditingOwner } from "../preview/previewStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { runtimePath } from "../runtime/navigationTarget";
import type { PageRenderInput } from "../runtime/runtime";
import { CANVAS_HEADER_HEIGHT } from "./canvasCamera";
import { CanvasPageCommentIndicators } from "./CanvasCommentIndicators";
import { CanvasLeftSidebar } from "./CanvasLeftSidebar";
import { CanvasPageFrame } from "./CanvasPageFrame";
import { CanvasPageHeader } from "./CanvasPageHeader";
import {
  CANVAS_DEVICES,
  getCanvasPages,
  validateCanvasPageInput,
  type CanvasPage,
} from "./canvasPages";
import { CanvasRightSidebar } from "./CanvasRightSidebar";
import { selectedCanvasPage } from "./canvasSelection";
import { CanvasWorkspaceContext } from "./canvasZoom";
import { useCanvasCamera } from "./useCanvasCamera";

const CANVAS_PAGE_GAP = 240;
// Device selection resizes previews, not their reserved space in the canvas.
const CANVAS_SLOT_WIDTH = CANVAS_DEVICES.desktop.width;
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

class CanvasPageBoundary extends React.Component<
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

function CanvasPagePreview({
  pathname,
  runtimeBasePath,
  derivedLayoutId,
  pageId,
  viewport,
  selected,
  hovered,
  onActivate,
}: {
  pathname: string;
  runtimeBasePath: string;
  derivedLayoutId?: string;
  pageId?: number;
  viewport: CanvasViewport;
  selected: boolean;
  hovered: boolean;
  onActivate: (owner: EditingOwner, source: "selection" | "interaction") => void;
}) {
  const projectSlug = useProjectSlug();
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["camox", "canvas", projectSlug, runtimeBasePath, pathname, derivedLayoutId ?? null],
    queryFn: async ({ signal }) => {
      const url = new URL(runtimePath("/_camox/data", runtimeBasePath), window.location.origin);
      url.searchParams.set("path", pathname);
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error(`Could not load ${pathname} (${response.status}).`);
      const input = (await response.json()) as PageRenderInput;
      validateCanvasPageInput(input, pathname, derivedLayoutId);
      return input;
    },
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
      onActivate={onActivate}
    />
  );
}

type CanvasPageStatus = Pick<
  React.ComponentProps<typeof PageStatusBadge>,
  "status" | "modifiedReason"
>;

function CanvasWorkspace({
  pages,
  statuses,
  selectedPage,
  runtimeBasePath,
  viewport,
  onActivate,
}: {
  pages: CanvasPage[];
  statuses: Map<string, CanvasPageStatus>;
  selectedPage: CanvasPage | undefined;
  runtimeBasePath: string;
  viewport: CanvasViewport;
  onActivate: (pathname: string, owner: EditingOwner) => void;
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
    cancelFlight();
    void navigate({ to: `${pathname}${location.search}${location.hash}`, source: "canvas" });
  };
  const workspaceKey = JSON.stringify([
    apiUrl,
    projectSlug,
    environmentName ?? "production",
    runtimeBasePath,
  ]);
  const selectedIndex = pages.findIndex((page) => page.key === selectedPage?.key);
  // Keep other derived layout previews visible; selection itself is always read from the URL.
  const [previewPathnames, setPreviewPathnames] = React.useState<Partial<Record<string, string>>>(
    {},
  );
  const positionedPages = pages.map((page, index) => ({
    page,
    pathname:
      page.key === selectedPage?.key ? selectedPath : (previewPathnames[page.key] ?? page.pathname),
    left: index * (CANVAS_SLOT_WIDTH + CANVAS_PAGE_GAP),
  }));
  const { viewportRef, contentRef, flyToPage, cancelFlight, zoomAt } = useCanvasCamera(
    workspaceKey,
    selectedIndex < 0
      ? undefined
      : {
          left: selectedIndex * (CANVAS_SLOT_WIDTH + CANVAS_PAGE_GAP),
          width: CANVAS_SLOT_WIDTH,
        },
    {
      pages: positionedPages.map(({ page, left }) => ({
        key: page.key,
        left,
        width: CANVAS_SLOT_WIDTH,
      })),
      onSelect: (key) => {
        const pathname = positionedPages.find(({ page }) => page.key === key)?.pathname;
        if (pathname) selectPage(pathname);
      },
    },
  );
  const instructionsId = React.useId();
  const previousPath = React.useRef(selectedPath);
  React.useEffect(() => {
    if (previousPath.current === selectedPath) return;
    // A newly created page can arrive in the route before the page list refresh.
    if (location.source !== "canvas" && selectedIndex < 0) return;
    previousPath.current = selectedPath;
    if (location.source === "canvas") return;
    flyToPage(pages[selectedIndex]!.key);
  }, [selectedPath, location.source, selectedIndex, pages, flyToPage]);

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="Page canvas"
      aria-describedby={instructionsId}
      tabIndex={0}
      data-camox-canvas
      className="bg-muted relative min-h-0 min-w-0 flex-1 touch-none overflow-clip outline-none"
      style={{
        cursor: "grab",
        userSelect: "none",
        overscrollBehavior: "none",
      }}
    >
      <CanvasWorkspaceContext value={{ workspaceKey, zoomAt }}>
        <div
          ref={contentRef}
          data-canvas-pages
          className="absolute top-0 left-0 flex w-max items-start"
          style={{
            gap: CANVAS_PAGE_GAP,
            transform:
              "translate(var(--canvas-x, 64px), var(--canvas-y, 112px)) scale(var(--canvas-zoom, .4))",
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {positionedPages.map(({ page, pathname }) => (
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
                <CanvasPageBoundary key={pathname} selected={page.key === selectedPage?.key}>
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
                    <CanvasMessage>Choose a page path above to preview this layout.</CanvasMessage>
                  )}
                </CanvasPageBoundary>
              </div>
            </div>
          ))}
        </div>
      </CanvasWorkspaceContext>
      {positionedPages.map(({ page, pathname, left }) => (
        <div
          key={page.key}
          data-canvas-header={page.key}
          className="@container/canvas-header absolute top-0 left-0 pb-3"
          style={{
            height: CANVAS_HEADER_HEIGHT,
            transform: `translate(calc(var(--canvas-x, 64px) + ${left}px * var(--canvas-zoom, .4)), calc(var(--canvas-y, 112px) - ${CANVAS_HEADER_HEIGHT}px))`,
            width: `calc(${CANVAS_SLOT_WIDTH}px * var(--canvas-zoom, .4))`,
            willChange: "transform",
          }}
        >
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
        </div>
      ))}
      {!pages.length && <CanvasMessage>No pages to preview yet.</CanvasMessage>}
      <p id={instructionsId} className="sr-only">
        Drag the background or scroll to pan. Pinch or Ctrl/⌘ + scroll to zoom. Click a page to edit
        it. Focus the canvas and use plus or minus to zoom, arrow keys to pan, 0 for 100%, or Home /
        Shift+1 to fit all pages.
      </p>
    </div>
  );
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
  const canvasPages = pages.data ? getCanvasPages(pages.data, app.getLayouts()) : [];
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
  const selectedPage = selectedCanvasPage(canvasPages, app.getLayouts(), location.pathname);
  usePreparationFailure(
    (!project.isFetching ? project.error : null) ?? (!pages.isFetching ? pages.error : null),
  );
  const preparation = React.useContext(PreviewPreparationContext);
  React.useEffect(() => {
    if (project.isPending || pages.isPending || project.error || pages.error || selectedPage)
      return;
    preparation?.fail(new Error(`No canvas page matches ${location.pathname}.`));
  }, [
    project.isPending,
    pages.isPending,
    project.error,
    pages.error,
    selectedPage,
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
  const editingOwner = activeFrame?.pathname === selectedPath ? activeFrame.owner : null;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {selectedPage?.pageId != null && !isCommentMode && <CuratedBlockShortcuts />}
      <CanvasLeftSidebar page={selectedPage} owner={editingOwner} />
      <CanvasWorkspace
        key={project.data.id}
        pages={canvasPages}
        statuses={statuses}
        selectedPage={selectedPage}
        runtimeBasePath={runtimeBasePath}
        viewport={viewport}
        onActivate={(pathname, owner) => setActiveFrame({ pathname, owner })}
      />
      <CanvasRightSidebar page={selectedPage} owner={editingOwner} />
    </div>
  );
}
