import * as React from "react";

/** Frames count as near this far outside the Canvas viewport, relative to its size. */
const NEAR_MARGIN = "100%";

/**
 * Whether an element is near the Canvas viewport as the camera moves, and
 * whether it has ever been. Frames mount once they first come near, and only
 * stay live while near.
 */
export function useCanvasNearness(ref: React.RefObject<Element | null>) {
  const [near, setNear] = React.useState(false);
  const [reached, setReached] = React.useState(false);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        setNear(entry.isIntersecting);
        if (entry.isIntersecting) setReached(true);
      },
      { root: element.closest("[data-camox-canvas]"), rootMargin: NEAR_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return { near, reached };
}
