import * as React from "react";

import { useFrame } from "./Frame";

/** Reserve scroll space without painting the site's document background over it. */
export function PreviewToolbarSpacer() {
  const { window: frameWindow, iframeElement } = useFrame();
  const spacerRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const spacer = spacerRef.current;
    if (!frameWindow || !iframeElement || !spacer) return;

    const previousClipPath = iframeElement.style.clipPath;
    const updateClip = () => {
      const { top, height } = spacer.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(height, frameWindow.innerHeight - top));
      iframeElement.style.clipPath = `inset(0 0 ${visibleHeight}px 0)`;
    };

    // Clip only the trailing spacer, leaving the site's own backgrounds intact.
    // Observe content resizing too (images, edits, and route changes).
    const observer = new ResizeObserver(updateClip);
    observer.observe(frameWindow.document.documentElement);
    observer.observe(spacer.parentElement!);
    frameWindow.addEventListener("scroll", updateClip);
    frameWindow.addEventListener("resize", updateClip);
    updateClip();

    return () => {
      observer.disconnect();
      frameWindow.removeEventListener("scroll", updateClip);
      frameWindow.removeEventListener("resize", updateClip);
      iframeElement.style.clipPath = previousClipPath;
    };
  }, [frameWindow, iframeElement]);

  return <div ref={spacerRef} aria-hidden style={{ height: 80, flexShrink: 0 }} />;
}
