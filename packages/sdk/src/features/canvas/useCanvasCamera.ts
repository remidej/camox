import * as React from "react";

import {
  canvasSnapPage,
  canvasVerticalRail,
  canvasWheelDelta,
  constrainCanvasCamera,
  fitCanvas,
  fitCanvasPage,
  isCanvasPageScale,
  MAX_CANVAS_ZOOM,
  snapCanvasZoom,
  zoomCanvasAt,
  type CanvasCamera,
  type CanvasPoint,
  type CanvasSnapPage,
  type CanvasVerticalRail,
} from "./canvasCamera";
import { canvasStore } from "./canvasStore";

const GESTURE_IDLE_MS = 180;

function isControl(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, select, button, a, textarea");
}

/** Animate only the camera's CSS properties; page trees never rerender on pan/zoom. */
export function useCanvasCamera(
  workspaceKey: string,
  initialPage?: { left: number; width: number },
  snapping?: { pages: readonly CanvasSnapPage[]; onSelect: (key: string) => void },
) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const initialPageRef = React.useRef(initialPage);
  const snappingRef = React.useRef(snapping);
  React.useLayoutEffect(() => {
    snappingRef.current = snapping;
  });

  React.useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    // The transformed, overflow:clip canvas is not a native scroll container.
    // Contain horizontal overscroll at the document too, so trackpad swipes
    // cannot turn into browser Back/Forward gestures at the camera's bounds.
    const rootStyle = viewport.ownerDocument.documentElement.style;
    const overscrollX = rootStyle.getPropertyValue("overscroll-behavior-x");
    const overscrollPriority = rootStyle.getPropertyPriority("overscroll-behavior-x");
    rootStyle.setProperty("overscroll-behavior-x", "none");
    // Register at the window in capture phase, not just on the clipped canvas.
    // The browser must know it cannot claim a horizontal gesture anywhere in
    // this workspace (including gestures starting on the surrounding chrome).
    const ownerWindow = viewport.ownerDocument.defaultView!;
    const preventHistorySwipe = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.deltaX !== 0 || (event.shiftKey && event.deltaY !== 0)) event.preventDefault();
    };
    ownerWindow.addEventListener("wheel", preventHistorySwipe, { capture: true, passive: false });

    let viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight };
    let contentSize = { width: content.offsetWidth, height: content.offsetHeight };
    let minimumScale = fitCanvas(viewportSize, contentSize).scale;
    // Keep the saved view as the restoration target while iframe heights load.
    // Clamping against their temporary placeholder sizes must not overwrite it.
    const saved = canvasStore.getSnapshot().context.views[workspaceKey];
    let restoredCamera = saved && !saved.fitted ? saved.camera : undefined;
    const page = initialPageRef.current;
    let fittingInitialPage = !saved && !!page;
    const initialCamera = () =>
      fittingInitialPage && page
        ? constrainCanvasCamera(fitCanvasPage(viewportSize, page), viewportSize, contentSize)
        : fitCanvas(viewportSize, contentSize);
    let camera = restoredCamera
      ? constrainCanvasCamera(restoredCamera, viewportSize, contentSize)
      : initialCamera();
    let target = camera;
    let animation = 0;
    let previousTime = 0;
    // A pause or input-mode change starts a fresh gesture. No timers or extra
    // camera coordinates: zoom retains only unconsumed intent, pan only its rail.
    let gesture:
      | { kind: "zoom"; time: number; intendedScale: number }
      | { kind: "pan"; time: number; rail: CanvasVerticalRail }
      | undefined;
    let snappedKey: string | undefined;
    const pages = () => snappingRef.current?.pages ?? (page ? [{ ...page, key: "initial" }] : []);
    const pageScale = () => {
      const railPage = pages().find((candidate) =>
        isCanvasPageScale(target.scale, fitCanvasPage(viewportSize, candidate).scale),
      );
      if (!railPage) return undefined;
      const scale = fitCanvasPage(viewportSize, railPage).scale;
      return scale >= minimumScale ? scale : undefined;
    };
    const zoom = (
      base: CanvasCamera,
      point: CanvasPoint,
      factor: number,
      time: number,
      translation = { x: 0, y: 0 },
    ) => {
      const scale = base.scale;
      const start =
        gesture?.kind === "zoom" && time - gesture.time < GESTURE_IDLE_MS
          ? gesture.intendedScale
          : scale;
      const intendedScale = Math.min(MAX_CANVAS_ZOOM, Math.max(minimumScale, start * factor));
      gesture = { kind: "zoom", time, intendedScale };
      // Check both the painted view and the pending camera: animation must not
      // let an offscreen page attract the next wheel event.
      const eligible = pages().filter((candidate) =>
        canvasSnapPage(base, viewportSize, [candidate]),
      );
      const candidate = canvasSnapPage(camera, viewportSize, eligible);
      const fit = candidate && fitCanvasPage(viewportSize, candidate);
      const nextScale = snapCanvasZoom(
        scale,
        intendedScale,
        fit && fit.scale >= minimumScale ? fit.scale : undefined,
      );
      const anchored = zoomCanvasAt(base, point, nextScale, minimumScale);
      const next = {
        ...anchored,
        x: anchored.x + translation.x,
        y: anchored.y + translation.y,
      };
      if (!candidate || !fit || !isCanvasPageScale(nextScale, fit.scale)) {
        snappedKey = undefined;
        return next;
      }
      if (snappedKey === candidate.key) return next;
      snappedKey = candidate.key;
      snappingRef.current?.onSelect(candidate.key);
      // Keep the zoom anchor vertically, rather than jumping back to page top.
      return { ...next, x: fit.x };
    };
    const pointers = new Map<number, CanvasPoint>();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const remember = () => {
      if (restoredCamera || fittingInitialPage || !viewportSize.width || !viewportSize.height)
        return;
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
      fittingInitialPage = false;
      const snapped = pages().find((candidate) => candidate.key === snappedKey);
      if (
        snapped &&
        (!canvasSnapPage(next, viewportSize, [snapped]) ||
          !isCanvasPageScale(next.scale, fitCanvasPage(viewportSize, snapped).scale))
      )
        snappedKey = undefined;
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
      gesture = undefined;
      snappedKey = undefined;
      viewportSize = nextViewport;
      contentSize = nextContent;
      minimumScale = fitCanvas(viewportSize, contentSize).scale;
      if (restoredCamera) {
        applyCamera(restoredCamera, true);
        return;
      }
      if (fittingInitialPage) {
        applyCamera(initialCamera(), true);
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
      // Wheel gestures belong to the camera even over header controls.
      // Pointer and keyboard events still retain normal control behavior.
      event.preventDefault();
      const dx = canvasWheelDelta(event.deltaX, event.deltaMode, viewport.clientWidth);
      const dy = canvasWheelDelta(event.deltaY, event.deltaMode, viewport.clientHeight);
      if (!dx && !dy) return;
      if (event.ctrlKey || event.metaKey) {
        const point = localPoint(event.clientX, event.clientY);
        move(zoom(target, point, Math.exp(-dy * 0.008), event.timeStamp));
        return;
      }
      const previous =
        gesture?.kind === "pan" && event.timeStamp - gesture.time < GESTURE_IDLE_MS
          ? gesture.rail
          : undefined;
      const rail: CanvasVerticalRail =
        !event.shiftKey && !pointers.size && isCanvasPageScale(target.scale, pageScale())
          ? canvasVerticalRail({ x: dx, y: dy }, event.timeStamp, previous)
          : { mode: "free", samples: [] };
      const vertical = rail.mode === "vertical";
      gesture = { kind: "pan", time: event.timeStamp, rail };
      move({
        ...target,
        x: target.x - (vertical ? 0 : event.shiftKey && dx === 0 ? dy : dx),
        y: target.y - (event.shiftKey && dx === 0 ? 0 : dy),
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isControl(event.target) || (event.button !== 0 && event.button !== 1)) return;
      gesture = undefined;
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
      const zoomed = zoom(camera, oldCenter, distance / Math.max(1, oldDistance), event.timeStamp, {
        x: center.x - oldCenter.x,
        y: center.y - oldCenter.y,
      });
      move(zoomed, true);
    };
    const onPointerEnd = (event: PointerEvent) => {
      gesture = undefined;
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
      gesture = undefined;
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
      ownerWindow.removeEventListener("wheel", preventHistorySwipe, { capture: true });
      if (overscrollX)
        rootStyle.setProperty("overscroll-behavior-x", overscrollX, overscrollPriority);
      else rootStyle.removeProperty("overscroll-behavior-x");
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
