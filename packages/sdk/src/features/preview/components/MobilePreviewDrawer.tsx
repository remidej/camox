import { Button } from "@camox/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { ArrowLeft, FileText, Info, Layers, Search, Settings } from "lucide-react";
import * as React from "react";

import { useAuthContext } from "@/lib/auth";
import { projectQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { UserButton } from "../../studio/components/UserButton";
import { previewStore, selectionBlockId } from "../previewStore";
import { AddBlockSidebar } from "./AddBlockSidebar";
import { PageEditorSidebar } from "./PageEditorSidebar";
import { PageInfoSidebar, PageMarkdownContent, PageSeoContent } from "./PageInfoSidebar";
import { PageNavigatorHeader, type PreviewedPage } from "./PageNavigatorSidebar";
import { PageTree } from "./PageTree";

const COLLAPSED_HEIGHT = 80;
const DRAG_THRESHOLD = 4;

type DrawerScreen = "root" | "blocks" | "about" | "seo" | "markdown";

const screenTitles = {
  root: "Page",
  blocks: "Page content",
  about: "About this page",
  seo: "SEO metadata",
  markdown: "Page markdown",
} satisfies Record<DrawerScreen, string>;

export function MobilePreviewDrawer({
  page,
  projectName,
}: {
  page: PreviewedPage;
  projectName: string;
}) {
  const [height, setHeight] = React.useState(COLLAPSED_HEIGHT);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [screen, setScreen] = React.useState<DrawerScreen>("root");
  const authCtx = useAuthContext();
  const { data: project } = useQuery(projectQueries.getBySlug(authCtx.projectSlug));
  const dragStartRef = React.useRef({ y: 0, height: COLLAPSED_HEIGHT });
  const dragDistanceRef = React.useRef(0);
  const rootContentRef = React.useRef<HTMLDivElement>(null);
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const isAddBlockSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSidebarOpen,
  );
  const selectedBlockId = selectionBlockId(selection);
  const isContentScreen = selectedBlockId != null || isAddBlockSidebarOpen;
  const isTileScreen = screen !== "root" || isContentScreen;
  const showScreenHeader = isExpanded && isTileScreen;
  const getExpandedHeight = React.useCallback(() => {
    if (typeof window === "undefined") return 720;
    if (isTileScreen) return window.innerHeight;

    const contentHeight = rootContentRef.current?.getBoundingClientRect().height ?? 0;
    return Math.max(
      COLLAPSED_HEIGHT,
      Math.min(window.innerHeight, COLLAPSED_HEIGHT + contentHeight + 2),
    );
  }, [isTileScreen]);

  const goBack = () => {
    if (isContentScreen) {
      previewStore.send({ type: "clearSelection" });
      previewStore.send({ type: "closeAddBlockSidebar" });
      setScreen("blocks");
      return;
    }
    setScreen("root");
  };

  const snapTo = React.useCallback(
    (expanded: boolean) => {
      setIsExpanded(expanded);
      setHeight(expanded ? getExpandedHeight() : COLLAPSED_HEIGHT);
    },
    [getExpandedHeight],
  );

  React.useEffect(() => {
    setScreen("root");
  }, [page.id]);

  React.useEffect(() => {
    const handleResize = () => {
      if (!isExpanded || isDragging) return;
      setHeight(getExpandedHeight());
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (rootContentRef.current) observer.observe(rootContentRef.current);
    window.addEventListener("resize", handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [isExpanded, isDragging, getExpandedHeight]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { y: event.clientY, height };
    dragDistanceRef.current = 0;
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

    const distance = dragStartRef.current.y - event.clientY;
    dragDistanceRef.current = distance;
    const nextHeight = dragStartRef.current.height + distance;
    setHeight(Math.min(getExpandedHeight(), Math.max(COLLAPSED_HEIGHT, nextHeight)));
  };

  const finishDrag = (
    event: React.PointerEvent<HTMLElement>,
    onTap = () => snapTo(!isExpanded),
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsDragging(false);
    const distance = dragDistanceRef.current;
    if (Math.abs(distance) < DRAG_THRESHOLD) {
      onTap();
      return;
    }

    if (isExpanded && distance < -40) {
      snapTo(false);
      return;
    }

    const draggedHeight = dragStartRef.current.height + distance;
    const midpoint = (COLLAPSED_HEIGHT + getExpandedHeight()) / 2;
    snapTo(draggedHeight >= midpoint);
  };

  const cancelDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    snapTo(isExpanded);
  };

  return (
    <section
      className="bg-background relative z-10 w-full shrink-0 overflow-hidden border-t-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
      style={{
        height,
        transition: isDragging ? "none" : "height 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-label="Project drawer"
    >
      {showScreenHeader ? (
        <header
          className="relative h-12 touch-none border-b px-3 pt-2.5 pb-1.5 select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishDrag(event, goBack)}
          onPointerCancel={cancelDrag}
        >
          <span className="bg-muted-foreground/60 absolute top-1 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full" />
          <button
            type="button"
            onClick={(event) => {
              if (event.detail === 0) goBack();
            }}
            className="hover:bg-accent flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold"
            aria-label={isContentScreen ? "Back to page content" : "Back to page overview"}
          >
            <ArrowLeft className="text-muted-foreground size-4" />
            {isContentScreen ? screenTitles.blocks : screenTitles[screen]}
          </button>
        </header>
      ) : (
        <div className="relative h-20">
          <button
            type="button"
            className="relative flex h-20 w-full touch-none items-center px-5 pt-2 pr-20 text-left select-none"
            aria-controls="camox-mobile-drawer-content"
            aria-expanded={isExpanded}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => finishDrag(event)}
            onPointerCancel={cancelDrag}
            onClick={(event) => {
              if (event.detail === 0) snapTo(!isExpanded);
            }}
          >
            <span className="bg-muted-foreground/60 absolute top-2 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full" />
            <span className="truncate pr-4 text-sm font-medium">{projectName}</span>
          </button>
          <div className="absolute top-6 right-5">
            <UserButton />
          </div>
        </div>
      )}
      <div
        id="camox-mobile-drawer-content"
        inert={!isExpanded}
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          isTileScreen && "pb-[env(safe-area-inset-bottom)]",
          showScreenHeader ? "h-[calc(100%-3rem)]" : "h-[calc(100%-5rem)]",
        )}
      >
        {selectedBlockId != null ? (
          <PageEditorSidebar />
        ) : isAddBlockSidebarOpen ? (
          <AddBlockSidebar />
        ) : (
          <div key={screen} className="min-h-0 flex-1 overflow-auto">
            {screen === "root" && (
              <div ref={rootContentRef} className="pb-[env(safe-area-inset-bottom)]">
                <PageNavigatorHeader page={page} />
                <div className="px-3 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={page.status === "published" || page.livePublishedCheckpointId == null}
                    onClick={() => previewStore.send({ type: "viewLivePage" })}
                  >
                    View live site
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  <DrawerTile
                    title="Page content"
                    icon={Layers}
                    onClick={() => setScreen("blocks")}
                    fullWidth
                  />
                  <DrawerTile
                    title="About this page"
                    icon={Info}
                    onClick={() => setScreen("about")}
                  />
                  <DrawerTile title="SEO metadata" icon={Search} onClick={() => setScreen("seo")} />
                  <DrawerTile
                    title="Page markdown"
                    icon={FileText}
                    onClick={() => setScreen("markdown")}
                  />
                  <DrawerTile
                    title="Project settings"
                    icon={Settings}
                    onClick={() => {
                      if (!project) return;
                      window.open(
                        `${authCtx.authenticationUrl}/${project.organizationSlug}/${project.slug}/overview`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    disabled={!project}
                  />
                </div>
              </div>
            )}
            {screen === "blocks" && (
              <div className="flex flex-col gap-2 p-2">
                <PageTree />
              </div>
            )}
            {screen === "about" && (
              <PageInfoSidebar pageId={page.id} scrollable={false} aboutOnly />
            )}
            {screen === "seo" && (
              <div className="p-3">
                <PageSeoContent pageId={page.id} />
              </div>
            )}
            {screen === "markdown" && (
              <div className="space-y-4 p-3">
                <p className="text-muted-foreground text-sm">
                  How your content will be served to AI agents.
                </p>
                <PageMarkdownContent pageId={page.id} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DrawerTile({
  title,
  icon: Icon,
  onClick,
  fullWidth = false,
  disabled = false,
}: {
  title: string;
  icon: typeof Layers;
  onClick: () => void;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "bg-muted/40 hover:bg-muted flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        fullWidth && "col-span-2",
      )}
    >
      <Icon className="text-muted-foreground size-5" />
      <span className="mt-3 text-xs font-medium">{title}</span>
    </button>
  );
}
