import * as React from "react";

import { NavigationProvider } from "../navigation/navigation";
import { FrameContext } from "../preview/components/Frame";
import {
  createCanvasDocument,
  observeCanvasDocument,
  type CanvasDocumentFit,
} from "./canvasFrameDocument";
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
 */
export function useCanvasFrame({
  previewDocument,
  href,
  width,
  viewportHeight,
  fit,
  subject,
}: {
  previewDocument: string | undefined;
  href: string;
  width: number;
  viewportHeight: number;
  fit: CanvasDocumentFit;
  /** What the frame previews, for error messages. */
  subject: "page" | "block";
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = React.useState<string>();
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const [failure, setFailure] = React.useState<Error | null>(null);
  React.useEffect(() => {
    try {
      setSrcDoc(createCanvasDocument(previewDocument, href));
    } catch (error) {
      setFailure(toError(error));
    }
  }, [previewDocument, href]);
  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    return observeCanvasDocument(iframe, mount, viewportHeight, fit);
  }, [mount, viewportHeight, width, fit]);
  useCanvasFrameInput(iframeRef, mount);
  if (failure) throw failure;

  const iframeProps = {
    ref: iframeRef,
    srcDoc,
    onLoad: () => {
      try {
        const doc = iframeRef.current?.contentDocument;
        const root = doc?.querySelector<HTMLElement>("[data-camox-preview-root]");
        if (!root) throw new Error(`The ${subject} preview document has no content root.`);
        if (root === mount) return;
        root.replaceChildren();
        setMount(root);
      } catch (error) {
        setFailure(toError(error));
      }
    },
    onError: () => setFailure(new Error(`The ${subject} preview document could not load.`)),
  } satisfies React.ComponentProps<"iframe">;
  return { iframeRef, mount, iframeProps };
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
