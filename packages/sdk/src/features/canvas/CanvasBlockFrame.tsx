import * as React from "react";
import { createPortal } from "react-dom";

import type { Block } from "../../core/createBlock";
import { BlockEditingRuntimeProvider } from "../../core/editing/BlockEditingRuntime";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import { canvasDocumentStyles, canvasPageHref } from "./canvasFrameDocument";
import { CanvasFrameProviders, preventLinkNavigation, useCanvasFrame } from "./useCanvasFrame";

/** Frames mount this far outside the Canvas viewport, relative to its size. */
const MOUNT_MARGIN = "100%";
/** World-space height reserved for a frame until it mounts and measures its block. */
const PLACEHOLDER_HEIGHT = 400;

export interface CanvasBlockFrameProps {
  block: Block;
  runtimeBasePath: string;
  width: number;
  viewportHeight: number;
}

/**
 * A live frame of the Block Catalog: one block with its default content, bare
 * and interactive, but with no editing. It mounts once it comes near the
 * Canvas viewport and stays mounted, so its state survives panning away.
 */
export function CanvasBlockFrame(props: CanvasBlockFrameProps) {
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  const [hasNearedViewport, setHasNearedViewport] = React.useState(false);
  const previewDocument = React.useContext(PreviewDocumentContext);
  // The site document is that of the selected Page, so it changes on every
  // navigation. Only a change of the site's styles rebuilds the frame, which
  // reloads it and resets the block's state.
  const styles = React.useMemo(
    () => (hasNearedViewport ? canvasDocumentStyles(previewDocument) : ""),
    [hasNearedViewport, previewDocument],
  );
  React.useEffect(() => {
    const placeholder = placeholderRef.current;
    if (hasNearedViewport || !placeholder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setHasNearedViewport(true);
      },
      { root: placeholder.closest("[data-camox-canvas]"), rootMargin: MOUNT_MARGIN },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [hasNearedViewport]);
  if (!hasNearedViewport) {
    return (
      <div
        ref={placeholderRef}
        data-canvas-block-placeholder
        style={{ height: PLACEHOLDER_HEIGHT }}
      />
    );
  }
  return <BlockFrame key={styles} {...props} previewDocument={previewDocument} />;
}

function BlockFrame({
  block,
  runtimeBasePath,
  width,
  viewportHeight,
  previewDocument,
}: CanvasBlockFrameProps & { previewDocument: string | undefined }) {
  // Kept for the frame's lifetime: the parent rebuilds the frame when the site's styles change.
  const [initialPreviewDocument] = React.useState(previewDocument);
  const [href] = React.useState(() =>
    canvasPageHref({ runtimeBasePath, pathname: "/", href: window.location.href }),
  );
  const { iframeRef, mount, iframeProps } = useCanvasFrame({
    previewDocument: initialPreviewDocument,
    href,
    width,
    viewportHeight,
    fit: "content",
    subject: "block",
  });
  const bundle = React.useMemo(() => block._internal.getPeekBundle(), [block]);
  const { id, title, Component } = block._internal;

  return (
    <>
      {iframeProps.srcDoc && (
        <iframe
          {...iframeProps}
          title={`Block preview: ${title}`}
          style={{ display: "block", width, height: viewportHeight, border: 0 }}
        />
      )}
      {mount &&
        createPortal(
          // The Canvas runs inside the editing runtime; catalog blocks render
          // as on the live website instead, with no editing affordances.
          <BlockEditingRuntimeProvider runtime={null}>
            <CanvasFrameProviders pathname="/" href={href} mount={mount} iframe={iframeRef.current}>
              <div style={{ display: "flow-root" }} onClick={preventLinkNavigation}>
                <BlockErrorBoundary blockId={bundle.block.id} blockType={id}>
                  <React.Suspense fallback={<div role="status">Loading block…</div>}>
                    <NormalizedDataProvider
                      files={bundle.files}
                      repeatableItems={bundle.repeatableItems}
                    >
                      <Component
                        blockData={{
                          _id: bundle.block.id,
                          type: bundle.block.type,
                          content: bundle.block.content,
                          settings: bundle.block.settings,
                          position: bundle.block.position,
                        }}
                        mode="peek"
                      />
                    </NormalizedDataProvider>
                  </React.Suspense>
                </BlockErrorBoundary>
              </div>
            </CanvasFrameProviders>
          </BlockEditingRuntimeProvider>,
          mount,
        )}
    </>
  );
}
