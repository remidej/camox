import { type Action, actionsStore } from "../provider/actionsStore";
import { previewStore } from "./previewStore";
import { useSelector } from "@xstate/store/react";
import * as React from "react";
import { PeekedBlock } from "./components/PeekedBlock";

import { PreviewFrame, PreviewPanel } from "./components/PreviewPanel";
import { Navbar } from "../studio/components/Navbar";
import { SignedIn, SignedOut, useAuth, useClerk } from "@clerk/clerk-react";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { api } from "camox/_generated/api";
import { useQuery } from "convex/react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "./components/Sidebar";
import { PageContentSheet } from "./components/PageContentSheet";
import { AddBlockSheet } from "./components/AddBlockSheet";

/* -------------------------------------------------------------------------------------------------
 * PageContent
 * -----------------------------------------------------------------------------------------------*/

/**
 * Fetches the current page being previewed, with live updates if the user is signed in.
 * Also will switch to peeked page data if there is one.
 */
export function usePreviewedPage() {
  const { pathname } = useLocation();
  const peekedPagePathname = useSelector(
    previewStore,
    (state) => state.context.peekedPagePathname,
  );
  const pagePathnameToFetch = peekedPagePathname ?? pathname;

  /**
   * Only live update the page data if the user is signed in (i.e. an admin)
   * to avoid unnecessary load on the backend and layout shifts for regular visitors.
   */
  const { isSignedIn } = useAuth();
  const currentPage = useQuery(
    api.pages.getPage,
    isSignedIn
      ? {
          fullPath: pagePathnameToFetch,
        }
      : "skip",
  );

  /**
   * Store the previous page data to avoid returning undefined when switching
   * between peeked pages, which would cause a visual glitch.
   */
  const previousPageRef = React.useRef(currentPage);

  React.useEffect(() => {
    if (currentPage !== undefined) {
      previousPageRef.current = currentPage;
    }
  }, [currentPage]);

  return currentPage ?? previousPageRef.current;
}

interface PageContentProps {
  page: NonNullable<typeof api.pages.getPage._returnType>;
}

export const PageContent = ({ page: initialPageData }: PageContentProps) => {
  const livePageData = usePreviewedPage();
  const pageData = livePageData ?? initialPageData;
  const peekedBlockPosition = useSelector(
    previewStore,
    (state) => state.context.peekedBlockPosition,
  );

  // Latch the last non-null position so the block doesn't jump during collapse
  const displayedPositionRef = React.useRef<string | null>(null);
  if (peekedBlockPosition !== null) {
    displayedPositionRef.current = peekedBlockPosition;
  }
  const effectivePosition =
    peekedBlockPosition ?? displayedPositionRef.current;

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
      return pageData.blocks.length; // Insert at the end
    }

    // Find the index after the block with the matching position
    const afterBlockIndex = pageData.blocks.findIndex(
      (block) => String(block.position) === effectivePosition,
    );

    if (afterBlockIndex === -1) {
      // Position not found, insert at the end
      return pageData.blocks.length;
    }

    // Insert after the found block
    return afterBlockIndex + 1;
  }, [pageData.blocks, effectivePosition]);

  return (
    <main className="flex min-h-screen flex-col">
      {/* Render peeked block at the beginning if it should be before the first block */}
      {peekedBlockIndex === 0 && pageData.blocks.length > 0 && (
        <PeekedBlock onExitComplete={onExitComplete} />
      )}
      {pageData.blocks.map((blockData, index) => {
        const block = camoxApp.getBlockById(String(blockData.type));

        if (!block) {
          return null;
        }

        return (
          <React.Fragment key={blockData._id}>
            <block.Component
              blockData={{
                _id: blockData._id,
                type: blockData.type,
                content: blockData.content,
                settings: blockData.settings,
                position: String(blockData.position),
              }}
              mode="site"
              isFirstBlock={index === 0}
            />
            {/* Render peeked block after this block if this is the insertion point */}
            {index === peekedBlockIndex - 1 && (
              <PeekedBlock onExitComplete={onExitComplete} />
            )}
          </React.Fragment>
        );
      })}
      {/* Render peeked block at the end if there are no blocks */}
      {pageData.blocks.length === 0 && (
        <PeekedBlock onExitComplete={onExitComplete} />
      )}
    </main>
  );
};

/* -------------------------------------------------------------------------------------------------
 * CamoxPreview
 * -----------------------------------------------------------------------------------------------*/

export const CamoxPreview = ({ children }: { children: React.ReactNode }) => {
  const { isSignedIn } = useClerk();
  const isPresentationMode = useSelector(
    previewStore,
    (state) => state.context.isPresentationMode,
  );
  const isSidebarOpen = useSelector(
    previewStore,
    (state) => state.context.isSidebarOpen,
  );
  const isContentLocked = useSelector(
    previewStore,
    (state) => state.context.isContentLocked,
  );

  React.useEffect(() => {
    const actions = [
      {
        id: "enter-presentation-mode",
        label: "Enter presentation mode",
        groupLabel: "Preview",
        checkIfAvailable: () => isSignedIn && !isPresentationMode,
        execute: () => previewStore.send({ type: "enterPresentationMode" }),
        shortcut: { key: "Enter", withMeta: true },
        icon: "MonitorPlay",
      },
      {
        id: "exit-presentation-mode",
        label: "Exit presentation mode",
        groupLabel: "Preview",
        checkIfAvailable: () => isSignedIn && isPresentationMode,
        execute: () => previewStore.send({ type: "exitPresentationMode" }),
        shortcut: { key: "Escape", withMeta: true },
        icon: "MonitorOff",
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
  }, [isPresentationMode, isSignedIn]);

  if (isPresentationMode) {
    return <PreviewFrame className="h-screen w-full">{children}</PreviewFrame>;
  }

  return (
    <>
      <SignedIn>
        <div className="h-screen overflow-hidden bg-background flex flex-col">
          <Navbar />
          <div className="h-full flex flex-row items-stretch">
            {isSidebarOpen && (
              <div className="w-[300px] flex flex-col border-r-2">
                <Sidebar />
              </div>
            )}
            <PreviewPanel>
              {children}
              {!isContentLocked && (
                <div style={{ height: "80px", background: "transparent" }} />
              )}
            </PreviewPanel>
          </div>
          <PageContentSheet />
          <AddBlockSheet />
        </div>
      </SignedIn>
      <SignedOut>{children}</SignedOut>
    </>
  );
};

export function usePreviewPagesActions() {
  const navigate = useNavigate();
  const pages = useQuery(api.pages.listPages);

  React.useEffect(() => {
    const GO_TO_PAGE_ID = "go-to-page";

    const actions: Action[] = [
      {
        id: GO_TO_PAGE_ID,
        label: "Go to page",
        groupLabel: "Preview",
        checkIfAvailable: () => !!pages,
        hasChildren: true,
        execute: () => {},
        icon: "File",
      },
      // One action per page
      ...(pages
        ? pages.map(
            (page) =>
              ({
                id: `go-to-page-${page._id}`,
                parentActionId: GO_TO_PAGE_ID,
                label: `Go to "${page.nickname}"`,
                groupLabel: "Preview",
                checkIfAvailable: () => true,
                execute: () => navigate({ to: page.fullPath }),
                icon: "File",
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
  }, [navigate, pages]);
}
