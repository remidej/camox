import { useSelector } from "@xstate/store-react";
import * as React from "react";

import { useLocation } from "../../navigation/navigation";
import {
  SidebarStackHeader,
  SidebarStackView,
  useSelectionViewCount,
} from "../../preview/components/SidebarStack";
import type { PageRecordId } from "../../preview/pageRecord";
import { PreviewEditingOwnerContext } from "../../preview/previewSelection";
import { previewStore, selectionForOwner, type EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";
import { CanvasInspectorBody, CanvasInspectorTitle } from "./CanvasInspector";
import { CuratedPageInspector } from "./CuratedPageInspector";
import { DerivedPageInspector } from "./DerivedPageInspector";
import { PageInspectorSkeleton } from "./PageInspectorSkeleton";
import { SingletonPageInspector } from "./SingletonPageInspector";

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
  pageRecord,
}: {
  page: CanvasPage;
  pageRecord?: PageRecordId;
}) {
  switch (page.kind) {
    case "curated":
      return <CuratedPageInspector />;
    case "singleton":
      return <SingletonPageInspector layoutId={page.layoutId} />;
    case "derived":
      return <DerivedPageInspector layoutId={page.layoutId} pageRecord={pageRecord} />;
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
  pageRecord,
}: {
  page: CanvasPage;
  /** What the Page's frame edits, once it's the active one. */
  owner: EditingOwner | null;
  /** The record of a record page. */
  pageRecord?: PageRecordId;
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
        {covered ? page.title : <CanvasInspectorTitle>{page.title}</CanvasInspectorTitle>}
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
              <PageInspectorContent page={page} pageRecord={pageRecord} />
            </React.Suspense>
          </PageInspectorBoundary>
        </PreviewEditingOwnerContext>
      </CanvasInspectorBody>
    </>
  );
}
