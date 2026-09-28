import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useAuthContext, useProjectSlug } from "../../lib/auth";
import { pageQueries, projectQueries } from "../../lib/queries";
import { useLocation, useNavigate } from "../navigation/navigation";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { runtimePath } from "../runtime/navigationTarget";
import type { PageRenderInput } from "../runtime/runtime";
import { CANVAS_HEADER_HEIGHT } from "./canvasCamera";
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
import { canvasSelectionUrl, selectedCanvasPage, selectedCanvasPath } from "./canvasSelection";
import { useCanvasCamera } from "./useCanvasCamera";

const CANVAS_PAGE_GAP = 240;
// Canvas uses desktop until the app-wide device control is added.
const CANVAS_VIEWPORT = CANVAS_DEVICES.desktop;
const CANVAS_SLOT_WIDTH = CANVAS_VIEWPORT.width;

function CanvasMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground grid min-h-64 place-items-center p-8 text-center text-sm">
      {children}
    </div>
  );
}

class CanvasPageBoundary extends React.Component<
  { children: React.ReactNode },
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
  templateId,
}: {
  pathname: string;
  runtimeBasePath: string;
  templateId?: string;
}) {
  const projectSlug = useProjectSlug();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["camox", "canvas", projectSlug, runtimeBasePath, pathname, templateId ?? null],
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
      validateCanvasPageInput(input, pathname, templateId);
      return input;
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
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
      width={CANVAS_VIEWPORT.width}
      viewportHeight={CANVAS_VIEWPORT.height}
    />
  );
}

function CanvasWorkspace({
  pages,
  selectedPage,
  runtimeBasePath,
}: {
  pages: CanvasPage[];
  selectedPage: CanvasPage | undefined;
  runtimeBasePath: string;
}) {
  const { apiUrl, projectSlug, environmentName } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedPath = selectedCanvasPath(location.pathname);
  const selectPage = (pathname: string) => {
    if (selectedPath === pathname) return;
    void navigate({ to: `${canvasSelectionUrl(pathname)}${location.search}${location.hash}` });
  };
  const workspaceKey = JSON.stringify([
    apiUrl,
    projectSlug,
    environmentName ?? "production",
    runtimeBasePath,
  ]);
  const selectedIndex = pages.findIndex((page) => page.key === selectedPage?.key);
  const { viewportRef, contentRef } = useCanvasCamera(
    workspaceKey,
    selectedIndex < 0
      ? undefined
      : {
          left: selectedIndex * (CANVAS_SLOT_WIDTH + CANVAS_PAGE_GAP),
          width: CANVAS_VIEWPORT.width,
        },
  );
  // Keep other template previews visible; selection itself is always read from the URL.
  const [previewPathnames, setPreviewPathnames] = React.useState<Partial<Record<string, string>>>(
    {},
  );
  const positionedPages = pages.map((page, index) => ({
    page,
    pathname:
      page.key === selectedPage?.key ? selectedPath : (previewPathnames[page.key] ?? page.pathname),
    left: index * (CANVAS_SLOT_WIDTH + CANVAS_PAGE_GAP),
  }));
  const instructionsId = React.useId();

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="Read-only page canvas"
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
            className="flex shrink-0 justify-center"
            style={{ width: CANVAS_SLOT_WIDTH }}
          >
            <div
              data-canvas-page={page.key}
              className="bg-background shrink-0 overflow-hidden shadow-xl ring-1 ring-black/10"
              style={{ width: CANVAS_VIEWPORT.width, minHeight: CANVAS_VIEWPORT.height }}
            >
              <CanvasPageBoundary key={pathname}>
                {pathname ? (
                  <CanvasPagePreview
                    pathname={pathname}
                    runtimeBasePath={runtimeBasePath}
                    templateId={page.templateId}
                  />
                ) : (
                  <CanvasMessage>
                    Choose an instance path above to preview this template.
                  </CanvasMessage>
                )}
              </CanvasPageBoundary>
            </div>
          </div>
        ))}
      </div>
      {positionedPages.map(({ page, pathname, left }) => (
        <div
          key={page.key}
          data-canvas-header={page.key}
          className="@container/canvas-header absolute top-0 left-0 pb-3"
          style={{
            height: CANVAS_HEADER_HEIGHT,
            transform: `translate(calc(var(--canvas-x, 64px) + ${left}px * var(--canvas-zoom, .4)), calc(var(--canvas-y, 112px) - ${CANVAS_HEADER_HEIGHT}px))`,
            width: `calc(${CANVAS_SLOT_WIDTH}px * var(--canvas-zoom, .4))`,
          }}
        >
          <CanvasPageHeader
            page={page}
            pathname={pathname}
            selected={page.key === selectedPage?.key}
            onSelect={() => {
              if (pathname) selectPage(pathname);
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
        Drag or scroll to pan. Pinch or Ctrl/⌘ + scroll to zoom. Focus the canvas and use plus or
        minus to zoom, arrow keys to pan, 0 for 100%, or Home / Shift+1 to fit all pages.
      </p>
    </div>
  );
}

export function CamoxCanvas({ runtimeBasePath }: { runtimeBasePath: string }) {
  const app = useCamoxApp();
  const location = useLocation();
  const projectSlug = useProjectSlug();
  const project = useQuery(projectQueries.getBySlug(projectSlug));
  const pages = useQuery({
    ...pageQueries.list(project.data?.id ?? 0),
    enabled: !!project.data,
  });
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
  const canvasPages = getCanvasPages(pages.data, app.getLayouts());
  const selectedPage = selectedCanvasPage(
    canvasPages,
    app.getLayouts(),
    selectedCanvasPath(location.pathname),
  );
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <CanvasLeftSidebar page={selectedPage} />
      <CanvasWorkspace
        key={project.data.id}
        pages={canvasPages}
        selectedPage={selectedPage}
        runtimeBasePath={runtimeBasePath}
      />
      <CanvasRightSidebar page={selectedPage} />
    </div>
  );
}
