import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

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

export const Frame = ({
  children,
  className,
  style,
  copyStyles = true,
  onIframeReady,
}: FrameProps) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [iframeWindow, setIframeWindow] = React.useState<Window | null>(null);
  const [iframeElement, setIframeElement] =
    React.useState<HTMLIFrameElement | null>(null);
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);
  const [hasRadixPopper, setHasRadixPopper] = React.useState(false);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      const iframeDoc = iframe.contentDocument;
      const iframeWin = iframe.contentWindow;

      if (!iframeDoc || !iframeWin) return;

      // Set up basic document structure
      iframeDoc.open();
      iframeDoc.write(
        "<!DOCTYPE html><html><head></head><body style='background: transparent;'></body></html>",
      );
      iframeDoc.close();

      // Navigate the top-level window when a native <a> is clicked inside the
      // iframe. Links managed by a client-side router (e.g. TanStack Router's
      // <Link>) call e.preventDefault() themselves, so we skip those.
      // We listen on `iframeWin` (not `iframeDoc`) so that this handler fires
      // AFTER React's event delegation (which is on the document/body), giving
      // React a chance to call preventDefault() first.
      iframeWin.addEventListener("click", (e) => {
        if (e.defaultPrevented) return;
        const anchor = (e.target as Element).closest("a");
        if (!anchor?.href) return;
        if (anchor.target === "_blank") return;
        e.preventDefault();
        window.top?.location.assign(anchor.href);
      });

      // Copy styles from parent document if requested
      if (copyStyles) {
        const headStyles = Array.from(
          document.head.querySelectorAll('style, link[rel="stylesheet"]'),
        );
        headStyles.forEach((style) => {
          const clonedStyle = style.cloneNode(true);
          iframeDoc.head.appendChild(clonedStyle);
        });
      }

      // Set the mount node to the iframe's body
      setMountNode(iframeDoc.body);
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
  }, [copyStyles, onIframeReady]);

  // Monitor for Radix popper content wrapper in body
  React.useEffect(() => {
    const checkForRadixPopper = () => {
      const hasPopper =
        document.body.querySelector(
          ":scope > [data-radix-popper-content-wrapper]",
        ) !== null;
      setHasRadixPopper(hasPopper);
    };

    // Initial check
    checkForRadixPopper();

    // Set up MutationObserver to watch for changes
    const observer = new MutationObserver(checkForRadixPopper);
    observer.observe(document.body, {
      childList: true,
      subtree: false, // Only watch direct children of body
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn("relative w-full h-full", className)} style={style}>
      {/* Display an overlay to properly close close Radix portals (modals, popovers...) */}
      {/* because otherwise Radix wouldn't detect pointer events that would happen on the iframe */}
      {hasRadixPopper && (
        <div className="absolute w-full h-full top-0 left-0" />
      )}
      <FrameContext.Provider value={{ window: iframeWindow, iframeElement }}>
        <iframe ref={iframeRef} className={cn("w-full h-full")} />
        {mountNode && createPortal(children, mountNode)}
      </FrameContext.Provider>
    </div>
  );
};
