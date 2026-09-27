import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@camox/ui/popover";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useAuthContext, useProjectSlug } from "../../lib/auth";
import { pageQueries, projectQueries } from "../../lib/queries";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { runtimePath } from "../runtime/navigationTarget";
import type { PageRenderInput } from "../runtime/runtime";
import { CANVAS_HEADER_HEIGHT } from "./canvasCamera";
import { CanvasPageFrame } from "./CanvasPageFrame";
import {
  CANVAS_DEVICES,
  getCanvasPages,
  validateCanvasPageInput,
  type CanvasPage,
} from "./canvasPages";
import { TemplateInstanceInput } from "./TemplateInstanceInput";
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

function CanvasPageHeader({
  page,
  pathname,
  onChange,
}: {
  page: CanvasPage;
  pathname: string | null;
  onChange: (pathname: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const path = pathname ?? page.pattern;
  const headerClassName = "text-foreground flex h-10 w-full min-w-0 items-center gap-3 text-left";
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={page.title}>
        {page.title}
      </span>
      <span
        data-canvas-path
        className="text-foreground hidden max-w-1/2 min-w-0 truncate text-right text-xs font-normal @min-[20rem]/canvas-header:block"
        title={path}
      >
        {path}
      </span>
    </>
  );
  if (!page.templateId) return <h2 className={headerClassName}>{content}</h2>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <h2>
        <PopoverTrigger
          aria-label={`Edit instance path for ${page.title}`}
          className={`${headerClassName} focus-visible:ring-ring outline-none focus-visible:ring-2`}
        >
          {content}
        </PopoverTrigger>
      </h2>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)]" align="start">
        <PopoverTitle>Preview {page.title}</PopoverTitle>
        <TemplateInstanceInput
          page={page}
          pathname={pathname}
          onChange={(path) => {
            onChange(path);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
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
  runtimeBasePath,
}: {
  pages: CanvasPage[];
  runtimeBasePath: string;
}) {
  const { apiUrl, projectSlug, environmentName } = useAuthContext();
  const workspaceKey = JSON.stringify([
    apiUrl,
    projectSlug,
    environmentName ?? "production",
    runtimeBasePath,
  ]);
  const { viewportRef, contentRef } = useCanvasCamera(workspaceKey);
  const [pathnames, setPathnames] = React.useState<Partial<Record<string, string>>>({});
  const positionedPages = pages.map((page, index) => ({
    page,
    pathname: pathnames[page.key] ?? page.pathname,
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
      className="bg-muted relative min-h-0 w-full flex-1 touch-none overflow-clip outline-none"
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
            onChange={(path) => setPathnames((current) => ({ ...current, [page.key]: path }))}
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
  return (
    <CanvasWorkspace
      key={project.data.id}
      pages={getCanvasPages(pages.data, app.getLayouts())}
      runtimeBasePath={runtimeBasePath}
    />
  );
}
