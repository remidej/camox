import * as React from "react";

/**
 * Keep the Canvas camera working over an interactive frame: forward its wheel
 * input, and the Space key that arms the hand tool, to the host document. They
 * bubble from the frame, unless it sits outside the Canvas and names the
 * element to dispatch them on.
 */
export function useCanvasFrameInput(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  mount: HTMLElement | null,
  target?: HTMLElement | null,
) {
  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !mount) return;
    const host = target ?? iframe;
    const doc = mount.ownerDocument;
    // Native wheel events do not bubble out of a document. Keep the existing
    // camera behavior over interactive frames, using host-space coordinates.
    const forwardWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = iframe.getBoundingClientRect();
      const scale = rect.width / iframe.offsetWidth;
      host.dispatchEvent(
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
    // Space arms the canvas hand tool even while focus is inside the frame, but
    // never while typing into its content.
    const forwardSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest?.("input, select, textarea")) return;
      const forwarded = new KeyboardEvent(event.type, {
        bubbles: true,
        cancelable: true,
        code: event.code,
        key: event.key,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });
      host.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) event.preventDefault();
    };
    doc.addEventListener("wheel", forwardWheel, { passive: false });
    doc.addEventListener("keydown", forwardSpace);
    doc.addEventListener("keyup", forwardSpace);
    return () => {
      doc.removeEventListener("wheel", forwardWheel);
      doc.removeEventListener("keydown", forwardSpace);
      doc.removeEventListener("keyup", forwardSpace);
    };
  }, [iframeRef, mount, target]);
}
