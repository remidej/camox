import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useLocation, useNavigate } from "../../navigation/navigation";
import { PreviewDocumentContext } from "../../runtime/PreviewDocumentContext";
import {
  capturePreviewAnchor,
  restorePreviewAnchor,
  ViewportContinuityContext,
} from "../viewportContinuity";
import { PreviewActivationContext } from "./PreviewActivation";
import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "./previewStyles";

interface FrameContextValue {
  window: Window | null;
  iframeElement: HTMLIFrameElement | null;
}

export const FrameContext = React.createContext<FrameContextValue>({
  window: null,
  iframeElement: null,
});

export function useFrame() {
  const context = React.use(FrameContext);
  if (!context) {
    throw new Error("useFrame must be used within a Frame");
  }
  return context;
}

interface FrameProps {
  children: React.ReactNode;
  /** Optional className for the iframe element */
  className?: string;
  /** Optional inline styles for the iframe element */
  style?: React.CSSProperties;
  /** Whether to copy parent document styles into the iframe (default: true) */
  copyStyles?: boolean;
  /** Keep the SSR document untouched while the editing preview prepares offscreen. */
  serverOnly?: boolean;
  /** Callback when iframe is ready, receives the iframe element */
  onIframeReady?: (iframe: HTMLIFrameElement) => void;
}

function ClearServerMarkup({ nodes }: { nodes: ChildNode[] }) {
  const activate = React.useContext(PreviewActivationContext);
  React.useLayoutEffect(() => {
    nodes.forEach((node) => node.remove());
    activate?.();
  }, [nodes, activate]);
  return null;
}

export const Frame = ({
  children,
  className,
  style,
  copyStyles = true,
  serverOnly = false,
  onIframeReady,
}: FrameProps) => {
  const navigate = useNavigate();
  const { pathname, hash, href } = useLocation();
  const previewDocument = React.useContext(PreviewDocumentContext);
  const continuity = React.useContext(ViewportContinuityContext);
  // Freeze the srcdoc for this iframe's lifetime. Route updates go through the
  // existing portal, not a document reload that would reset the site's theme.
  const [srcDoc] = React.useState(previewDocument ?? EMPTY_PREVIEW_DOCUMENT);
  const [serverNodes, setServerNodes] = React.useState<ChildNode[]>([]);
  const initializedDocument = React.useRef<Document | null>(null);
  const navigateRef = React.useRef(navigate);
  navigateRef.current = navigate;
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [iframeWindow, setIframeWindow] = React.useState<Window | null>(null);
  const [iframeElement, setIframeElement] = React.useState<HTMLIFrameElement | null>(null);
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);
  const [hasOpenPopup, setHasOpenPopup] = React.useState(false);
  const positionedLocation = React.useRef<{ doc: Document; href: string } | null>(null);

  React.useLayoutEffect(() => {
    if (continuity?.pendingPreview?.pathname === pathname && iframeRef.current)
      iframeRef.current.style.visibility = "hidden";
  });

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      const iframeDoc = iframe.contentDocument;
      const iframeWin = iframe.contentWindow;

      const root = iframeDoc?.querySelector<HTMLElement>("[data-camox-preview-root]");
      // Ignore the iframe's initial about:blank document and duplicate loads.
      if (!iframeDoc || !iframeWin || !root || initializedDocument.current === iframeDoc) return;
      initializedDocument.current = iframeDoc;

      // Navigate the top-level window when a native <a> is clicked inside the
      // iframe. Links managed by a client-side router (e.g. TanStack Router's
      // <Link>) call e.preventDefault() themselves, so we skip those.
      // We listen on `iframeWin` (not `iframeDoc`) so that this handler fires
      // AFTER React's event delegation (which is on the document/body), giving
      // React a chance to call preventDefault() first.
      iframeWin.addEventListener("click", (e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey
        )
          return;
        const anchor = (e.target as Element).closest("a");
        if (!anchor?.href || anchor.hasAttribute("download")) return;
        if (anchor.target && anchor.target !== "_self") return;
        e.preventDefault();
        void navigateRef.current({
          to: new URL(anchor.getAttribute("href")!, window.location.href).href,
        });
      });

      // Legacy integrations without a server-built site document may copy
      // host styles, but never the studio's reset, utilities or theme tokens.
      if (copyStyles && srcDoc === EMPTY_PREVIEW_DOCUMENT) {
        const headStyles = Array.from(
          document.head.querySelectorAll('style, link[rel="stylesheet"]'),
        );
        headStyles.filter(isSiteStyle).forEach((style) => {
          const clonedStyle = style.cloneNode(true);
          iframeDoc.head.appendChild(clonedStyle);
        });
      }

      // The activation placeholder keeps its original DOM, but native links
      // should still navigate the host while the editor is loading.
      if (serverOnly) return;

      // Leave the SSR content in place until the portal actually commits.
      // Clearing it on load would reveal a blank frame if editing suspends.
      setServerNodes(Array.from(root.childNodes));
      setMountNode(root);
      setIframeWindow(iframeWin);
      setIframeElement(iframe);
      onIframeReady?.(iframe);
    };

    // Add load event listener
    iframe.addEventListener("load", handleLoad);

    // Trigger load if iframe is already loaded
    if (iframe.contentDocument?.readyState === "complete") {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener("load", handleLoad);
    };
  }, [copyStyles, onIframeReady, srcDoc, serverOnly]);

  React.useLayoutEffect(() => {
    if (!iframeWindow || !mountNode) return;
    if (
      positionedLocation.current?.doc === iframeWindow.document &&
      positionedLocation.current.href === href
    )
      return;
    if (positionedLocation.current && continuity?.checkpoint) continuity.checkpoint.moved = true;
    positionedLocation.current = { doc: iframeWindow.document, href };
    let base = iframeWindow.document.querySelector("base");
    if (!base) {
      base = iframeWindow.document.createElement("base");
      iframeWindow.document.head.insertBefore(base, iframeWindow.document.head.firstChild);
    }
    base.href = href;
    if (continuity?.pendingPreview?.pathname === pathname) return;
    if (!hash) {
      iframeWindow.scrollTo({ top: 0 });
      return;
    }
    try {
      iframeWindow.document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // Malformed hash escapes must not break navigation.
    }
  }, [pathname, hash, href, iframeWindow, mountNode, continuity]);

  React.useLayoutEffect(() => {
    if (!continuity || !iframeWindow || !mountNode) return;
    const doc = iframeWindow.document;
    // Most sites scroll the document. Also support a site-owned full-height
    // overflow container rather than mistakenly scrolling the studio shell.
    const center = doc.elementFromPoint?.(
      iframeWindow.innerWidth / 2,
      iframeWindow.innerHeight / 2,
    );
    let scroll = doc.scrollingElement as HTMLElement | null;
    for (let element = center; element && element !== doc.body; element = element.parentElement) {
      const overflow = iframeWindow.getComputedStyle(element).overflowY;
      if (/(auto|scroll)/.test(overflow) && element.scrollHeight > element.clientHeight) {
        scroll = element as HTMLElement;
        break;
      }
    }
    if (!scroll) return;
    const capture = () => capturePreviewAnchor(doc, scroll);
    const pending = continuity.pendingPreview;
    if (pending?.pathname === pathname) {
      restorePreviewAnchor(doc, scroll, pending.anchor);
      continuity.pendingPreview = null;
    }
    let previousTop = scroll.scrollTop;
    let previousLeft = scroll.scrollLeft;
    if (iframeRef.current) iframeRef.current.style.visibility = "";
    const onScroll = () => {
      if (scroll.scrollTop === previousTop && scroll.scrollLeft === previousLeft) return;
      previousTop = scroll.scrollTop;
      previousLeft = scroll.scrollLeft;
      continuity.previewMoved(pathname, capture());
    };
    const binding = {
      capture: () => {
        // Capture can run before the browser delivers the last scroll event.
        onScroll();
        return capture();
      },
    };
    continuity.preview = binding;
    doc.addEventListener("scroll", onScroll, true);
    return () => {
      doc.removeEventListener("scroll", onScroll, true);
      if (continuity.preview === binding) continuity.preview = null;
    };
  }, [continuity, iframeWindow, mountNode, pathname, hash]);

  // Monitor for Base UI portaled popups in body
  React.useEffect(() => {
    const checkForOpenPopup = () => {
      const hasPopup = document.body.querySelector("[data-base-ui-portal] [data-open]") !== null;
      setHasOpenPopup(hasPopup);
    };

    // Initial check
    checkForOpenPopup();

    // Watch for Base UI portal descendants whose data-open/data-closed attributes change
    const observer = new MutationObserver(checkForOpenPopup);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-open", "data-closed"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn("relative w-full h-full", className)} style={style}>
      {/* Display an overlay to properly close portaled popups (modals, popovers...) */}
      {/* because otherwise Base UI wouldn't detect pointer events that happen on the iframe */}
      {hasOpenPopup && <div className="absolute top-0 left-0 h-full w-full" />}
      <FrameContext.Provider value={{ window: iframeWindow, iframeElement }}>
        <iframe
          ref={iframeRef}
          title="Page preview"
          srcDoc={srcDoc}
          className={cn("w-full h-full")}
        />
        {mountNode &&
          createPortal(
            <>
              <ClearServerMarkup nodes={serverNodes} />
              {children}
            </>,
            mountNode,
          )}
      </FrameContext.Provider>
    </div>
  );
};
