import * as React from "react";

import { canvasPageIframe } from "../preview/previewPageFrame";
import {
  captureViewportAnchor,
  resolveViewportAnchor,
  ViewportContinuityContext,
  type ViewportAnchor,
} from "../preview/viewportContinuity";
import {
  findCanvasSnapTarget,
  CANVAS_WHEEL_ZOOM_RATE,
  canvasVerticalRail,
  canvasWheelDelta,
  constrainCanvasCamera,
  canvasMinimumScale,
  canvasOverview,
  fitCanvasPage,
  isCanvasPageScale,
  isNearCanvasPageScale,
  MAX_CANVAS_ZOOM,
  PAN_SNAP_CAPTURE,
  PAN_SNAP_RELEASE,
  placeCanvasPageAnchor,
  snapCanvasZoom,
  zoomCanvasAt,
  type CanvasCamera,
  type CanvasPoint,
  type CanvasSnapTarget,
  type CanvasVerticalRail,
} from "./canvasCamera";
import { createCanvasFlight } from "./canvasFlight";
import { canvasStore } from "./canvasStore";

const GESTURE_IDLE_MS = 180;
const CAMERA_PROPERTIES = [
  "--canvas-x",
  "--canvas-y",
  "--canvas-zoom",
  "--canvas-overlays-display",
];
const MIN_OVERLAY_ZOOM = 0.3;
/** The camera counts as moving until it has been still this long. */
const CAMERA_SETTLE_MS = 150;

function isControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest("input, select, button, a, textarea, [data-canvas-overlay-control]")
  );
}

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof Element &&
    (!!target.closest("input, select, textarea") ||
      (target instanceof HTMLElement && target.isContentEditable))
  );
}

/**
 * The Canvas row as the camera sees it: its snap targets and, when known from
 * the Canvas items, its world-space width. Heights are always measured, since
 * frames size themselves to their content.
 */
export interface CanvasCameraRow {
  targets: readonly CanvasSnapTarget[];
  width?: number;
  onSelect: (key: string) => void;
  /** The key of the selected item, if any. */
  selected?: string | null;
  /** Zooming out past the selected item's page fit leaves the selection. */
  onDeselect?: () => void;
}

/** Animate only the camera's CSS properties; page trees never rerender on pan/zoom. */
export function useCanvasCamera(
  workspaceKey: string,
  initialTarget?: { left: number; width: number },
  row?: CanvasCameraRow,
) {
  const continuity = React.useContext(ViewportContinuityContext);
  // Elements outside the Canvas viewport that follow the camera, such as the
  // Preview page frame placed over the selected Page.
  const mirrors = React.useRef(new Set<HTMLElement>());
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const initialTargetRef = React.useRef(initialTarget);
  const rowRef = React.useRef(row);
  const flightControls = React.useRef<{
    flyTo: (key: string) => void;
    cancelFlight: () => void;
    refreshFlight: () => void;
    zoomAt: (point: CanvasPoint, scale: number) => void;
    keepInView: (worldX: number, screenX: number) => void;
    fitAll: () => void;
  } | null>(null);
  const flyTo = React.useCallback((key: string) => {
    flightControls.current?.flyTo(key);
  }, []);
  const cancelFlight = React.useCallback(() => {
    flightControls.current?.cancelFlight();
  }, []);
  const zoomAt = React.useCallback((point: CanvasPoint, scale: number) => {
    flightControls.current?.zoomAt(point, scale);
  }, []);
  const paintMirror = React.useRef<((element: HTMLElement) => void) | null>(null);
  /** Paints the camera onto an element outside the viewport until the returned cleanup. */
  const mirrorCamera = React.useCallback((element: HTMLElement) => {
    mirrors.current.add(element);
    paintMirror.current?.(element);
    return () => {
      mirrors.current.delete(element);
      for (const name of CAMERA_PROPERTIES) element.style.removeProperty(name);
      delete element.dataset.canvasPan;
    };
  }, []);
  /** Pan immediately so a world x sits at or right of a screen x; never pans otherwise. */
  const keepInView = React.useCallback((worldX: number, screenX: number) => {
    flightControls.current?.keepInView(worldX, screenX);
  }, []);
  /** Zoom out to the whole Canvas, keeping the selection: its caller decides what it becomes. */
  const fitAll = React.useCallback(() => {
    flightControls.current?.fitAll();
  }, []);
  React.useLayoutEffect(() => {
    rowRef.current = row;
    flightControls.current?.refreshFlight();
  });

  React.useLayoutEffect(() => {
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
    const measureContent = () => ({
      width: rowRef.current?.width ?? content.offsetWidth,
      height: content.offsetHeight,
    });
    let contentSize = measureContent();
    let minimumScale = canvasMinimumScale(viewportSize, contentSize);
    const updateGeometry = (
      nextViewport = { width: viewport.clientWidth, height: viewport.clientHeight },
      nextContent = measureContent(),
    ) => {
      // Cache dimensions and their zoom floor together: synchronous measurements
      // can consume a resize before ResizeObserver delivers the same dimensions.
      viewportSize = nextViewport;
      contentSize = nextContent;
      minimumScale = canvasMinimumScale(viewportSize, contentSize);
    };
    // Keep the saved view as the restoration target while iframe heights load.
    // Clamping against their temporary placeholder sizes must not overwrite it.
    const saved = canvasStore.getSnapshot().context.views[workspaceKey];
    let restoredCamera = saved && !saved.fitted ? saved.camera : undefined;
    const page = initialTargetRef.current;
    let fittingInitialPage = !saved && !!page;
    const initialCamera = () =>
      fittingInitialPage && page
        ? constrainCanvasCamera(fitCanvasPage(viewportSize, page), viewportSize, contentSize)
        : canvasOverview(viewportSize, contentSize);
    let camera = restoredCamera
      ? constrainCanvasCamera(restoredCamera, viewportSize, contentSize)
      : initialCamera();
    let target = camera;
    let animation = 0;
    let previousTime = 0;
    let flight:
      | {
          /** The page the flight frames, if any, snapped to on arrival. */
          page?: CanvasSnapTarget;
          path: ReturnType<typeof createCanvasFlight>;
          startedAt?: number;
        }
      | undefined;
    // Both detents retain input independently of the displayed camera, so small
    // deltas can accumulate past a snap. A pause or input-mode change resets intent.
    let gesture:
      | { kind: "zoom"; time: number; intendedScale: number }
      | {
          kind: "pan";
          time: number;
          rail: CanvasVerticalRail;
          intendedX: number;
          source: "wheel" | "pointer" | "keyboard";
        }
      | undefined;
    const targets = () => rowRef.current?.targets ?? (page ? [{ ...page, key: "initial" }] : []);
    let snappedKey = fittingInitialPage
      ? targets().find((candidate) => candidate.left === page?.left)?.key
      : undefined;
    const pageScale = () => {
      const railPage = targets().find((candidate) =>
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
      const eligible = targets().filter((candidate) =>
        findCanvasSnapTarget(base, viewportSize, [candidate]),
      );
      const candidate = findCanvasSnapTarget(camera, viewportSize, eligible);
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
      if (snappedKey === candidate.key && isCanvasPageScale(scale, fit.scale)) return next;
      snappedKey = candidate.key;
      rowRef.current?.onSelect(candidate.key);
      // Keep the zoom anchor vertically, rather than jumping back to page top.
      return { ...next, x: fit.x };
    };
    const pan = (
      base: CanvasCamera,
      delta: CanvasPoint,
      time: number,
      source: "wheel" | "pointer" | "keyboard",
      rail: CanvasVerticalRail = { mode: "free", samples: [] },
    ) => {
      const start =
        gesture?.kind === "pan" &&
        gesture.source === source &&
        time - gesture.time < GESTURE_IDLE_MS
          ? gesture.intendedX
          : base.x;
      // Clamp raw intent too: pushing against the canvas bounds must not bank
      // invisible travel that the user has to undo when reversing direction.
      const intended = constrainCanvasCamera(
        { ...base, x: start + delta.x, y: base.y + delta.y },
        viewportSize,
        contentSize,
      );
      gesture = { kind: "pan", time, rail, intendedX: intended.x, source };
      if (!delta.x) return { ...intended, x: base.x };
      const candidate = findCanvasSnapTarget(intended, viewportSize, targets());
      const fit = candidate && fitCanvasPage(viewportSize, candidate);
      if (!candidate || !fit || !isNearCanvasPageScale(base.scale, fit.scale)) {
        snappedKey = undefined;
        return intended;
      }
      // Center at the user's actual scale; horizontal intent must not zoom or
      // change the vertical reading position just because it is near page fit.
      const centeredX =
        viewportSize.width / 2 - (candidate.left + candidate.width / 2) * base.scale;
      const held = Math.abs(base.x - centeredX) < 1e-8;
      const band = viewportSize.width * (held ? PAN_SNAP_RELEASE : PAN_SNAP_CAPTURE);
      if (Math.abs(intended.x - centeredX) > band) {
        snappedKey = undefined;
        return intended;
      }
      if (snappedKey !== candidate.key) rowRef.current?.onSelect(candidate.key);
      snappedKey = candidate.key;
      return { ...intended, x: centeredX };
    };
    const pointers = new Map<number, CanvasPoint>();
    // Like Figma, holding Space arms the hand tool; the background is otherwise
    // an ordinary surface. Middle-button and touch drags always move the camera.
    let spaceHeld = false;
    const paintPanState = () => {
      for (const element of [viewport, ...mirrors.current]) {
        if (pointers.size) element.dataset.canvasPan = "dragging";
        else if (spaceHeld) element.dataset.canvasPan = "ready";
        else delete element.dataset.canvasPan;
      }
    };
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
    // Input and flights move the camera, until it has been still for a moment.
    // Fitting it to changing geometry does not.
    let settle = 0;
    const setMoving = (moving: boolean) =>
      canvasStore.send({ type: "setCameraMoving", workspaceKey, moving });
    const markMoving = () => {
      if (!settle) setMoving(true);
      ownerWindow.clearTimeout(settle);
      settle = ownerWindow.setTimeout(() => {
        settle = 0;
        setMoving(false);
      }, CAMERA_SETTLE_MS);
    };
    const paintElement = (element: HTMLElement) => {
      element.style.setProperty("--canvas-x", `${camera.x}px`);
      element.style.setProperty("--canvas-y", `${camera.y}px`);
      element.style.setProperty("--canvas-zoom", String(camera.scale));
      element.style.setProperty(
        "--canvas-overlays-display",
        camera.scale < MIN_OVERLAY_ZOOM ? "none" : "block",
      );
    };
    paintMirror.current = (element) => {
      paintElement(element);
      paintPanState();
    };
    const paint = () => {
      paintElement(viewport);
      for (const element of mirrors.current) paintElement(element);
      remember();
    };
    const animate = (time: number) => {
      markMoving();
      if (flight) {
        flight.startedAt ??= time;
        const progress = reducedMotion.matches
          ? 1
          : Math.min(1, (time - flight.startedAt) / flight.path.duration);
        camera = progress === 1 ? target : flight.path.at(progress);
        paint();
        if (progress < 1) {
          animation = requestAnimationFrame(animate);
          return;
        }
        snappedKey = flight.page?.key;
        flight = undefined;
        animation = 0;
        previousTime = 0;
        return;
      }
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
    const cancelCameraFlight = () => {
      if (!flight) return;
      flight = undefined;
      cancelAnimationFrame(animation);
      animation = 0;
      previousTime = 0;
      target = camera;
      gesture = undefined;
    };
    const startFlight = (key: string) => {
      cancelCameraFlight();
      const destination = targets().find((candidate) => candidate.key === key);
      if (!destination) return;
      flyToCamera(() => fitCanvasPage(viewportSize, destination), destination);
    };
    const startOverviewFlight = () => {
      cancelCameraFlight();
      flyToCamera(() => canvasOverview(viewportSize, contentSize));
    };
    const flyToCamera = (destinationCamera: () => CanvasCamera, page?: CanvasSnapTarget) => {
      cancelAnimationFrame(animation);
      animation = 0;
      previousTime = 0;
      restoredCamera = undefined;
      fittingInitialPage = false;
      gesture = undefined;
      snappedKey = undefined;
      // Navigation can commit new slots before ResizeObserver runs. Measure the
      // committed DOM now so even reduced-motion arrivals use the new bounds.
      updateGeometry();
      camera = constrainCanvasCamera(camera, viewportSize, contentSize);
      target = constrainCanvasCamera(destinationCamera(), viewportSize, contentSize);
      const path = createCanvasFlight(camera, target, viewportSize, contentSize);
      if (reducedMotion.matches || path.duration === 0) {
        snappedKey = page?.key;
        applyCamera(target, true);
        return;
      }
      flight = { page: page && { ...page }, path };
      animation = requestAnimationFrame(animate);
    };
    flightControls.current = {
      flyTo: startFlight,
      cancelFlight: cancelCameraFlight,
      keepInView: (worldX, screenX) => {
        const x = screenX - worldX * camera.scale;
        if (camera.x >= x) return;
        cancelCameraFlight();
        restoredCamera = undefined;
        fittingInitialPage = false;
        gesture = undefined;
        snappedKey = undefined;
        applyCamera({ ...camera, x }, true);
      },
      refreshFlight: () => {
        if (!flight?.page) return;
        const destination = targets().find((candidate) => candidate.key === flight?.page?.key);
        if (!destination) {
          cancelCameraFlight();
          return;
        }
        if (destination.left === flight.page.left && destination.width === flight.page.width)
          return;
        // Device presets and page reordering can change geometry without a new URL.
        startFlight(destination.key);
      },
      zoomAt: (point, scale) => {
        const rect = viewport.getBoundingClientRect();
        gesture = undefined;
        snappedKey = undefined;
        move(
          zoomCanvasAt(
            target,
            { x: point.x - rect.left, y: point.y - rect.top },
            Math.min(MAX_CANVAS_ZOOM, Math.max(minimumScale, scale)),
            minimumScale,
          ),
        );
      },
      fitAll: startOverviewFlight,
    };
    const move = (next: CanvasCamera, immediate = false, deselect = true) => {
      markMoving();
      cancelCameraFlight();
      // Any new camera interaction takes precedence over the remembered view.
      restoredCamera = undefined;
      fittingInitialPage = false;
      const selected = targets().find((candidate) => candidate.key === rowRef.current?.selected);
      const selectedScale = selected && fitCanvasPage(viewportSize, selected).scale;
      if (
        deselect &&
        selectedScale !== undefined &&
        target.scale >= selectedScale - 1e-8 &&
        next.scale < selectedScale - 1e-8
      )
        rowRef.current?.onDeselect?.();
      const snapped = targets().find((candidate) => candidate.key === snappedKey);
      if (
        snapped &&
        (!findCanvasSnapTarget(next, viewportSize, [snapped]) ||
          !isNearCanvasPageScale(next.scale, fitCanvasPage(viewportSize, snapped).scale))
      )
        snappedKey = undefined;
      applyCamera(next, immediate);
    };
    const continuityBinding = {
      capture: () => {
        const snapped = targets().find((candidate) => candidate.key === snappedKey);
        // A detent can be the animation target before the painted view arrives.
        const held =
          snapped &&
          Math.abs(
            camera.x + (snapped.left + snapped.width / 2) * camera.scale - viewportSize.width / 2,
          ) < 1 &&
          isNearCanvasPageScale(camera.scale, fitCanvasPage(viewportSize, snapped).scale);
        const element =
          held &&
          Array.from(content.querySelectorAll<HTMLElement>("[data-canvas-page]")).find(
            (element) => element.dataset.canvasPage === snapped.key,
          );
        const doc = element ? canvasPageIframe(element)?.contentDocument : undefined;
        const anchor =
          doc && element
            ? captureViewportAnchor(
                doc,
                Math.max(
                  0,
                  (viewport.getBoundingClientRect().top - element.getBoundingClientRect().top) /
                    camera.scale,
                ),
              )
            : undefined;
        return {
          camera: { ...camera },
          snappedKey: held ? snappedKey : undefined,
          pathname: element ? element.dataset.canvasPathname : undefined,
          anchor,
        };
      },
      restore: (
        anchor: ViewportAnchor | undefined,
        previous: CanvasCamera | undefined,
        previousSnap?: string,
      ) => {
        const selected = initialTargetRef.current;
        const destination = targets().find((candidate) => candidate.left === selected?.left);
        if (!destination) return;
        const page = Array.from(content.querySelectorAll<HTMLElement>("[data-canvas-page]")).find(
          (element) => element.dataset.canvasPage === destination.key,
        );
        const doc = page ? canvasPageIframe(page)?.contentDocument : undefined;
        updateGeometry();
        const fit = fitCanvasPage(viewportSize, destination);
        let next = previous ?? camera;
        if (anchor && doc) {
          const scale =
            previous?.scale ?? (saved && !saved.fitted ? saved.camera.scale : fit.scale);
          const y = resolveViewportAnchor(doc, anchor);
          const frameOffsetY = page
            ? (page.getBoundingClientRect().top - viewport.getBoundingClientRect().top - camera.y) /
              camera.scale
            : 0;
          next = placeCanvasPageAnchor(viewportSize, destination, y, scale, frameOffsetY);
        }
        fittingInitialPage = false;
        restoredCamera = next;
        applyCamera(next, true);
        snappedKey = anchor
          ? isNearCanvasPageScale(camera.scale, fit.scale)
            ? destination.key
            : undefined
          : previousSnap;
      },
    };
    // oxlint-disable-next-line react/immutability -- the continuity store is a mutable object shared outside React
    if (continuity) continuity.canvas = continuityBinding;
    const resize = new ResizeObserver(() => {
      const nextViewport = { width: viewport.clientWidth, height: viewport.clientHeight };
      const nextContent = measureContent();
      if (
        nextViewport.width === viewportSize.width &&
        nextViewport.height === viewportSize.height &&
        nextContent.width === contentSize.width &&
        nextContent.height === contentSize.height
      )
        return;
      const wasFitted = Math.abs(target.scale - minimumScale) < 1e-8;
      gesture = undefined;
      if (nextViewport.width !== viewportSize.width) snappedKey = undefined;
      updateGeometry(nextViewport, nextContent);
      if (flight) {
        // Iframe sizing and window resizes must not jump to the old destination.
        camera = constrainCanvasCamera(camera, viewportSize, contentSize);
        if (flight.page) startFlight(flight.page.key);
        else startOverviewFlight();
        return;
      }
      if (restoredCamera) {
        applyCamera(restoredCamera, true);
        return;
      }
      if (fittingInitialPage) {
        applyCamera(initialCamera(), true);
        snappedKey = targets().find((candidate) => candidate.left === page?.left)?.key;
        return;
      }
      // Stay in overview while pages finish loading. Once zoomed in, preserve
      // the working view and only correct positions invalidated by new bounds.
      camera = constrainCanvasCamera(camera, viewportSize, contentSize);
      applyCamera(wasFitted ? canvasOverview(viewportSize, contentSize) : target, true);
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
      // Interrupt before computing intent so input starts at the painted view,
      // not the offscreen destination of an unfinished navigation.
      cancelCameraFlight();
      if (event.ctrlKey || event.metaKey) {
        const point = localPoint(event.clientX, event.clientY);
        move(zoom(target, point, Math.exp(-dy * CANVAS_WHEEL_ZOOM_RATE), event.timeStamp));
        return;
      }
      const previous =
        gesture?.kind === "pan" &&
        gesture.source === "wheel" &&
        event.timeStamp - gesture.time < GESTURE_IDLE_MS
          ? gesture.rail
          : undefined;
      const rail: CanvasVerticalRail =
        !event.shiftKey && !pointers.size && isCanvasPageScale(target.scale, pageScale())
          ? canvasVerticalRail({ x: dx, y: dy }, event.timeStamp, previous)
          : { mode: "free", samples: [] };
      const vertical = rail.mode === "vertical";
      move(
        pan(
          target,
          {
            x: -(vertical ? 0 : event.shiftKey && dx === 0 ? dy : dx),
            y: -(event.shiftKey && dx === 0 ? 0 : dy),
          },
          event.timeStamp,
          "wheel",
          rail,
        ),
      );
    };
    const onPointerDown = (event: PointerEvent) => {
      const pans =
        event.button === 1 || (event.button === 0 && (spaceHeld || event.pointerType === "touch"));
      if (!pans || (!spaceHeld && isControl(event.target))) return;
      gesture = undefined;
      event.preventDefault();
      viewport.focus({ preventScroll: true });
      move(camera, true);
      pointers.set(event.pointerId, localPoint(event.clientX, event.clientY));
      viewport.setPointerCapture(event.pointerId);
      paintPanState();
    };
    const onPointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const next = localPoint(event.clientX, event.clientY);
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      pointers.set(event.pointerId, next);
      if (!other) {
        move(
          pan(
            camera,
            { x: next.x - previous.x, y: next.y - previous.y },
            event.timeStamp,
            "pointer",
          ),
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
      if (pointers.size) return;
      paintPanState();
    };
    const ownsSpace = (target: EventTarget | null) => {
      const doc = viewport.ownerDocument;
      if (target === doc.body || target === doc.documentElement) return true;
      if (!(target instanceof Node) || !viewport.contains(target) || isTextEntry(target))
        return false;
      // Keyboard users still activate a focused canvas control with Space.
      return !(isControl(target) && (target as Element).matches(":focus-visible"));
    };
    const onSpaceDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!spaceHeld && !ownsSpace(event.target)) return;
      // Also stops the page from scrolling and a mouse-focused button from clicking.
      event.preventDefault();
      if (spaceHeld) return;
      spaceHeld = true;
      paintPanState();
    };
    const onSpaceUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceHeld) return;
      event.preventDefault();
      spaceHeld = false;
      paintPanState();
    };
    const releaseSpace = () => {
      spaceHeld = false;
      paintPanState();
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
      gesture = undefined;
      move({ ...camera, x: camera.x + dx, y: camera.y + dy }, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isControl(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        ["+", "=", "-", "0", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) ||
        (event.shiftKey && event.code === "Digit1")
      )
        cancelCameraFlight();
      const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        gesture = undefined;
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
        gesture = undefined;
        event.preventDefault();
        move(zoomCanvasAt(target, center, 1, minimumScale));
        return;
      }
      if (event.key === "Home" || (event.shiftKey && event.code === "Digit1")) {
        gesture = undefined;
        event.preventDefault();
        move(canvasOverview(viewportSize, contentSize));
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
      move(pan(target, direction, event.timeStamp, "keyboard"));
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
    ownerWindow.addEventListener("keydown", onSpaceDown);
    ownerWindow.addEventListener("keyup", onSpaceUp);
    ownerWindow.addEventListener("blur", releaseSpace);
    return () => {
      if (continuity?.canvas === continuityBinding) continuity.canvas = null;
      flightControls.current = null;
      ownerWindow.removeEventListener("wheel", preventHistorySwipe, { capture: true });
      if (overscrollX)
        rootStyle.setProperty("overscroll-behavior-x", overscrollX, overscrollPriority);
      else rootStyle.removeProperty("overscroll-behavior-x");
      remember();
      cancelAnimationFrame(animation);
      ownerWindow.clearTimeout(settle);
      setMoving(false);
      resize.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerEnd);
      viewport.removeEventListener("lostpointercapture", onPointerEnd);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("focusin", onFocusIn);
      ownerWindow.removeEventListener("keydown", onSpaceDown);
      ownerWindow.removeEventListener("keyup", onSpaceUp);
      ownerWindow.removeEventListener("blur", releaseSpace);
      delete viewport.dataset.canvasPan;
      paintMirror.current = null;
    };
  }, [workspaceKey, continuity]);

  return {
    viewportRef,
    contentRef,
    flyTo,
    cancelFlight,
    zoomAt,
    mirrorCamera,
    keepInView,
    fitAll,
  };
}
