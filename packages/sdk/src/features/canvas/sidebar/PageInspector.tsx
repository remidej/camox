import * as React from "react";

import { useLocation } from "../../navigation/navigation";
import type { PageRecordId } from "../../preview/pageRecord";
import { PreviewEditingOwnerContext } from "../../preview/previewSelection";
import type { EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";
import {
  CanvasInspectorBody,
  CanvasInspectorHeader,
  CanvasInspectorNicknameTitle,
  CanvasInspectorTitle,
} from "./CanvasInspector";
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
 * A selected Page's inspector: its name, which a curated page's can rename, then its
 * overview for its kind of Page, which loads at the Page's URL and edits for `owner`.
 */
export function PageInspector({
  page,
  owner,
  pageRecord,
  onBack,
  onRenamePage,
}: {
  page: CanvasPage;
  /** What the Page's frame edits, once it's the active one. */
  owner: EditingOwner | null;
  /** The record of a record page. */
  pageRecord?: PageRecordId;
  onBack: () => void;
  onRenamePage?: (pageId: string, nickname: string) => Promise<void>;
}) {
  const { pathname } = useLocation();
  return (
    <>
      <CanvasInspectorHeader onBack={onBack}>
        {page.kind === "curated" && onRenamePage ? (
          <CanvasInspectorNicknameTitle
            nickname={page.title}
            onRename={(nickname) => onRenamePage(page.pageId, nickname)}
          />
        ) : (
          <CanvasInspectorTitle>{page.title}</CanvasInspectorTitle>
        )}
      </CanvasInspectorHeader>
      <CanvasInspectorBody>
        <PreviewEditingOwnerContext value={owner}>
          <PageInspectorBoundary key={`${page.key}:${pathname}`}>
            <React.Suspense fallback={<PageInspectorSkeleton kind={page.kind} />}>
              <PageInspectorContent page={page} pageRecord={pageRecord} />
            </React.Suspense>
          </PageInspectorBoundary>
        </PreviewEditingOwnerContext>
      </CanvasInspectorBody>
    </>
  );
}
