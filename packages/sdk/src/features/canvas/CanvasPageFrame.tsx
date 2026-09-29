import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import * as React from "react";
import { createPortal } from "react-dom";
import overlayStyles from "virtual:camox-overlay-css";

import { NavigationProvider } from "../navigation/navigation";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { FrameContext } from "../preview/components/Frame";
import { Overlays } from "../preview/components/Overlays";
import { PreviewFrameEffects } from "../preview/components/PreviewPanel";
import { EditablePageContent } from "../preview/EditablePageContent";
import { PreviewEditingOwnerContext } from "../preview/previewSelection";
import { previewStore, type EditingOwner } from "../preview/previewStore";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import type { PageRenderInput } from "../runtime/runtime";
import { canvasPageHref, createCanvasDocument, observeCanvasDocument } from "./canvasFrameDocument";
import { CanvasOverlays } from "./CanvasOverlays";

const noNavigation = () => {};

export interface CanvasPageFrameProps {
  input: PageRenderInput;
  width: number;
  viewportHeight: number;
  pageId?: number;
  onActivate: (owner: EditingOwner) => void;
}

/**
 * Parent owns /_camox/data loading and the per-card error boundary. Documents are
 * isolated, but their cache and editing runtime are shared with the studio.
 */
export function CanvasPageFrame(props: CanvasPageFrameProps) {
  return (
    <PageFrame
      key={`${props.input.pathname}:${props.input.source}:${props.input.previewDocument ?? ""}`}
      {...props}
    />
  );
}

function PageFrame({ input, width, viewportHeight, pageId, onActivate }: CanvasPageFrameProps) {
  const camoxApp = useCamoxApp();
  const href = canvasPageHref(input);
  const owner = React.useMemo<EditingOwner | null>(() => {
    if (input.derived) return { kind: "layout", layoutId: input.derived.layout.id };
    if (pageId != null) return { kind: "page", pageId };
    return null;
  }, [input.derived, pageId]);
  const [srcDoc, setSrcDoc] = React.useState<string>();
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const [failure, setFailure] = React.useState<Error | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => {
    try {
      setSrcDoc(createCanvasDocument(input.previewDocument, href));
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }, [input.previewDocument, href]);
  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    return observeCanvasDocument(iframe, mount, viewportHeight);
  }, [mount, viewportHeight, width]);
  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    const doc = mount.ownerDocument;
    // Native wheel events do not bubble out of a document. Keep the existing
    // camera behavior over interactive frames, using host-space coordinates.
    const forwardWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = iframe.getBoundingClientRect();
      const scale = rect.width / iframe.offsetWidth;
      iframe.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + event.clientX * scale,
          clientY: rect.top + event.clientY * scale,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        }),
      );
    };
    doc.addEventListener("wheel", forwardWheel, { passive: false });
    return () => {
      doc.removeEventListener("wheel", forwardWheel);
      if (previewStore.getSnapshot().context.iframeElement !== iframe) return;
      previewStore.send({ type: "clearSelection" });
      previewStore.send({ type: "setIframeElement", element: null });
    };
  }, [mount]);
  const activate = () => {
    if (!owner) return;
    if (owner.kind === "page") previewStore.send({ type: "activatePage", pageId: owner.pageId });
    else previewStore.send({ type: "activateLayout", layoutId: owner.layoutId });
    previewStore.send({ type: "setIframeElement", element: iframeRef.current });
    onActivate(owner);
  };
  if (failure) throw failure;

  return (
    <PreviewEditingOwnerContext value={owner}>
      <HydrationBoundary state={input.dehydratedState as DehydratedState}>
        <NavigationProvider
          location={{ pathname: input.pathname, href, hash: "", search: "" }}
          navigate={noNavigation}
        >
          <PreviewDocumentContext.Provider value={input.previewDocument}>
            <FrameContext.Provider
              value={{
                window: mount?.ownerDocument.defaultView ?? null,
                iframeElement: iframeRef.current,
              }}
            >
              <CanvasOverlays
                document={mount?.ownerDocument ?? null}
                activate={activate}
                canAddBlocks={owner?.kind === "page"}
              >
                <style>{overlayStyles}</style>
                {srcDoc && (
                  <iframe
                    ref={iframeRef}
                    title={`Page preview: ${input.pathname}`}
                    srcDoc={srcDoc}
                    style={{
                      display: "block",
                      width,
                      height: viewportHeight,
                      border: 0,
                    }}
                    onLoad={() => {
                      try {
                        const doc = iframeRef.current?.contentDocument;
                        const root = doc?.querySelector<HTMLElement>("[data-camox-preview-root]");
                        if (!root)
                          throw new Error("The page preview document has no content root.");
                        if (root === mount) return;
                        root.replaceChildren();
                        setMount(root);
                      } catch (error) {
                        setFailure(error instanceof Error ? error : new Error(String(error)));
                      }
                    }}
                    onError={() =>
                      setFailure(new Error("The page preview document could not load."))
                    }
                  />
                )}
                {mount &&
                  createPortal(
                    <React.Suspense fallback={<div role="status">Loading page…</div>}>
                      <div
                        style={{ display: "contents" }}
                        onPointerDownCapture={activate}
                        onFocusCapture={activate}
                        onClick={(event) => {
                          // Selecting/editing must not navigate the iframe away from its portal.
                          if ((event.target as Element).closest("a")) event.preventDefault();
                        }}
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
                        <Overlays
                          iframeElement={iframeRef.current}
                          owner={owner}
                          canAddBlocks={owner?.kind === "page"}
                        />
                      </div>
                    </React.Suspense>,
                    mount,
                  )}
              </CanvasOverlays>
            </FrameContext.Provider>
          </PreviewDocumentContext.Provider>
        </NavigationProvider>
      </HydrationBoundary>
    </PreviewEditingOwnerContext>
  );
}
