import * as React from "react";
import { createPortal } from "react-dom";

import type { Block } from "../../core/createBlock";
import { BlockEditingRuntimeProvider } from "../../core/editing/BlockEditingRuntime";
import { NormalizedDataProvider } from "../../lib/normalized-data";
import { NavigationProvider } from "../navigation/navigation";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { FrameContext } from "../preview/components/Frame";
import { PreviewDocumentContext } from "../runtime/PreviewDocumentContext";
import { canvasPageHref, createCanvasDocument, observeCanvasDocument } from "./canvasFrameDocument";
import { useCanvasFrameInput } from "./useCanvasFrameInput";

/** Frames mount this far outside the Canvas viewport, relative to its size. */
const MOUNT_MARGIN = "100%";
/** World-space height reserved for a frame until it mounts and measures its block. */
const PLACEHOLDER_HEIGHT = 400;

const noNavigation = () => {};

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
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const placeholder = placeholderRef.current;
    if (near || !placeholder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setNear(true);
      },
      { root: placeholder.closest("[data-camox-canvas]"), rootMargin: MOUNT_MARGIN },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [near]);
  if (!near) {
    return (
      <div
        ref={placeholderRef}
        data-canvas-block-placeholder
        style={{ height: PLACEHOLDER_HEIGHT }}
      />
    );
  }
  return <BlockFrame {...props} />;
}

function BlockFrame({ block, runtimeBasePath, width, viewportHeight }: CanvasBlockFrameProps) {
  const previewDocument = React.useContext(PreviewDocumentContext);
  const [href] = React.useState(() =>
    canvasPageHref({ runtimeBasePath, pathname: "/", href: window.location.href }),
  );
  // Built once: the site head is shared by every page, and rebuilding would
  // reload the frame and reset the block's state.
  const [srcDoc] = React.useState(() => createCanvasDocument(previewDocument, href));
  const bundle = React.useMemo(() => block._internal.getPeekBundle(), [block]);
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const [failure, setFailure] = React.useState<Error | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    return observeCanvasDocument(iframe, mount, viewportHeight, "content");
  }, [mount, viewportHeight, width]);
  useCanvasFrameInput(iframeRef, mount);
  if (failure) throw failure;
  const { id, title, Component } = block._internal;

  return (
    <>
      <iframe
        ref={iframeRef}
        title={`Block preview: ${title}`}
        srcDoc={srcDoc}
        style={{ display: "block", width, height: viewportHeight, border: 0 }}
        onLoad={() => {
          const root = iframeRef.current?.contentDocument?.querySelector<HTMLElement>(
            "[data-camox-preview-root]",
          );
          if (!root) {
            setFailure(new Error("The block preview document has no content root."));
            return;
          }
          if (root === mount) return;
          root.replaceChildren();
          setMount(root);
        }}
        onError={() => setFailure(new Error("The block preview document could not load."))}
      />
      {mount &&
        createPortal(
          // The Canvas runs inside the editing runtime; catalog blocks render
          // as on the live website instead, with no editing affordances.
          <BlockEditingRuntimeProvider runtime={null}>
            <NavigationProvider
              location={{ pathname: "/", href, hash: "", search: "" }}
              navigate={noNavigation}
            >
              <FrameContext.Provider
                value={{
                  window: mount.ownerDocument.defaultView,
                  iframeElement: iframeRef.current,
                }}
              >
                <div
                  style={{ display: "flow-root" }}
                  onClick={(event) => {
                    // Keep the frame on its portal; catalog links lead nowhere.
                    if ((event.target as Element).closest("a")) event.preventDefault();
                  }}
                >
                  <BlockErrorBoundary blockId={0} blockType={id}>
                    <React.Suspense fallback={<div role="status">Loading block…</div>}>
                      <NormalizedDataProvider
                        files={bundle.files}
                        repeatableItems={bundle.repeatableItems}
                      >
                        <Component
                          blockData={{
                            _id: 0,
                            type: id,
                            content: bundle.block.content as Record<string, unknown>,
                            settings: bundle.block.settings as Record<string, unknown> | undefined,
                            position: "",
                          }}
                          mode="peek"
                        />
                      </NormalizedDataProvider>
                    </React.Suspense>
                  </BlockErrorBoundary>
                </div>
              </FrameContext.Provider>
            </NavigationProvider>
          </BlockEditingRuntimeProvider>,
          mount,
        )}
    </>
  );
}
