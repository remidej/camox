import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { CollectionItemModalProvider } from "@/features/content/CollectionItemModalContext";
import { ContentCollectionItemModal } from "@/features/content/ContentCollection";
import { type LocationState, useLocation, useNavigate } from "@/features/navigation/navigation";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { useIsAuthenticated, useProjectSlug } from "@/lib/auth";
import { NormalizedDataProvider, usePageBlocks } from "@/lib/normalized-data";
import { cn } from "@/lib/utils";

import { useCurrentDraftId } from "../../lib/draft-scope";
import {
  reads,
  type LayoutStructure,
  type Read,
  useRead,
  useStudioCache,
} from "../../lib/studio-reads";
import { canvasStore } from "../canvas/canvasStore";
import { CanvasSidebarSkeleton } from "../canvas/sidebar/CanvasSidebarSkeleton";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { type Action, actionsStore } from "../provider/actionsStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import type { PageStructure } from "../routes/pageRuntime";
import type { PageRenderInput } from "../runtime/runtime";
import { STUDIO_CANVAS_PATH } from "../studio/routes";
import { AddBlockDialog } from "./components/AddBlockDialog";
import { BlockErrorBoundary } from "./components/BlockErrorBoundary";
import { CanvasPreview, prefetchCanvas } from "./components/CanvasPreview";
import { CreatePageModal } from "./components/CreatePageModal";
import { PreviewPanel } from "./components/PreviewPanel";
import { RemovedBlockPlaceholder } from "./components/RemovedBlockPlaceholder";
import {
  getPageRecord,
  PageRecordContext,
  useDerivedPageResult,
  useFollowPageRecord,
} from "./pageRecord";
import { TOGGLE_CANVAS_SHORTCUT, SHOW_WHOLE_CANVAS_SHORTCUT } from "./previewConstants";
import { PreviewEditingOwnerContext } from "./previewSelection";
import { previewStore, selectIsCanvasShown, type EditingOwner } from "./previewStore";
import { usePreviewViewportActions } from "./usePreviewViewportActions";

const MOBILE_STUDIO_QUERY = "(max-width: 767px)";

function subscribeToMobileStudio(callback: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_STUDIO_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getMobileStudioSnapshot() {
  return window.matchMedia(MOBILE_STUDIO_QUERY).matches;
}

function useIsMobileStudio() {
  return React.useSyncExternalStore(subscribeToMobileStudio, getMobileStudioSnapshot, () => false);
}

/* -------------------------------------------------------------------------------------------------
 * PageContent
 * -----------------------------------------------------------------------------------------------*/

/** The page the Preview shows: as the server rendered it, then following edits. */
export function usePreviewedPage() {
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  return useRead(reads.pageStructure({ path: pathname, projectSlug }));
}

/* -------------------------------------------------------------------------------------------------
 * BlockRenderer — subscribes to individual block cache for granular re-renders
 * -----------------------------------------------------------------------------------------------*/

const BlockRenderer = ({
  blockId,
  mode,
  showAddBlockTop,
  showAddBlockBottom,
}: {
  blockId: string;
  mode: "site" | "peek" | "layout";
  showAddBlockTop: boolean;
  showAddBlockBottom: boolean;
}) => {
  const data = useRead(reads.blockBundle(blockId));
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(data.block.type);

  if (!blockDef) {
    return <RemovedBlockPlaceholder blockId={blockId} type={data.block.type} mode={mode} />;
  }

  return (
    <NormalizedDataProvider
      files={data.files}
      repeatableItems={data.repeatableItems}
      blocks={[data.block]}
    >
      <blockDef._internal.Component
        blockData={{
          _id: data.block.id,
          type: data.block.type,
          content: data.block.content as Record<string, unknown>,
          settings: data.block.settings as Record<string, unknown> | undefined,
          position: String(data.block.position),
        }}
        mode={mode}
        showAddBlockTop={showAddBlockTop}
        showAddBlockBottom={showAddBlockBottom}
      />
    </NormalizedDataProvider>
  );
};

/* -------------------------------------------------------------------------------------------------
 * PageContent
 * -----------------------------------------------------------------------------------------------*/

export const PageContent = () => {
  const pageData = usePreviewedPage();
  const { pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems } =
    usePageBlocks(pageData);

  const camoxApp = useCamoxApp();

  // Look up layout
  const layout = pageData.layout ? camoxApp.getLayoutById(pageData.layout.layoutId) : undefined;

  // Build layout block data map by type
  const layoutBlocksMap = React.useMemo(() => {
    if (!pageData.layout) return null;
    const allLayoutBlocks = [...beforeBlocks, ...afterBlocks];
    const blocks: Record<
      string,
      {
        _id: string;
        type: string;
        content: Record<string, unknown>;
        settings?: Record<string, unknown>;
        position: string;
      }
    > = {};
    for (const block of allLayoutBlocks) {
      blocks[block.type] = {
        _id: block.id,
        type: block.type,
        content: block.content as Record<string, unknown>,
        settings: block.settings as Record<string, unknown> | undefined,
        position: String(block.position),
      };
    }
    return blocks;
  }, [pageData.layout, beforeBlocks, afterBlocks]);

  const pageBlocksContent = (
    <>
      {pageBlocks.map((blockData, index) => (
        <BlockErrorBoundary key={blockData.id} blockId={blockData.id} blockType={blockData.type}>
          <BlockRenderer
            blockId={blockData.id}
            mode="site"
            showAddBlockTop={
              index === 0
                ? (layout?._internal.blockDefinitions.some((b) => b.slot === "before") ?? false)
                : true
            }
            showAddBlockBottom={true}
          />
        </BlockErrorBoundary>
      ))}
    </>
  );

  if (layout && layoutBlocksMap) {
    const LayoutComponent = layout._internal.component;
    return (
      <NormalizedDataProvider
        files={layoutFiles}
        repeatableItems={layoutItems}
        blocks={[...beforeBlocks, ...afterBlocks]}
      >
        <layout._internal.Provider layoutBlocks={layoutBlocksMap}>
          <LayoutComponent>{pageBlocksContent}</LayoutComponent>
        </layout._internal.Provider>
      </NormalizedDataProvider>
    );
  }

  return <main className="flex min-h-screen flex-col">{pageBlocksContent}</main>;
};

/* -------------------------------------------------------------------------------------------------
 * useRefreshMemberRead
 *
 * The server may have rendered the page before the studio authenticated, so
 * linked collection records show their published content. Project members
 * read their saved drafts instead: after the initial paint, load the page or
 * layout page's layout again with the session, filling its blocks' reads. From there, every block
 * invalidation keeps them in sync. Only runs for authenticated users.
 * -----------------------------------------------------------------------------------------------*/

/**
 * The read of the page the Preview shows: a curated page's structure, or a layout page's layout. A
 * Canvas-only location, opened first, has no page to show.
 */
function pageRead(
  projectSlug: string,
  pathname: string | undefined,
  derived: PageRenderInput["derived"] | undefined,
): Read<PageStructure | LayoutStructure, unknown> | null {
  if (pathname === undefined) return null;
  if (derived) return reads.layoutStructure({ projectSlug, layoutId: derived.layoutId });
  return reads.pageStructure({ path: pathname, projectSlug });
}

function useRefreshMemberRead(read: Read<unknown, unknown> | null) {
  const isAuthenticated = useIsAuthenticated();
  const studioCache = useStudioCache();
  const draftId = useCurrentDraftId();
  const identity = read
    ? JSON.stringify(studioCache.options(read, { in: draftId }).queryKey)
    : null;
  const reload = React.useEffectEvent(() => {
    if (!isAuthenticated || !read) return;
    // The read lands in the draft it was made in, even if the studio moves meanwhile.
    void studioCache.reload(read).catch(() => {
      // A fetch failure (network blip, 404 on a just-deleted page) is
      // non-fatal — the SSR-seeded view stays on screen and the next edit
      // invalidation will retry. Throwing here would break the studio for a
      // transient error.
    });
  });
  React.useEffect(() => reload(), [identity, isAuthenticated]);
}

/* -------------------------------------------------------------------------------------------------
 * CamoxPreview
 * -----------------------------------------------------------------------------------------------*/

/** The page the Preview shows, at the location that renders it. */
type ShownPage = { location: LocationState; derived?: PageRenderInput["derived"] };

/**
 * The page the Preview shows: the current one, or on a Canvas-only location,
 * which has none, the last one. The Canvas keeps showing that page in its slot
 * when nothing is selected, so it stays mounted rather than flash as it remounts.
 */
function useShownPage(
  location: LocationState,
  derived: PageRenderInput["derived"],
  canvasOnly: boolean,
): ShownPage | null {
  const [last, setLast] = React.useState<ShownPage | null>(null);
  if (canvasOnly) return last;
  const unchanged =
    !!last &&
    last.location.href === location.href &&
    last.location.pathname === location.pathname &&
    last.derived === derived;
  if (unchanged) return last;
  const current = { location, derived };
  setLast(current);
  return current;
}

export const CamoxPreview = ({
  children,
  runtimeBasePath,
  derived,
  canvasOnly,
}: {
  children: React.ReactNode;
  runtimeBasePath?: string;
  derived?: PageRenderInput["derived"];
  canvasOnly?: PageRenderInput["canvasOnly"];
}) => {
  const camoxApp = useCamoxApp();
  const location = useLocation();
  const shown = useShownPage(location, derived, !!canvasOnly);
  const pathname = shown?.location.pathname;
  const shownDerived = shown?.derived;
  const projectSlug = useProjectSlug();
  // All route kinds resolve through one component so selecting a layout frame, a
  // block, or nothing never remounts the workspace, its camera, or its in-progress selection.
  const shownRead = pageRead(projectSlug, pathname, shownDerived);
  const data = useRead(shownRead);
  useRefreshMemberRead(shownRead);
  // A code-owned page's loader runs again after record edits and publication.
  const derivedResult = useDerivedPageResult({
    projectSlug,
    runtimeBasePath: runtimeBasePath ?? "",
    pathname: pathname ?? location.pathname,
    loaded: shownDerived ? { result: shownDerived.result } : undefined,
  });
  const pageRecord = getPageRecord(derivedResult);
  useFollowPageRecord({
    projectSlug,
    runtimeBasePath: runtimeBasePath ?? "",
    layoutId: shownDerived?.layoutId,
    record: pageRecord,
  });
  const pageData = data && "page" in data ? data : undefined;
  const layout = data && !("page" in data) ? data : undefined;
  return (
    <PageRecordContext value={derivedResult}>
      <PreviewShell
        pageData={pageData}
        derivedLayout={layout}
        pageLocation={shown?.location}
        canvasOnly={canvasOnly}
        runtimeBasePath={runtimeBasePath}
      >
        {shownDerived && layout ? (
          <DerivedPageContent
            camoxApp={camoxApp}
            derived={{ ...shownDerived, layout, result: derivedResult }}
          />
        ) : shown ? (
          children
        ) : null}
      </PreviewShell>
    </PageRecordContext>
  );
};

/**
 * A Canvas-only location only exists on the Canvas. Opening one
 * shows the Canvas, while hiding the Canvas, or a Studio without the Canvas,
 * goes home instead, so Preview always shows a real Page.
 */
function useCanvasOnlyLocation(
  canvasOnly: boolean,
  isCanvasShown: boolean,
  isMobileStudio: boolean,
) {
  const navigate = useNavigate();
  const wasCanvasShown = React.useRef(isCanvasShown);
  React.useEffect(() => {
    const left = wasCanvasShown.current && !isCanvasShown;
    wasCanvasShown.current = isCanvasShown;
    if (!canvasOnly || isCanvasShown) return;
    if (isMobileStudio || left) {
      void navigate({ to: "/", replace: true });
      return;
    }
    previewStore.send({ type: "showCanvas" });
  }, [canvasOnly, isCanvasShown, isMobileStudio, navigate]);
}

/**
 * Once the signed-in Studio is idle, loads what showing the Canvas waits for: its code, and
 * the project and page list it lays out. The first show then skips most of its loading.
 */
function usePrefetchCanvas(enabled: boolean, projectSlug: string) {
  const queryClient = useQueryClient();
  const studioCache = useStudioCache();
  React.useEffect(() => {
    if (!enabled) return;
    const prefetch = async () => {
      prefetchCanvas();
      // Failures go unreported here: the Canvas loads these again when shown, and reports them.
      await queryClient.prefetchQuery(studioCache.options(reads.project({ slug: projectSlug })));
      await queryClient.prefetchQuery(studioCache.options(reads.pageList({ projectSlug })));
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => void prefetch(), { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => void prefetch(), 2000);
    return () => window.clearTimeout(id);
  }, [enabled, projectSlug, queryClient, studioCache]);
}

/** Studio chrome is shared; only curated previews require a Camox page record. */
export const PreviewShell = ({
  children,
  pageData,
  derivedLayout,
  pageLocation,
  canvasOnly,
  runtimeBasePath = "",
}: {
  children: React.ReactNode;
  pageData?: ReturnType<typeof usePreviewedPage>;
  derivedLayout?: LayoutStructure;
  /** Where the shown page renders, when not at the current location. */
  pageLocation?: LocationState;
  canvasOnly?: PageRenderInput["canvasOnly"];
  runtimeBasePath?: string;
}) => {
  const isAuthenticated = useIsAuthenticated();
  const projectSlug = useProjectSlug();
  const isMobileStudio = useIsMobileStudio();
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);
  usePreviewViewportActions();
  const isCanvasEnabled = !isMobileStudio && isCanvasShown;
  usePrefetchCanvas(isAuthenticated && !isMobileStudio, projectSlug);
  const { pathname } = useLocation();

  // A Canvas-only location edits no page, even while the Preview still shows the last one.
  const pageId = canvasOnly ? undefined : pageData?.page.id;
  const layoutId = canvasOnly ? undefined : derivedLayout?.layoutId;
  const editingOwner = React.useMemo<EditingOwner | null>(() => {
    if (pageId != null) return { kind: "page", pageId };
    if (layoutId != null) return { kind: "layout", layoutId };
    return null;
  }, [pageId, layoutId]);

  // Stores outlive this component; studio routes unmount it, so start over on return.
  React.useEffect(
    () => () => {
      previewStore.send({ type: "reset" });
      canvasStore.send({ type: "reset" });
    },
    [],
  );

  React.useEffect(() => {
    if (!isMobileStudio) return;
    previewStore.send({ type: "hideCanvas" });
    previewStore.send({ type: "closeAddBlockDialog" });
  }, [isMobileStudio]);

  useCanvasOnlyLocation(!!canvasOnly && isAuthenticated, isCanvasShown, isMobileStudio);

  React.useEffect(() => {
    const actions = [
      {
        id: "hide-canvas",
        label: "Hide canvas",
        aliases: ["Preview", "Exit edit mode", "Hide Camox Studio", "Hide studio"],
        groupLabel: "Website",
        checkIfAvailable: () => isAuthenticated && isCanvasShown,
        execute: () => previewStore.send({ type: "hideCanvas" }),
        shortcut: TOGGLE_CANVAS_SHORTCUT,
      },
      {
        id: "show-canvas",
        label: "Show canvas",
        aliases: ["Edit mode", "Show Camox Studio", "Show studio"],
        groupLabel: "Website",
        checkIfAvailable: () => isAuthenticated && !isCanvasShown && !isMobileStudio,
        execute: () => previewStore.send({ type: "showCanvas" }),
        shortcut: TOGGLE_CANVAS_SHORTCUT,
      },
      {
        id: "clear-selection",
        label: "Clear selection",
        aliases: ["Deselect", "Unselect"],
        groupLabel: "Website",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "clearSelection" }),
        shortcut: { key: "Escape" },
      },
    ] satisfies Action[];

    actionsStore.send({
      type: "registerManyActions",
      actions,
    });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [isCanvasShown, isAuthenticated, isMobileStudio]);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <CollectionItemModalProvider onRouteTargetClose={() => {}}>
      <PreviewEditingOwnerContext value={editingOwner}>
        <div
          className={cn(
            "bg-background relative flex h-full min-h-0 flex-1 flex-col overflow-hidden",
            !isCanvasShown && "bg-black",
          )}
        >
          <CanvasPreview
            enabled={isCanvasEnabled}
            pathname={pathname}
            pagePathname={pageLocation?.pathname}
            runtimeBasePath={runtimeBasePath}
            placeholder={<CanvasSidebarSkeleton page={!canvasOnly} layoutPage={!!derivedLayout} />}
          >
            <div className="flex min-h-0 flex-1 flex-row items-stretch">
              <PreviewPanel
                active={!isCanvasEnabled}
                isMobileExperience={isMobileStudio}
                page={pageData?.page}
                layoutId={derivedLayout?.layoutId}
                pageLocation={pageLocation}
                projectName={pageData?.projectName}
              >
                {children}
              </PreviewPanel>
            </div>
          </CanvasPreview>
          {!isCanvasEnabled && (
            <>
              <CreatePageModal />
              {pageData && <AddBlockDialog />}
            </>
          )}
        </div>
      </PreviewEditingOwnerContext>
      <ContentCollectionItemModal projectSlug={projectSlug} />
    </CollectionItemModalProvider>
  );
};

/** Zooms out to the whole Canvas, from anywhere in the site or the Studio. */
export function useShowCanvasAction() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobileStudio = useIsMobileStudio();

  React.useEffect(() => {
    const actions = [
      {
        id: "show-whole-canvas",
        label: "Show whole canvas",
        aliases: ["Canvas", "Zoom out", "Canvas overview", "Back to the canvas"],
        groupLabel: "Navigation",
        // The Canvas needs room the mobile Studio doesn't have.
        checkIfAvailable: () => !isMobileStudio,
        execute: () => {
          previewStore.send({ type: "showCanvas" });
          if (pathname !== STUDIO_CANVAS_PATH) void navigate({ to: STUDIO_CANVAS_PATH });
          canvasStore.send({ type: "requestOverview" });
        },
        shortcut: SHOW_WHOLE_CANVAS_SHORTCUT,
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });
    return () => {
      actionsStore.send({ type: "unregisterManyActions", ids: actions.map((a) => a.id) });
    };
  }, [navigate, pathname, isMobileStudio]);
}

export function usePreviewPagesActions() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pages = usePageDestinations();

  React.useEffect(() => {
    const GO_TO_PAGE_ID = "go-to-page";
    const currentPage = pages.find((p) => p.kind === "curated" && p.fullPath === pathname);

    const actions: Action[] = [
      {
        id: "create-page",
        label: "Create page",
        aliases: ["New page", "Add page"],
        groupLabel: "Website",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "openCreatePageModal" }),
      },
      {
        id: "edit-current-page",
        label: "Edit current page",
        aliases: ["Page settings", "Edit page settings", "Page metadata"],
        groupLabel: "Website",
        checkIfAvailable: () => currentPage?.kind === "curated",
        execute: () => {
          if (currentPage?.kind !== "curated") return;
          previewStore.send({
            type: "openEditPageModal",
            pageId: currentPage.pageId,
          });
        },
      },
      {
        id: GO_TO_PAGE_ID,
        label: "Go to page",
        aliases: ["Open page", "Navigate page", "Switch page"],
        groupLabel: "Website",
        checkIfAvailable: () => pages.length > 0,
        hasChildren: true,
        execute: () => {},
      },
      // One action per page
      ...pages.map((page): Action => ({
        id: `go-to-page-${page.key}`,
        parentActionId: GO_TO_PAGE_ID,
        label: `Go to "${page.title}"`,
        aliases: [page.fullPath],
        groupLabel: "Website",
        checkIfAvailable: () => true,
        execute: () => navigate({ to: page.fullPath }),
      })),
    ];

    actionsStore.send({
      type: "registerManyActions",
      actions,
    });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((a) => a.id),
      });
    };
  }, [navigate, pages, pathname]);
}
