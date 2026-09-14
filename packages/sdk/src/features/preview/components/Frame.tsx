import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useLocation, useNavigate } from "../../navigation/navigation";
import { PreviewDocumentContext } from "../../runtime/PreviewDocumentContext";
import { EMPTY_PREVIEW_DOCUMENT, isSiteStyle } from "./previewStyles";

interface FrameContextValue {
  window: Window | null;
  iframeElement: HTMLIFrameElement | null;
}

const FrameContext = React.createContext<FrameContextValue>({
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
  /** Callback when iframe is ready, receives the iframe element */
  onIframeReady?: (iframe: HTMLIFrameElement) => void;
}

function ClearServerMarkup({ nodes }: { nodes: ChildNode[] }) {
  React.useLayoutEffect(() => {
    nodes.forEach((node) => node.remove());
  }, [nodes]);
  return null;
}

export const Frame = ({
  children,
  className,
  style,
  copyStyles = true,
  onIframeReady,
}: FrameProps) => {
  const navigate = useNavigate();
  const { pathname, hash, href } = useLocation();
  const previewDocument = React.useContext(PreviewDocumentContext);
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
  }, [copyStyles, onIframeReady, srcDoc]);

  React.useEffect(() => {
    if (!iframeWindow || !mountNode) return;
    let base = iframeWindow.document.querySelector("base");
    if (!base) {
      base = iframeWindow.document.createElement("base");
      iframeWindow.document.head.insertBefore(base, iframeWindow.document.head.firstChild);
    }
    base.href = href;
    if (!hash) {
      iframeWindow.scrollTo({ top: 0 });
      return;
    }
    try {
      iframeWindow.document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // Malformed hash escapes must not break navigation.
    }
  }, [pathname, hash, href, iframeWindow, mountNode]);

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
