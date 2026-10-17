import * as React from "react";

import { NavigationProvider } from "../navigation/navigation";
import { FrameContext } from "../preview/components/Frame";
import {
  createCanvasDocument,
  observeCanvasDocument,
  pauseCanvasDocument,
  type CanvasDocumentFit,
} from "./canvasFrameDocument";
import type { CanvasFrameMode } from "./canvasFrameMode";
import { useCanvasFrameInput } from "./useCanvasFrameInput";

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The document of an interactive Canvas frame and the root its content portals
 * into. It builds the frame document from the site document, takes over the
 * content root once the frame loads, sizes the frame to it, and keeps the
 * camera's input working over it. Failing to build or load the document throws
 * to the card's error boundary.
 *
 * Unless live, the frame's document is paused. A resting frame keeps its size:
 * its content is hidden, and must not shrink the frame and move the Canvas.
 */
export function useCanvasFrame({
  previewDocument,
  href,
  width,
  viewportHeight,
  fit,
  subject,
  mode,
}: {
  previewDocument: string | undefined;
  href: string;
  width: number;
  viewportHeight: number;
  fit: CanvasDocumentFit;
  /** What the frame previews, for error messages. */
  subject: "page" | "block";
  mode: CanvasFrameMode;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = React.useState<string>();
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  // The iframe as of the latest load, for rendering (the ref is for effects and handlers).
  const [iframe, setIframe] = React.useState<HTMLIFrameElement | null>(null);
  const [failure, setFailure] = React.useState<Error | null>(null);
  const live = mode === "live";
  const resting = mode === "resting";
  React.useEffect(() => {
    try {
      // oxlint-disable-next-line react/set-state-in-effect -- the document copies host styles, so it is built after mount
      setSrcDoc(createCanvasDocument(previewDocument, href));
    } catch (error) {
      setFailure(toError(error));
    }
  }, [previewDocument, href]);
  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount || resting) return;
    return observeCanvasDocument(iframe, mount, viewportHeight, fit);
  }, [mount, viewportHeight, width, fit, resting]);
  React.useEffect(() => {
    if (!mount || live) return;
    return pauseCanvasDocument(mount.ownerDocument);
  }, [mount, live]);
  useCanvasFrameInput(iframeRef, mount);
  if (failure) throw failure;

  const iframeProps = {
    ref: iframeRef,
    srcDoc,
    onLoad: () => {
      try {
        const loaded = iframeRef.current;
        const doc = loaded?.contentDocument;
        const root = doc?.querySelector<HTMLElement>("[data-camox-preview-root]");
        if (!root) throw new Error(`The ${subject} preview document has no content root.`);
        if (root === mount) return;
        root.replaceChildren();
        setMount(root);
        setIframe(loaded);
      } catch (error) {
        setFailure(toError(error));
      }
    },
    onError: () => setFailure(new Error(`The ${subject} preview document could not load.`)),
  } satisfies React.ComponentProps<"iframe">;
  return { iframeRef, iframe, mount, iframeProps };
}

const noNavigation = () => {};

/**
 * What a frame's content reads from its surroundings: the location it previews,
 * with navigation disabled, and the frame it renders in.
 */
export function CanvasFrameProviders({
  pathname,
  href,
  mount,
  iframe,
  children,
}: {
  pathname: string;
  href: string;
  mount: HTMLElement | null;
  iframe: HTMLIFrameElement | null;
  children: React.ReactNode;
}) {
  return (
    <NavigationProvider location={{ pathname, href, hash: "", search: "" }} navigate={noNavigation}>
      <FrameContext.Provider
        value={{ window: mount?.ownerDocument.defaultView ?? null, iframeElement: iframe }}
      >
        {children}
      </FrameContext.Provider>
    </NavigationProvider>
  );
}

/** Keeps a frame on its portal: links inside Canvas frames never navigate them. */
export function preventLinkNavigation(event: React.MouseEvent) {
  if ((event.target as Element).closest("a")) event.preventDefault();
}
