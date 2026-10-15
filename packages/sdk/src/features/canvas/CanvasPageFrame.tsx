import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";
import { createPortal } from "react-dom";
import overlayStyles from "virtual:camox-overlay-css";

import { DerivedPageContent } from "../page/DerivedPageContent";
import { Overlays } from "../preview/components/Overlays";
import { PreviewComments } from "../preview/components/PreviewComments";
import { PreviewFrameEffects } from "../preview/components/PreviewPanel";
import { EditablePageContent } from "../preview/EditablePageContent";
import { PreviewPreparationContext } from "../preview/previewPreparation";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import { previewStore, selectIsCommentMode, type EditingOwner } from "../preview/previewStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import type { PageRenderInput } from "../runtime/runtime";
import { canvasPageHref, measureCanvasDocument } from "./canvasFrameDocument";
import type { CanvasFrameMode } from "./canvasFrameMode";
import { CanvasOverlays } from "./CanvasOverlays";
import { CanvasFrameProviders, preventLinkNavigation, useCanvasFrame } from "./useCanvasFrame";

function PageContentCommitted({
  selected,
  frame,
  viewportHeight,
}: {
  selected: boolean;
  frame: React.RefObject<HTMLIFrameElement | null>;
  viewportHeight: number;
}) {
  const preparation = React.useContext(PreviewPreparationContext);
  React.useEffect(() => {
    if (!selected) return;
    const iframe = frame.current;
    const root = iframe?.contentDocument?.querySelector<HTMLElement>("[data-camox-preview-root]");
    if (iframe && root) measureCanvasDocument(iframe, root, viewportHeight);
    preparation?.ready();
  }, [selected, preparation, frame, viewportHeight]);
  return null;
}

export interface CanvasPageFrameProps {
  input: PageRenderInput;
  width: number;
  viewportHeight: number;
  pageId?: number;
  selected?: boolean;
  hovered?: boolean;
  /**
   * Unless live, the frame's animations and media are paused. Resting, its
   * content is also hidden and its effects stop, while its document and state
   * are kept.
   */
  mode?: CanvasFrameMode;
  onActivate: (owner: EditingOwner, source: "selection" | "interaction") => void;
}

/**
 * Parent owns /_camox/data loading and the per-card error boundary. Documents are
 * isolated, but their cache and editing runtime are shared with the studio.
 */
export function CanvasPageFrame(props: CanvasPageFrameProps) {
  return <PageFrame key={`${props.input.pathname}:${props.input.source}`} {...props} />;
}

function PageFrame({
  input,
  width,
  viewportHeight,
  pageId,
  selected = false,
  hovered = false,
  mode = "live",
  onActivate,
}: CanvasPageFrameProps) {
  const camoxApp = useCamoxApp();
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  const href = canvasPageHref(input);
  const layoutId = input.derived?.layout.layoutId;
  const owner = React.useMemo<EditingOwner | null>(() => {
    if (layoutId != null) return { kind: "layout", layoutId };
    if (pageId != null) return { kind: "page", pageId };
    return null;
  }, [layoutId, pageId]);
  const { iframeRef, mount, iframeProps } = useCanvasFrame({
    previewDocument: input.previewDocument,
    href,
    width,
    viewportHeight,
    fit: "page",
    subject: "page",
    mode,
  });
  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    return () => {
      if (previewStore.getSnapshot().context.iframeElement !== iframe) return;
      previewStore.send({ type: "clearSelection" });
      previewStore.send({ type: "setIframeElement", element: null });
    };
  }, [mount]);
  const activateOwner = (source: "selection" | "interaction") => {
    if (!owner) return;
    if (owner.kind === "page") previewStore.send({ type: "activatePage", pageId: owner.pageId });
    else previewStore.send({ type: "activateLayout", layoutId: owner.layoutId });
    previewStore.send({ type: "setIframeElement", element: iframeRef.current });
    onActivate(owner, source);
  };
  const activate = () => activateOwner("interaction");
  const activateSelected = React.useEffectEvent(() => activateOwner("selection"));
  React.useEffect(() => {
    if (!selected || !mount || !owner) return;
    // Only a selection/readiness transition takes ownership. Callback changes
    // or store updates must not steal it back during another frame's navigation.
    activateSelected();
  }, [selected, mount, owner]);

  return (
    <PreviewEditingOwnerContext value={owner}>
      <HydrationBoundary state={input.dehydratedState as DehydratedState}>
        <CanvasFrameProviders
          pathname={input.pathname}
          href={href}
          mount={mount}
          iframe={iframeRef.current}
        >
          <PreviewDocumentContext.Provider value={input.previewDocument}>
            <CanvasOverlays
              document={mount?.ownerDocument ?? null}
              activate={activate}
              pageHovered={hovered}
              pageId={owner?.kind === "page" ? owner.pageId : undefined}
              canAddBlocks={owner?.kind === "page"}
            >
              <style>{overlayStyles}</style>
              {iframeProps.srcDoc && (
                <iframe
                  {...iframeProps}
                  title={`Page preview: ${input.pathname}`}
                  style={{ display: "block", width, height: viewportHeight, border: 0 }}
                />
              )}
              {mount &&
                createPortal(
                  <React.Activity mode={mode === "resting" ? "hidden" : "visible"}>
                    <React.Suspense fallback={<div role="status">Loading page…</div>}>
                      <div
                        style={{ display: "contents" }}
                        onPointerDownCapture={activate}
                        onFocusCapture={activate}
                        onClickCapture={activate}
                        // Selecting/editing must not navigate the iframe away from its portal.
                        onClick={preventLinkNavigation}
                      >
                        {input.derived ? (
                          <DerivedPageContent
                            camoxApp={camoxApp}
                            derived={input.derived}
                            source={input.source}
                          />
                        ) : (
                          <EditablePageContent />
                        )}
                        <PreviewFrameEffects />
                        {owner?.kind === "page" && (
                          <PreviewComments iframeElement={iframeRef.current} />
                        )}
                        {!isCommentMode && (
                          <Overlays
                            iframeElement={iframeRef.current}
                            owner={owner}
                            canAddBlocks={owner?.kind === "page"}
                          />
                        )}
                        {/* This commits only after onLoad and the portal's content resolves. */}
                        <PageContentCommitted
                          selected={selected}
                          frame={iframeRef}
                          viewportHeight={viewportHeight}
                        />
                      </div>
                    </React.Suspense>
                  </React.Activity>,
                  mount,
                )}
            </CanvasOverlays>
          </PreviewDocumentContext.Provider>
        </CanvasFrameProviders>
      </HydrationBoundary>
    </PreviewEditingOwnerContext>
  );
}
