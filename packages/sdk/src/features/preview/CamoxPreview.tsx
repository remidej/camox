import { queryKeys } from "@camox/api-contract/query-keys";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { CollectionItemModalProvider } from "@/features/content/CollectionItemModalContext";
import { ContentCollectionItemModal } from "@/features/content/ContentCollection";
import { useLocation, useNavigate } from "@/features/navigation/navigation";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { getApiClient } from "@/lib/api-client";
import { useIsAuthenticated, useProjectSlug } from "@/lib/auth";
import { NormalizedDataProvider, seedBlockCaches, usePageBlocks } from "@/lib/normalized-data";
import { blockQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { scopedKey } from "../../lib/studio-draft";
import { canvasStore } from "../canvas/canvasStore";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { type Action, actionsStore } from "../provider/actionsStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import type { PageStructure } from "../routes/pageRuntime";
import type { PageRenderInput } from "../runtime/runtime";
import { SharedChromeContext } from "../runtime/SharedChromeContext";
import { Navbar } from "../studio/components/Navbar";
import { AddBlockDialog } from "./components/AddBlockDialog";
import { BlockErrorBoundary } from "./components/BlockErrorBoundary";
import { CanvasPreview } from "./components/CanvasPreview";
import { CreatePageModal } from "./components/CreatePageModal";
import type { DerivedLayoutStructure } from "./components/DerivedLayoutSidebar";
import { PreviewPanel } from "./components/PreviewPanel";
import { PreviewToolbar } from "./components/PreviewToolbar";
import { RemovedBlockPlaceholder } from "./components/RemovedBlockPlaceholder";
import {
  getPageRecord,
  PageRecordContext,
  useDerivedPageResult,
  useFollowPageRecord,
} from "./pageRecord";
import { previewCommentsStore } from "./previewCommentsStore";
import { EDIT_MODE_SHORTCUT } from "./previewConstants";
import { PreviewEditingOwnerContext } from "./previewSelection";
import {
  previewStore,
  selectIsCommentMode,
  selectIsEditMode,
  type EditingOwner,
} from "./previewStore";
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

/**
 * Fetches the current page being previewed, with live updates for authenticated users.
 *
 * Data for the current route is guaranteed in queryClient cache from the loader's
 * ensureQueryData. Live updates are gated by useProjectRoom only running in
 * AuthenticatedCamoxProvider — unauthenticated users get SSR data that never refetches.
 */
/**
 * Lightweight queryFn for client-side refetches — only fetches structural data.
 * Used after initial SSR load when block caches are already populated.
 * Public visitors never invalidate (no project room) so this query function
 * doesn't run for them — they stay on the SSR-seeded data.
 */
function pageStructureQueryFn(path: string, projectSlug: string) {
  return () => getApiClient().pages.getStructure({ path, projectSlug });
}

export function usePreviewedPage() {
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();

  // Current page: SSR loader seeds block caches on first load. Client-side
  // refetches (after invalidation) use the lightweight endpoint.
  const { data: currentPage } = useSuspenseQuery({
    queryKey: scopedKey(queryKeys.pages.getByPath(pathname)),
    queryFn: pageStructureQueryFn(pathname, projectSlug),
    staleTime: Infinity,
  });

  return currentPage;
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
  const { data } = useSuspenseQuery(blockQueries.get(blockId));
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
 * useRefreshMemberPage
 *
 * The server may have rendered the page before the studio authenticated, so
 * linked collection records show their published content. Project members
 * read their saved drafts instead: after the initial paint, fetch the page
 * again with the session and re-seed the caches. From there, every block
 * invalidation keeps them in sync. Only runs for authenticated users.
 * -----------------------------------------------------------------------------------------------*/

function useRefreshMemberPage(enabled: boolean) {
  const isAuthenticated = useIsAuthenticated();
  const queryClient = useQueryClient();
  const projectSlug = useProjectSlug();
  const { pathname } = useLocation();

  React.useEffect(() => {
    if (!isAuthenticated || !enabled) return;
    let cancelled = false;
    void getApiClient()
      .pages.getByPath({ path: pathname, projectSlug })
      .then((data) => {
        if (cancelled) return;
        seedBlockCaches(queryClient, data);
        queryClient.setQueryData(scopedKey(queryKeys.pages.getByPath(pathname)), {
          page: data.page,
          layout: data.layout,
          projectName: data.projectName,
          project: data.project,
        });
      })
      .catch(() => {
        // A fetch failure (network blip, 404 on a just-deleted page) is
        // non-fatal — the SSR-seeded view stays on screen and the next edit
        // invalidation will retry. Throwing here would break the studio for a
        // transient error.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, isAuthenticated, pathname, projectSlug, queryClient]);
}

/* -------------------------------------------------------------------------------------------------
 * CamoxPreview
 * -----------------------------------------------------------------------------------------------*/

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
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  const queryClient = useQueryClient();
  // All route kinds resolve through one component so selecting a layout frame, a
  // block, or nothing never remounts the workspace, its camera, or its in-progress selection.
  const { data } = useSuspenseQuery<PageStructure | DerivedLayoutStructure | null>({
    queryKey: canvasOnly
      ? ["camox", "canvas", "canvasOnly"]
      : derived
        ? scopedKey([...queryKeys.layouts.all, "get", projectSlug, derived.layoutId])
        : scopedKey(queryKeys.pages.getByPath(pathname)),
    queryFn: async () => {
      // A Canvas-only location has no page or layout record.
      if (canvasOnly) return null;
      if (!derived) return pageStructureQueryFn(pathname, projectSlug)();
      const result = await getApiClient().layouts.get({ projectSlug, layoutId: derived.layoutId });
      seedBlockCaches(queryClient, result);
      return result.layout;
    },
    initialData: canvasOnly ? null : derived?.layout,
    staleTime: derived ? 0 : Infinity,
  });
  useRefreshMemberPage(!derived && !canvasOnly);
  // A code-owned page's loader runs again after record edits and publication.
  const derivedResult = useDerivedPageResult({
    projectSlug,
    runtimeBasePath: runtimeBasePath ?? "",
    pathname,
    loaded: derived ? { result: derived.result } : undefined,
  });
  const pageRecord = getPageRecord(derivedResult);
  useFollowPageRecord({
    projectSlug,
    runtimeBasePath: runtimeBasePath ?? "",
    layoutId: derived?.layoutId,
    record: pageRecord,
  });
  const pageData = data && "page" in data ? data : undefined;
  const layout = data && !("page" in data) ? data : undefined;
  return (
    <PageRecordContext value={derivedResult}>
      <PreviewShell
        pageData={pageData}
        derivedLayout={layout}
        canvasOnly={canvasOnly}
        runtimeBasePath={runtimeBasePath}
      >
        {derived && layout ? (
          <DerivedPageContent
            camoxApp={camoxApp}
            derived={{ ...derived, layout, result: derivedResult }}
          />
        ) : (
          children
        )}
      </PreviewShell>
    </PageRecordContext>
  );
};

/**
 * A Canvas-only location only exists on the Canvas, in Edit Mode. Opening one
 * enters Edit Mode, while leaving Edit Mode, or a Studio without the Canvas,
 * goes home instead, so Preview always shows a real Page.
 */
function useCanvasOnlyEditMode(canvasOnly: boolean, isEditMode: boolean, isMobileStudio: boolean) {
  const navigate = useNavigate();
  const wasEditMode = React.useRef(isEditMode);
  React.useEffect(() => {
    const left = wasEditMode.current && !isEditMode;
    wasEditMode.current = isEditMode;
    if (!canvasOnly || isEditMode) return;
    if (isMobileStudio || left) {
      void navigate({ to: "/", replace: true });
      return;
    }
    previewStore.send({ type: "enterEditMode" });
  }, [canvasOnly, isEditMode, isMobileStudio, navigate]);
}

/** Studio chrome is shared; only curated previews require a Camox page record. */
export const PreviewShell = ({
  children,
  pageData,
  derivedLayout,
  canvasOnly,
  runtimeBasePath = "",
}: {
  children: React.ReactNode;
  pageData?: ReturnType<typeof usePreviewedPage>;
  derivedLayout?: DerivedLayoutStructure;
  canvasOnly?: PageRenderInput["canvasOnly"];
  runtimeBasePath?: string;
}) => {
  const isAuthenticated = useIsAuthenticated();
  const projectSlug = useProjectSlug();
  const isMobileStudio = useIsMobileStudio();
  const sharedChrome = React.useContext(SharedChromeContext);
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const isToolbarHidden = useSelector(previewStore, (state) => state.context.isToolbarHidden);
  usePreviewViewportActions();
  const showCanvas = !isMobileStudio && isEditMode;
  const { pathname } = useLocation();

  const pageId = pageData?.page.id;
  const layoutId = derivedLayout?.layoutId;
  const editingOwner = React.useMemo<EditingOwner | null>(() => {
    if (pageId != null) return { kind: "page", pageId };
    if (layoutId != null) return { kind: "layout", layoutId };
    return null;
  }, [pageId, layoutId]);

  // Stores outlive this component; studio routes unmount it, so start over on return.
  React.useEffect(
    () => () => {
      previewStore.send({ type: "reset" });
      previewCommentsStore.send({ type: "reset" });
      canvasStore.send({ type: "reset" });
    },
    [],
  );

  React.useEffect(() => {
    if (!isMobileStudio) return;
    previewStore.send({ type: "exitEditMode" });
    previewStore.send({ type: "closeAddBlockDialog" });
  }, [isMobileStudio]);

  useCanvasOnlyEditMode(!!canvasOnly && isAuthenticated, isEditMode, isMobileStudio);

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
        id: "enter-comment-mode",
        label: "Leave feedback",
        aliases: ["Comment", "Comment mode", "Show feedback"],
        groupLabel: "Preview",
        checkIfAvailable: () =>
          isAuthenticated && !isMobileStudio && pageData != null && !isCommentMode,
        execute: () => {
          if (!isEditMode) previewStore.send({ type: "enterEditMode" });
          previewStore.send({ type: "setCommentMode", enabled: true });
        },
        shortcut: { key: "c" },
      },
      {
        id: "clear-selection",
        label: "Clear selection",
        aliases: ["Deselect", "Unselect"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => {
          previewStore.send({ type: "setCommentMode", enabled: false });
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
  }, [isEditMode, isCommentMode, isAuthenticated, isMobileStudio, pageData]);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  const toolbarProps = {
    pageId: pageData?.page.id,
  };
  return (
    <CollectionItemModalProvider onRouteTargetClose={() => {}}>
      <PreviewEditingOwnerContext value={editingOwner}>
        <div
          className={cn(
            "bg-background relative flex min-h-0 flex-1 flex-col overflow-hidden",
            sharedChrome ? "h-full" : "h-screen",
            !isEditMode && "bg-black",
          )}
        >
          {!sharedChrome && !isMobileStudio && !isToolbarHidden && <Navbar isPreview />}
          <CanvasPreview enabled={showCanvas} pathname={pathname} runtimeBasePath={runtimeBasePath}>
            <div className="flex min-h-0 flex-1 flex-row items-stretch">
              <PreviewPanel
                active={!showCanvas}
                isMobileExperience={isMobileStudio}
                page={pageData?.page}
                layoutId={derivedLayout?.layoutId}
                projectName={pageData?.projectName}
                toolbarProps={toolbarProps}
              >
                {children}
              </PreviewPanel>
            </div>
          </CanvasPreview>
          {showCanvas && !sharedChrome && <PreviewToolbar {...toolbarProps} />}
          {!showCanvas && (
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
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "openCreatePageModal" }),
      },
      {
        id: "edit-current-page",
        label: "Edit current page",
        aliases: ["Page settings", "Edit page settings", "Page metadata"],
        groupLabel: "Preview",
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
        groupLabel: "Preview",
        checkIfAvailable: () => pages.length > 0,
        hasChildren: true,
        execute: () => {},
      },
      // One action per page
      ...pages.map(
        (page): Action => ({
          id: `go-to-page-${page.key}`,
          parentActionId: GO_TO_PAGE_ID,
          label: `Go to "${page.title}"`,
          aliases: [page.fullPath],
          groupLabel: "Preview",
          checkIfAvailable: () => true,
          execute: () => navigate({ to: page.fullPath }),
        }),
      ),
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
