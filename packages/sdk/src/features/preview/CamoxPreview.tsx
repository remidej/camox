import { queryKeys, type ReadSource } from "@camox/api-contract/query-keys";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { useLocation, useNavigate } from "@/features/navigation/navigation";
import { getApiClient } from "@/lib/api-client";
import { useIsAuthenticated, useProjectSlug } from "@/lib/auth";
import { NormalizedDataProvider, seedBlockCaches, usePageBlocks } from "@/lib/normalized-data";
import { blockQueries, pageQueries, projectQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { type Action, actionsStore } from "../provider/actionsStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { SharedChromeContext } from "../runtime/SharedChromeContext";
import { Navbar } from "../studio/components/Navbar";
import { BlockErrorBoundary } from "./components/BlockErrorBoundary";
import { CreatePageModal } from "./components/CreatePageModal";
import { DraftSwitchDialog } from "./components/DraftSwitchDialog";
import { LeftSidebar } from "./components/LeftSidebar";
import { PeekedBlock } from "./components/PeekedBlock";
import { PreviewPanel } from "./components/PreviewPanel";
import { RightSidebar } from "./components/RightSidebar";
import { EDIT_MODE_SHORTCUT } from "./previewConstants";
import { pageFullQueryFn } from "./previewQueryFns";
import { previewStore } from "./previewStore";

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

/**
 * Fetches the current page being previewed, with live updates for authenticated users.
 * Also will switch to peeked page data if there is one.
 *
 * Data for the current route is guaranteed in queryClient cache from the loader's
 * ensureQueryData. Live updates are gated by useProjectRoom only running in
 * AuthenticatedCamoxProvider — unauthenticated users get SSR data that never refetches.
 */
/**
 * Lightweight queryFn for client-side refetches — only fetches structural data.
 * Used after initial SSR load when block caches are already populated.
 *
 * Source is threaded from the studio's source select (previewStore). Each
 * source has its own cache slot, so toggling Draft↔Live is instant once both
 * have been seeded. Public visitors never invalidate (no project room) so
 * this query function doesn't run for them — they stay on the SSR-seeded
 * 'live' data.
 */
function pageStructureQueryFn(path: string, projectSlug: string, source: ReadSource) {
  return () => getApiClient().pages.getStructure({ path, projectSlug, source });
}

export function usePreviewedPage() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const projectSlug = useProjectSlug();
  const peekedPagePathname = useSelector(previewStore, (state) => state.context.peekedPagePathname);
  const previewSource = useSelector(previewStore, (state) => state.context.previewSource);

  // When the actual route changes, clear any stale peeked page so it doesn't
  // override the new pathname. This handles the race condition where the
  // PagePicker's Command `onValueChange` fires after `clearPeekedPage`.
  const prevPathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      previewStore.send({ type: "clearPeekedPage" });
    }
  }, [pathname]);

  // Current page: SSR loader seeds block caches on first load (both 'live'
  // and 'draft' slots, so the studio's default 'draft' view has data even
  // before the first edit). Client-side refetches (after invalidation) use
  // the lightweight endpoint.
  const { data: currentPage } = useSuspenseQuery({
    queryKey: queryKeys.pages.getByPath(pathname, previewSource),
    queryFn: pageStructureQueryFn(pathname, projectSlug, previewSource),
    staleTime: Infinity,
  });

  // Peeked page: uses full endpoint to seed block caches on first fetch,
  // since those blocks may not be in cache yet.
  const isAuthenticated = useIsAuthenticated();
  const { data: peekedPage } = useQuery({
    queryKey: queryKeys.pages.getByPath(peekedPagePathname ?? "", previewSource),
    queryFn: pageFullQueryFn(queryClient, peekedPagePathname ?? "", projectSlug, previewSource),
    enabled: isAuthenticated && !!peekedPagePathname,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

  return peekedPagePathname ? (peekedPage ?? currentPage) : currentPage;
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
  blockId: number;
  mode: "site" | "peek" | "layout";
  showAddBlockTop: boolean;
  showAddBlockBottom: boolean;
}) => {
  const previewSource = useSelector(previewStore, (state) => state.context.previewSource);
  const { data } = useSuspenseQuery(blockQueries.get(blockId, previewSource));
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(data.block.type);

  if (!blockDef) return null;

  return (
    <NormalizedDataProvider files={data.files} repeatableItems={data.repeatableItems}>
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
  const previewSource = useSelector(previewStore, (state) => state.context.previewSource);
  const { pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems } = usePageBlocks(
    pageData,
    previewSource,
  );
  const peekedBlockPosition = useSelector(
    previewStore,
    (state) => state.context.peekedBlockPosition,
  );

  // Latch the last non-null position so the block doesn't jump during collapse
  const displayedPositionRef = React.useRef<string | null>(null);
  if (peekedBlockPosition !== null) {
    displayedPositionRef.current = peekedBlockPosition;
  }
  const effectivePosition = peekedBlockPosition ?? displayedPositionRef.current;

  const onExitComplete = React.useCallback(() => {
    displayedPositionRef.current = null;
  }, []);

  const camoxApp = useCamoxApp();

  // Find the index where the peeked block should be inserted
  // If effectivePosition is null, insert at the end
  // If effectivePosition is "", insert at the beginning
  const peekedBlockIndex = React.useMemo(() => {
    if (effectivePosition === "") {
      return 0; // Insert at the beginning
    }

    if (effectivePosition === null) {
      return pageBlocks.length; // Insert at the end
    }

    // Find the index after the block with the matching position
    const afterBlockIndex = pageBlocks.findIndex(
      (block) => String(block.position) === effectivePosition,
    );

    if (afterBlockIndex === -1) {
      // Position not found, insert at the end
      return pageBlocks.length;
    }

    // Insert after the found block
    return afterBlockIndex + 1;
  }, [pageBlocks, effectivePosition]);

  // Look up layout
  const layout = pageData.layout ? camoxApp.getLayoutById(pageData.layout.layoutId) : undefined;

  // Build layout block data map by type
  const layoutBlocksMap = React.useMemo(() => {
    if (!pageData.layout) return null;
    const allLayoutBlocks = [...beforeBlocks, ...afterBlocks];
    const blocks: Record<
      string,
      {
        _id: number;
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
      {/* Render peeked block at the beginning if it should be before the first block */}
      {peekedBlockIndex === 0 && pageBlocks.length > 0 && (
        <PeekedBlock onExitComplete={onExitComplete} />
      )}
      {pageBlocks.map((blockData, index) => (
        <React.Fragment key={blockData.id}>
          <BlockErrorBoundary blockId={blockData.id} blockType={blockData.type}>
            <BlockRenderer
              blockId={blockData.id}
              mode="site"
              showAddBlockTop={
                index === 0
                  ? (layout?._internal.blockDefinitions.some((b) => b.placement === "before") ??
                    false)
                  : true
              }
              showAddBlockBottom={true}
            />
          </BlockErrorBoundary>
          {/* Render peeked block after this block if this is the insertion point */}
          {index === peekedBlockIndex - 1 && <PeekedBlock onExitComplete={onExitComplete} />}
        </React.Fragment>
      ))}
      {/* Render peeked block at the end if there are no blocks */}
      {pageBlocks.length === 0 && <PeekedBlock onExitComplete={onExitComplete} />}
    </>
  );

  if (layout && layoutBlocksMap) {
    const LayoutComponent = layout._internal.component;
    return (
      <NormalizedDataProvider files={layoutFiles} repeatableItems={layoutItems}>
        <layout._internal.Provider layoutBlocks={layoutBlocksMap}>
          <LayoutComponent>{pageBlocksContent}</LayoutComponent>
        </layout._internal.Provider>
      </NormalizedDataProvider>
    );
  }

  return <main className="flex min-h-screen flex-col">{pageBlocksContent}</main>;
};

/* -------------------------------------------------------------------------------------------------
 * useHydrateDraftCache
 *
 * SSR seeds the `'draft'` cache slot with the live snapshot data so the studio
 * can render immediately on first paint without a Suspense flash. That seed
 * is stale the moment there's an unpublished edit, though — on refresh the
 * studio would silently re-render the published version and the user's
 * in-flight changes would disappear from view (the row in the DB is fine).
 *
 * After the initial paint, fetch the real draft data and re-seed the draft
 * caches. From there, every block invalidation keeps the slot in sync. Only
 * runs for authenticated users — public visitors stay on the live cache.
 * -----------------------------------------------------------------------------------------------*/

function useHydrateDraftCache() {
  const isAuthenticated = useIsAuthenticated();
  const queryClient = useQueryClient();
  const projectSlug = useProjectSlug();
  const { pathname } = useLocation();

  React.useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void getApiClient()
      .pages.getByPath({ path: pathname, projectSlug, source: "draft" })
      .then((data) => {
        if (cancelled) return;
        seedBlockCaches(queryClient, data, "draft");
        queryClient.setQueryData(queryKeys.pages.getByPath(pathname, "draft"), {
          page: data.page,
          layout: data.layout,
          projectName: data.projectName,
          project: data.project,
        });
      })
      .catch(() => {
        // A draft fetch failure (network blip, 404 on a just-deleted page) is
        // non-fatal — the SSR-seeded view stays on screen and the next edit
        // invalidation will retry. Throwing here would break the studio for a
        // transient error.
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, pathname, projectSlug, queryClient]);
}

/* -------------------------------------------------------------------------------------------------
 * CamoxPreview
 * -----------------------------------------------------------------------------------------------*/

export const CamoxPreview = ({ children }: { children: React.ReactNode }) => {
  const pageData = usePreviewedPage();
  useHydrateDraftCache();
  return <PreviewShell pageData={pageData}>{children}</PreviewShell>;
};

/** Studio chrome is shared; only curated previews require a Camox page record. */
export const PreviewShell = ({
  children,
  pageData,
  hasLiveVersion = false,
  derivedLayoutId,
}: {
  children: React.ReactNode;
  pageData?: ReturnType<typeof usePreviewedPage>;
  hasLiveVersion?: boolean;
  derivedLayoutId?: string;
}) => {
  const isAuthenticated = useIsAuthenticated();
  const isMobileStudio = useIsMobileStudio();
  const sharedChrome = React.useContext(SharedChromeContext);
  const isEditMode = useSelector(previewStore, (state) => state.context.isEditMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  const isAddBlockSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isAddBlockSidebarOpen,
  );
  const previewSource = useSelector(previewStore, (state) => state.context.previewSource);

  // Gate "Preview live content" on a published snapshot existing — same rule
  // as the sidebar Switch. Without it, flipping to 'live' would Suspense on
  // an empty cache slot.
  const hasLiveCheckpoint = pageData
    ? pageData.page.livePublishedCheckpointId != null
    : hasLiveVersion;

  React.useEffect(() => {
    if (!isMobileStudio) return;
    previewStore.send({ type: "exitEditMode" });
    previewStore.send({ type: "closeAddBlockSidebar" });
  }, [isMobileStudio]);

  React.useEffect(() => {
    const actions = [
      {
        id: "exit-edit-mode",
        label: "Exit edit mode",
        aliases: ["Hide Camox Studio", "Hide studio", "Preview only", "View mode"],
        groupLabel: "Preview",
        checkIfAvailable: () => isAuthenticated && isEditMode,
        execute: () => previewStore.send({ type: "exitEditMode" }),
        shortcut: EDIT_MODE_SHORTCUT,
      },
      {
        id: "enter-edit-mode",
        label: "Enter edit mode",
        aliases: ["Show Camox Studio", "Show studio", "Edit mode"],
        groupLabel: "Preview",
        checkIfAvailable: () => isAuthenticated && !isEditMode && !isMobileStudio,
        execute: () => previewStore.send({ type: "enterEditMode" }),
        shortcut: EDIT_MODE_SHORTCUT,
      },
      {
        id: "preview-live-content",
        label: "Preview live content",
        aliases: ["Live", "View live", "Published content"],
        groupLabel: "Preview",
        checkIfAvailable: () => isAuthenticated && previewSource === "draft" && hasLiveCheckpoint,
        execute: () => previewStore.send({ type: "setPreviewSource", source: "live" }),
        shortcut: { key: "d", withAlt: true },
      },
      {
        id: "preview-draft-content",
        label: "Preview draft content",
        aliases: ["Draft", "View draft", "Unpublished content"],
        groupLabel: "Preview",
        checkIfAvailable: () => isAuthenticated && previewSource === "live",
        execute: () => previewStore.send({ type: "setPreviewSource", source: "draft" }),
        shortcut: { key: "d", withAlt: true },
      },
      {
        id: "clear-selection",
        label: "Clear selection",
        aliases: ["Deselect", "Unselect"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => {
          previewStore.send({ type: "clearSelection" });
        },
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
  }, [isEditMode, isAuthenticated, isMobileStudio, previewSource, hasLiveCheckpoint]);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        "bg-background flex flex-col overflow-hidden",
        sharedChrome ? "h-full" : "h-screen",
        !isEditMode && "bg-black",
      )}
    >
      {!sharedChrome && !isMobileStudio && !isToolbarHidden && (
        <div className="relative">
          <Navbar isPreview />
          {pageData && isAddBlockSidebarOpen && (
            <div
              className="absolute inset-0 z-20"
              style={{ background: "rgba(0, 0, 0, 0.66)" }}
              onClick={() => previewStore.send({ type: "closeAddBlockSidebar" })}
            />
          )}
        </div>
      )}
      <div className="flex h-full flex-row items-stretch">
        {!isMobileStudio && isEditMode && pageData && <LeftSidebar page={pageData.page} />}
        <PreviewPanel
          isMobileExperience={isMobileStudio}
          page={pageData?.page}
          projectName={pageData?.projectName}
          toolbarProps={{
            pageStatus: pageData?.page.status,
            hasLiveVersion: hasLiveCheckpoint,
          }}
        >
          {children}
          {!isMobileStudio && isEditMode && (
            <div style={{ height: "80px", background: "transparent" }} />
          )}
        </PreviewPanel>
        {!isMobileStudio && isEditMode && (
          <RightSidebar pageId={pageData?.page.id} derivedLayoutId={derivedLayoutId} />
        )}
      </div>
      {(isMobileStudio || isEditMode) && (
        <>
          <CreatePageModal />
          <DraftSwitchDialog />
        </>
      )}
    </div>
  );
};

export function usePreviewPagesActions() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: pages } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });

  React.useEffect(() => {
    const GO_TO_PAGE_ID = "go-to-page";
    const currentPage = pages?.find((p) => p.fullPath === pathname);

    const actions: Action[] = [
      {
        id: "create-page",
        label: "Create page",
        aliases: ["New page", "Add page"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "openCreatePageModal" }),
      },
      {
        id: "edit-current-page",
        label: "Edit current page",
        aliases: ["Page settings", "Edit page settings", "Page metadata"],
        groupLabel: "Preview",
        checkIfAvailable: () => !!currentPage,
        execute: () => {
          if (!currentPage) return;
          previewStore.send({
            type: "openEditPageModal",
            pageId: currentPage.id,
          });
        },
      },
      {
        id: GO_TO_PAGE_ID,
        label: "Go to page",
        aliases: ["Open page", "Navigate page", "Switch page"],
        groupLabel: "Preview",
        checkIfAvailable: () => !!pages,
        hasChildren: true,
        execute: () => {},
      },
      // One action per page
      ...(pages
        ? pages.map(
            (page) =>
              ({
                id: `go-to-page-${page.id}`,
                parentActionId: GO_TO_PAGE_ID,
                label: `Go to "${page.nickname}"`,
                groupLabel: "Preview",
                checkIfAvailable: () => true,
                execute: () => navigate({ to: page.fullPath }),
              }) as Action,
          )
        : []),
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
