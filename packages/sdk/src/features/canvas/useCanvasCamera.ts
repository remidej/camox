import * as React from "react";

import {
  canvasWheelDelta,
  constrainCanvasCamera,
  fitCanvas,
  zoomCanvasAt,
  type CanvasCamera,
  type CanvasPoint,
} from "./canvasCamera";
import { canvasStore } from "./canvasStore";

function isControl(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, select, button, a, textarea");
}

/** Animate only the camera's CSS properties; page trees never rerender on pan/zoom. */
export function useCanvasCamera(workspaceKey: string) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight };
    let contentSize = { width: content.offsetWidth, height: content.offsetHeight };
    let minimumScale = fitCanvas(viewportSize, contentSize).scale;
    // Keep the saved view as the restoration target while iframe heights load.
    // Clamping against their temporary placeholder sizes must not overwrite it.
    const saved = canvasStore.getSnapshot().context.views[workspaceKey];
    let restoredCamera = saved && !saved.fitted ? saved.camera : undefined;
    let camera = restoredCamera
      ? constrainCanvasCamera(restoredCamera, viewportSize, contentSize)
      : fitCanvas(viewportSize, contentSize);
    let target = camera;
    let animation = 0;
    let previousTime = 0;
    const pointers = new Map<number, CanvasPoint>();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const remember = () => {
      if (restoredCamera || !viewportSize.width || !viewportSize.height) return;
      canvasStore.send({
        type: "rememberView",
        workspaceKey,
        view: { camera, fitted: Math.abs(camera.scale - minimumScale) < 1e-8 },
      });
    };
    const paint = () => {
      viewport.style.setProperty("--canvas-x", `${camera.x}px`);
      viewport.style.setProperty("--canvas-y", `${camera.y}px`);
      viewport.style.setProperty("--canvas-zoom", String(camera.scale));
      remember();
    };
    const animate = (time: number) => {
      const elapsed = previousTime ? Math.min(64, time - previousTime) : 16;
      previousTime = time;
      const amount = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / 55);
      camera = {
        x: camera.x + (target.x - camera.x) * amount,
        y: camera.y + (target.y - camera.y) * amount,
        scale: camera.scale + (target.scale - camera.scale) * amount,
      };
      camera = constrainCanvasCamera(camera, viewportSize, contentSize);
      const settled =
        Math.abs(camera.x - target.x) < 0.05 &&
        Math.abs(camera.y - target.y) < 0.05 &&
        Math.abs(camera.scale - target.scale) < 0.0001;
      if (settled) camera = target;
      paint();
      animation = settled ? 0 : requestAnimationFrame(animate);
      if (settled) previousTime = 0;
    };
    const applyCamera = (next: CanvasCamera, immediate = false) => {
      target = constrainCanvasCamera(next, viewportSize, contentSize);
      if (immediate) {
        cancelAnimationFrame(animation);
        animation = 0;
        previousTime = 0;
        camera = target;
        paint();
        return;
      }
      if (!animation) animation = requestAnimationFrame(animate);
    };
    const move = (next: CanvasCamera, immediate = false) => {
      // Any new camera interaction takes precedence over the remembered view.
      restoredCamera = undefined;
      applyCamera(next, immediate);
    };
    const resize = new ResizeObserver(() => {
      const nextViewport = { width: viewport.clientWidth, height: viewport.clientHeight };
      const nextContent = { width: content.offsetWidth, height: content.offsetHeight };
      if (
        nextViewport.width === viewportSize.width &&
        nextViewport.height === viewportSize.height &&
        nextContent.width === contentSize.width &&
        nextContent.height === contentSize.height
      )
        return;
      const wasFitted = Math.abs(target.scale - minimumScale) < 1e-8;
      viewportSize = nextViewport;
      contentSize = nextContent;
      minimumScale = fitCanvas(viewportSize, contentSize).scale;
      if (restoredCamera) {
        applyCamera(restoredCamera, true);
        return;
      }
      // Stay in overview while pages finish loading. Once zoomed in, preserve
      // the working view and only correct positions invalidated by new bounds.
      camera = constrainCanvasCamera(camera, viewportSize, contentSize);
      applyCamera(wasFitted ? fitCanvas(viewportSize, contentSize) : target, true);
    });
    resize.observe(viewport);
    resize.observe(content);
    const localPoint = (x: number, y: number): CanvasPoint => {
      const rect = viewport.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };
    const onWheel = (event: WheelEvent) => {
      if (isControl(event.target) && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const dx = canvasWheelDelta(event.deltaX, event.deltaMode, viewport.clientWidth);
      const dy = canvasWheelDelta(event.deltaY, event.deltaMode, viewport.clientHeight);
      if (event.ctrlKey || event.metaKey) {
        const point = localPoint(event.clientX, event.clientY);
        move(zoomCanvasAt(target, point, target.scale * Math.exp(-dy * 0.008), minimumScale));
        return;
      }
      move({
        ...target,
        x: target.x - (event.shiftKey && dx === 0 ? dy : dx),
        y: target.y - (event.shiftKey && dx === 0 ? 0 : dy),
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isControl(event.target) || (event.button !== 0 && event.button !== 1)) return;
      event.preventDefault();
      viewport.focus({ preventScroll: true });
      move(camera, true);
      pointers.set(event.pointerId, localPoint(event.clientX, event.clientY));
      viewport.setPointerCapture(event.pointerId);
      viewport.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const next = localPoint(event.clientX, event.clientY);
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      pointers.set(event.pointerId, next);
      if (!other) {
        move(
          { ...camera, x: camera.x + next.x - previous.x, y: camera.y + next.y - previous.y },
          true,
        );
        return;
      }
      const oldCenter = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
      const center = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
      const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
      const distance = Math.hypot(next.x - other.x, next.y - other.y);
      const zoomed = zoomCanvasAt(
        camera,
        oldCenter,
        camera.scale * (distance / Math.max(1, oldDistance)),
        minimumScale,
      );
      move(
        { ...zoomed, x: zoomed.x + center.x - oldCenter.x, y: zoomed.y + center.y - oldCenter.y },
        true,
      );
    };
    const onPointerEnd = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) viewport.style.cursor = "grab";
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isControl(event.target)) return;
      const rect = (event.target as Element).getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      const dx =
        Math.max(0, bounds.left + 16 - rect.left) - Math.max(0, rect.right - bounds.right + 16);
      const dy =
        Math.max(0, bounds.top + 16 - rect.top) - Math.max(0, rect.bottom - bounds.bottom + 16);
      if (!dx && !dy) return;
      // overflow:clip prevents focus from scrolling a second, hidden coordinate
      // system. Bring offscreen controls into view using the camera instead.
      move({ ...camera, x: camera.x + dx, y: camera.y + dy }, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isControl(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        move(
          zoomCanvasAt(
            target,
            center,
            target.scale * (event.key === "-" ? 0.8 : 1.25),
            minimumScale,
          ),
        );
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        move(zoomCanvasAt(target, center, 1, minimumScale));
        return;
      }
      if (event.key === "Home" || (event.shiftKey && event.code === "Digit1")) {
        event.preventDefault();
        move(fitCanvas(viewportSize, contentSize));
        return;
      }
      const directions: Record<string, CanvasPoint> = {
        ArrowLeft: { x: 100, y: 0 },
        ArrowRight: { x: -100, y: 0 },
        ArrowUp: { x: 0, y: 100 },
        ArrowDown: { x: 0, y: -100 },
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      move({ ...target, x: target.x + direction.x, y: target.y + direction.y });
    };

    paint();
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerEnd);
    viewport.addEventListener("pointercancel", onPointerEnd);
    viewport.addEventListener("lostpointercapture", onPointerEnd);
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("focusin", onFocusIn);
    return () => {
      remember();
      cancelAnimationFrame(animation);
      resize.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerEnd);
      viewport.removeEventListener("lostpointercapture", onPointerEnd);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("focusin", onFocusIn);
    };
  }, [workspaceKey]);

  return { viewportRef, contentRef };
}
