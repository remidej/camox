import { useSelector } from "@xstate/store-react";
import { File } from "lucide-react";
import * as React from "react";

import { useLocation } from "../../navigation/navigation";
import {
  SidebarStackHeader,
  SidebarStackView,
  useSelectionViewCount,
} from "../../preview/components/SidebarStack";
import { PreviewEditingOwnerContext } from "../../preview/previewSelection";
import { previewStore, selectionForOwner, type EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";
import { CanvasInspectorBody, CanvasInspectorTitle } from "./CanvasInspector";
import { CuratedPageInspector } from "./CuratedPageInspector";
import { LayoutPageOverview } from "./LayoutPageOverview";
import { PageInspectorSkeleton } from "./PageInspectorSkeleton";

function PageInspectorError() {
  return (
    <p role="alert" className="p-4">
      This page’s sidebar could not be loaded.
    </p>
  );
}

class PageInspectorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <PageInspectorError />;
    return this.props.children;
  }
}

function PageInspectorContent({
  page,
  runtimeBasePath,
}: {
  page: CanvasPage;
  runtimeBasePath: string;
}) {
  switch (page.kind) {
    case "curated":
      return <CuratedPageInspector />;
    case "singleton":
      return <LayoutPageOverview layoutId={page.layoutId} target={{ runtimeBasePath }} />;
    case "derived":
      return (
        <LayoutPageOverview
          layoutId={page.layoutId}
          target={{ runtimeBasePath, derivedLayoutId: page.layoutId }}
        />
      );
  }
}

/**
 * A selected Page's inspector: its name, then its overview for its kind of Page, which loads at the Page's URL and edits for `owner`.
 * While something on the Page is selected, the selection's views are laid over the
 * overview, and the name's header goes back to it.
 */
export function PageInspector({
  page,
  owner,
  runtimeBasePath,
}: {
  page: CanvasPage;
  /** What the Page's frame edits, once it's the active one. */
  owner: EditingOwner | null;
  /** Where the runtime is mounted, which a layout page's frame reads its render under. */
  runtimeBasePath: string;
}) {
  const { pathname } = useLocation();
  const covered =
    useSelector(previewStore, (state) => selectionForOwner(state.context, owner)) != null;
  // Under every view the selection lays over it, once they show.
  const selectionViews = useSelectionViewCount();
  const distance = covered ? Math.max(1, selectionViews) : 0;
  return (
    <>
      <SidebarStackHeader
        depth={1}
        distance={distance}
        onSelect={() => previewStore.send({ type: "clearSelection" })}
        hoverTarget={null}
      >
        {/* A page icon sets the Page apart from the blocks and fields stacked on it. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <File className="size-3.5 shrink-0" />
          {covered ? (
            <span className="truncate">{page.title}</span>
          ) : (
            <CanvasInspectorTitle>{page.title}</CanvasInspectorTitle>
          )}
        </span>
      </SidebarStackHeader>
      <CanvasInspectorBody>
        <PreviewEditingOwnerContext value={owner}>
          <PageInspectorBoundary key={`${page.key}:${pathname}`}>
            <React.Suspense
              fallback={
                <SidebarStackView depth={1} className="flex flex-col">
                  <PageInspectorSkeleton kind={page.kind} />
                </SidebarStackView>
              }
            >
              <PageInspectorContent page={page} runtimeBasePath={runtimeBasePath} />
            </React.Suspense>
          </PageInspectorBoundary>
        </PreviewEditingOwnerContext>
      </CanvasInspectorBody>
    </>
  );
}
