import * as React from "react";

import { canvasPageIframe } from "../preview/previewPageFrame";
import { revealScrollDelta } from "../preview/selectionReveal";
import {
  captureViewportAnchor,
  resolveViewportAnchor,
  ViewportContinuityContext,
  type ViewportAnchor,
} from "../preview/viewportContinuity";
import {
  findCanvasSnapTarget,
  CANVAS_WHEEL_ZOOM_RATE,
  canvasMaximumScale,
  canvasVerticalRail,
  canvasWheelDelta,
  constrainCanvasCamera,
  canvasMinimumScale,
  canvasOverview,
  fitCanvasPage,
  isCanvasCameraSnapped,
  isCanvasPageScale,
  PAN_SNAP_CAPTURE,
  PAN_SNAP_RELEASE,
  placeCanvasPageAnchor,
  snapCanvasZoom,
  stretchCanvasZoom,
  ZOOM_STRETCH,
  unstretchCanvasZoom,
  zoomCanvasAt,
  type CanvasCamera,
  type CanvasPoint,
  type CanvasSnapTarget,
  type CanvasVerticalRail,
} from "./canvasCamera";
import { createCanvasFlight, createCanvasPan } from "./canvasFlight";
import { canvasBlockOverlap } from "./canvasFrameDocument";
import { canvasStore } from "./canvasStore";

const GESTURE_IDLE_MS = 180;
/** A zoom ends once its input pauses this long; a stretch past a limit then springs back. */
const ZOOM_END_MS = 120;
const CAMERA_PROPERTIES = ["--canvas-x", "--canvas-y", "--canvas-zoom", "--canvas-pixel-ratio"];
/** The camera counts as moving until it has been still this long. */
const CAMERA_SETTLE_MS = 150;
/**
 * At rest, zooms where layers that scale with the camera stay promoted
 * (`data-canvas-promoted`, for `will-change: transform`), so a movement starts
 * on tiles already drawn. Below this range a promoted layer keeps the larger
 * raster scale it had and runs out of tile memory; above it, the raster blurs.
 * Outside it, layers are promoted only while the camera moves, so the browser
 * re-rasters them at their zoom once it settles.
 */
const PROMOTED_ZOOM_RANGE = { min: 0.25, max: 1 };

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
 * The camera's y at a new scale, keeping the document point at the viewport's
 * top edge. Above the page top, the unscaled chrome keeps its screen position.
 */
function rescaleY(camera: CanvasCamera, scale: number) {
  return camera.y > 0 ? camera.y : (camera.y * scale) / camera.scale;
}

/**
 * The Canvas row as the camera sees it: its snap targets and, when known from
 * the Canvas items, its world-space width. Heights are always measured, since
 * frames size themselves to their content.
 */
export interface CanvasCameraRow {
  targets: readonly CanvasSnapTarget[];
  width?: number;
  /** The camera snapped to an item. */
  onSelect: (key: string) => void;
  /**
   * The camera snapped onto an item from a scroll, swipe or zoom. A zoom that
   * stretches past the snap reports it as it springs back.
   */
  onSnap?: () => void;
  /** A zoom kept going past the snap it reported, which it reports again as it springs back. */
  onSnapStretched?: () => void;
  /**
   * The key of the selected item, if any. A selection is a snapped camera: the
   * camera flies to an item selected from anywhere else.
   */
  selected?: string | null;
  /** The camera left the selected item's snap, so it is no longer selected. */
  onDeselect?: () => void;
  /** The editor panned or zoomed the camera themselves, as opposed to a flight or a resize. */
  onEditorMove?: () => void;
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
    syncRow: () => void;
    keepInView: (worldX: number, screenX: number) => void;
    reveal: (element: Element, immediate: boolean) => void;
    fitAll: () => void;
  } | null>(null);
  const flyTo = React.useCallback((key: string) => {
    flightControls.current?.flyTo(key);
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
      delete element.dataset.canvasPromoted;
      delete element.dataset.canvasBlockOverlap;
    };
  }, []);
  /**
   * Pan immediately so a world x sits at or right of a screen x; never pans
   * otherwise, nor while a selection holds the camera.
   */
  const keepInView = React.useCallback((worldX: number, screenX: number) => {
    flightControls.current?.keepInView(worldX, screenX);
  }, []);
  /**
   * Pan vertically to an element inside a Canvas frame, such as a selected block,
   * unless enough of it already shows. A page flight or a drag in progress keeps the camera.
   */
  const reveal = React.useCallback((element: Element, immediate = false) => {
    flightControls.current?.reveal(element, immediate);
  }, []);
  /** Zoom out to the whole Canvas, keeping the selection: its caller decides what it becomes. */
  const fitAll = React.useCallback(() => {
    flightControls.current?.fitAll();
  }, []);
  React.useLayoutEffect(() => {
    rowRef.current = row;
    flightControls.current?.syncRow();
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
    const page = initialTargetRef.current;
    const targets = () => rowRef.current?.targets ?? (page ? [{ ...page, key: "initial" }] : []);
    const targetOf = (key: string | null | undefined) =>
      key == null ? undefined : targets().find((candidate) => candidate.key === key);
    // A zoom past a limit, which springs back at the end of its input.
    let stretch: { point: CanvasPoint } | undefined;
    // Pinches end when their pointers lift, other zooms when their input pauses.
    let zoomEnd = 0;
    // The item a zoom snapped onto, until the zoom ends: a stretch past it
    // defers its report to the spring-back.
    let landing: { key: string; stretched: boolean } | undefined;
    // Page fit is the zoom ceiling: the camera can't zoom in past where it snaps.
    // Zooming past a limit only stretches the view, as long as its input lasts.
    const constrain = (next: CanvasCamera, stretched = !!stretch) =>
      constrainCanvasCamera(
        next,
        viewportSize,
        contentSize,
        canvasMaximumScale(viewportSize, targets(), minimumScale),
        stretched,
      );
    // Keep the saved view as the restoration target while iframe heights load.
    // Clamping against their temporary placeholder sizes must not overwrite it.
    // A selected page is always snapped: restore a saved view of it, or fit it.
    const saved = canvasStore.getSnapshot().context.views[workspaceKey];
    const savedCamera = saved && !saved.fitted ? saved.camera : undefined;
    let restoredCamera =
      savedCamera && (!page || isCanvasCameraSnapped(savedCamera, viewportSize, page))
        ? savedCamera
        : undefined;
    let fittingInitialPage = !!page && !restoredCamera;
    const initialCamera = () =>
      fittingInitialPage && page
        ? constrain(fitCanvasPage(viewportSize, page))
        : canvasOverview(viewportSize, contentSize);
    let camera = restoredCamera ? constrain(restoredCamera) : initialCamera();
    let target = camera;
    let animation = 0;
    let previousTime = 0;
    let flight:
      | {
          /** The page the flight frames, if any, snapped to on arrival. */
          page?: CanvasSnapTarget;
          /** A pan that reveals an element, which another reveal may redirect. */
          pan?: boolean;
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
    // The selected item, which the camera holds snapped. `requested` is the
    // selection last given by the row, to tell its changes from the camera's own.
    let requested = rowRef.current?.selected ?? null;
    let selection =
      requested ??
      (page && targets().find((candidate) => candidate.left === page.left)?.key) ??
      null;
    const select = (key: string | null) => {
      if (key === selection) return;
      selection = key;
      if (key) rowRef.current?.onSelect(key);
      else rowRef.current?.onDeselect?.();
    };
    // Where a stretched camera springs back to: the zoom limit, keeping the
    // stretch's anchor, and centered on the selection it holds snapped.
    const rest = (next: CanvasCamera) => {
      if (!stretch) return next;
      const maximumScale = canvasMaximumScale(viewportSize, targets(), minimumScale);
      const scale = Math.min(maximumScale, Math.max(minimumScale, next.scale));
      const settled = zoomCanvasAt(next, stretch.point, scale, minimumScale, maximumScale);
      const held = targetOf(selection);
      const fit = held && fitCanvasPage(viewportSize, held);
      return constrain(
        fit && isCanvasPageScale(scale, fit.scale) ? { ...settled, x: fit.x } : settled,
        false,
      );
    };
    // Input that leaves the selected item's snap leaves the selection. A
    // stretched camera holds it, as it springs back to the snap.
    const releaseSelection = () => {
      const held = targetOf(selection);
      if (selection && !(held && isCanvasCameraSnapped(rest(target), viewportSize, held)))
        select(null);
    };
    const zoom = (
      base: CanvasCamera,
      point: CanvasPoint,
      factor: number,
      time: number,
      translation = { x: 0, y: 0 },
    ) => {
      const scale = base.scale;
      const maximumScale = canvasMaximumScale(viewportSize, targets(), minimumScale);
      const start =
        gesture?.kind === "zoom" && time - gesture.time < GESTURE_IDLE_MS
          ? gesture.intendedScale
          : unstretchCanvasZoom(scale, minimumScale, maximumScale);
      // Intent past a limit is kept, so reversing a stretch undoes it gradually.
      const intendedScale = start * factor;
      gesture = { kind: "zoom", time, intendedScale };
      const limited = Math.min(maximumScale, Math.max(minimumScale, intendedScale));
      // Check both the painted view and the pending camera: animation must not
      // let an offscreen page attract the next wheel event. A stretch keeps the
      // selection it springs back to.
      const eligible = targets().filter((candidate) =>
        findCanvasSnapTarget(base, viewportSize, [candidate]),
      );
      const candidate =
        (stretch && targetOf(selection)) || findCanvasSnapTarget(camera, viewportSize, eligible);
      const fit = candidate && fitCanvasPage(viewportSize, candidate);
      const snapped = snapCanvasZoom(
        scale,
        limited,
        fit && fit.scale >= minimumScale ? fit.scale : undefined,
      );
      const stretched = limited !== intendedScale;
      const nextScale = stretched
        ? stretchCanvasZoom(intendedScale, minimumScale, maximumScale)
        : snapped;
      ownerWindow.clearTimeout(zoomEnd);
      if (!pointers.size) zoomEnd = ownerWindow.setTimeout(endZoom, ZOOM_END_MS);
      stretch = stretched ? { point } : undefined;
      const anchored = zoomCanvasAt(
        base,
        point,
        nextScale,
        minimumScale / Math.exp(ZOOM_STRETCH),
        maximumScale * Math.exp(ZOOM_STRETCH),
      );
      const next = {
        ...anchored,
        x: anchored.x + translation.x,
        y: anchored.y + translation.y,
      };
      if (!candidate || !fit || !isCanvasPageScale(snapped, fit.scale)) return next;
      const entered = selection !== candidate.key;
      if (entered) landing = { key: candidate.key, stretched: stretched };
      else if (stretched && landing && !landing.stretched) {
        landing.stretched = true;
        rowRef.current?.onSnapStretched?.();
      }
      if (entered && !stretched) rowRef.current?.onSnap?.();
      select(candidate.key);
      // Keep the zoom anchor vertically, rather than jumping back to page top.
      // A stretch stays centered on the page it springs back to.
      return {
        ...next,
        x: (viewportSize.width - candidate.width * nextScale) / 2 - candidate.left * nextScale,
      };
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
      const intended = constrain({ ...base, x: start + delta.x, y: base.y + delta.y });
      gesture = { kind: "pan", time, rail, intendedX: intended.x, source };
      if (!delta.x) return { ...intended, x: base.x };
      // The horizontal detent holds only at page fit, where the camera snaps.
      const candidate = findCanvasSnapTarget(intended, viewportSize, targets());
      const fit = candidate && fitCanvasPage(viewportSize, candidate);
      if (!candidate || !fit || !isCanvasPageScale(base.scale, fit.scale)) return intended;
      const held = Math.abs(base.x - fit.x) < 1e-8;
      const band = viewportSize.width * (held ? PAN_SNAP_RELEASE : PAN_SNAP_CAPTURE);
      if (Math.abs(intended.x - fit.x) > band) return intended;
      if (selection !== candidate.key) rowRef.current?.onSnap?.();
      select(candidate.key);
      return { ...intended, x: fit.x };
    };
    // The end of a zoom: a stretch past a limit springs back to it.
    const endZoom = () => {
      ownerWindow.clearTimeout(zoomEnd);
      if (stretch) {
        const next = rest(target);
        stretch = undefined;
        gesture = undefined;
        markMoving();
        applyCamera(next);
      }
      if (landing?.stretched && landing.key === selection) rowRef.current?.onSnap?.();
      landing = undefined;
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
    const paintPromotion = () => {
      const promoted =
        !!settle ||
        (camera.scale >= PROMOTED_ZOOM_RANGE.min && camera.scale <= PROMOTED_ZOOM_RANGE.max);
      for (const element of [viewport, ...mirrors.current]) {
        if (promoted === "canvasPromoted" in element.dataset) continue;
        if (promoted) element.dataset.canvasPromoted = "";
        else delete element.dataset.canvasPromoted;
      }
    };
    // Overlapping blocks reflows their frames, so it changes only at rest.
    const paintBlockOverlap = () => {
      if (settle) return;
      const overlap = String(canvasBlockOverlap(camera.scale, ownerWindow.devicePixelRatio));
      for (const element of [viewport, ...mirrors.current])
        if (element.dataset.canvasBlockOverlap !== overlap)
          element.dataset.canvasBlockOverlap = overlap;
    };
    const setMoving = (moving: boolean) => {
      paintPromotion();
      paintBlockOverlap();
      canvasStore.send({ type: "setCameraMoving", workspaceKey, moving });
    };
    const markMoving = () => {
      const wasMoving = !!settle;
      ownerWindow.clearTimeout(settle);
      settle = ownerWindow.setTimeout(() => {
        settle = 0;
        setMoving(false);
      }, CAMERA_SETTLE_MS);
      if (!wasMoving) setMoving(true);
    };
    const paintElement = (element: HTMLElement) => {
      element.style.setProperty("--canvas-x", `${camera.x}px`);
      element.style.setProperty("--canvas-y", `${camera.y}px`);
      element.style.setProperty("--canvas-zoom", String(camera.scale));
      // With the zoom, sizes a screen's device pixel in the Canvas world.
      element.style.setProperty("--canvas-pixel-ratio", String(ownerWindow.devicePixelRatio));
    };
    paintMirror.current = (element) => {
      paintElement(element);
      paintPanState();
      paintPromotion();
      paintBlockOverlap();
    };
    const paint = () => {
      paintElement(viewport);
      for (const element of mirrors.current) paintElement(element);
      paintPromotion();
      paintBlockOverlap();
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
      camera = constrain(camera, true);
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
      target = constrain(next);
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
      const destination = targetOf(key);
      if (!destination) return;
      flyToCamera(() => fitCanvasPage(viewportSize, destination), destination);
    };
    const startOverviewFlight = () => {
      cancelCameraFlight();
      flyToCamera(() => canvasOverview(viewportSize, contentSize));
    };
    const startPan = (destination: CanvasCamera) => {
      cancelCameraFlight();
      flyToCamera(() => destination, undefined, true);
    };
    const flyToCamera = (
      destinationCamera: () => CanvasCamera,
      page?: CanvasSnapTarget,
      pan = false,
    ) => {
      cancelAnimationFrame(animation);
      animation = 0;
      previousTime = 0;
      restoredCamera = undefined;
      fittingInitialPage = false;
      gesture = undefined;
      ownerWindow.clearTimeout(zoomEnd);
      stretch = undefined;
      landing = undefined;
      // Navigation can commit new slots before ResizeObserver runs. Measure the
      // committed DOM now so even reduced-motion arrivals use the new bounds.
      updateGeometry();
      camera = constrain(camera, true);
      target = constrain(destinationCamera());
      const path = pan
        ? createCanvasPan(camera, target, viewportSize)
        : createCanvasFlight(camera, target, viewportSize, contentSize);
      if (reducedMotion.matches || path.duration === 0) {
        applyCamera(target, true);
        return;
      }
      flight = { page: page && { ...page }, pan, path };
      animation = requestAnimationFrame(animate);
    };
    flightControls.current = {
      flyTo: startFlight,
      keepInView: (worldX, screenX) => {
        const x = screenX - worldX * camera.scale;
        if (selection || camera.x >= x) return;
        cancelCameraFlight();
        restoredCamera = undefined;
        fittingInitialPage = false;
        gesture = undefined;
        applyCamera({ ...camera, x }, true);
      },
      reveal: (element, immediate) => {
        const frame = element.ownerDocument.defaultView?.frameElement;
        if (!frame || (flight && !flight.pan) || pointers.size) return;
        // Where the painted camera shows the element, in world space. Frames are
        // scaled by the camera, while the element's rect is in its frame's pixels.
        const rect = element.getBoundingClientRect();
        const frameTop = frame.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
        const worldTop = (frameTop + rect.top * camera.scale - camera.y) / camera.scale;
        // Measure against the camera's destination, so input in progress isn't undone.
        const delta = revealScrollDelta(
          {
            top: target.y + worldTop * target.scale,
            bottom: target.y + (worldTop + rect.height) * target.scale,
          },
          { top: 0, bottom: viewportSize.height },
        );
        if (!delta) return;
        const next = { ...target, y: target.y - delta };
        if (immediate) move(next, true);
        else startPan(next);
      },
      syncRow: () => {
        const key = rowRef.current?.selected ?? null;
        const destination = targetOf(key);
        if (key !== requested) {
          // Selected from anywhere but the camera, such as a header or the
          // Canvas sidebar: fly there to snap to it.
          requested = key;
          selection = key;
          if (destination && !isCanvasCameraSnapped(rest(target), viewportSize, destination))
            startFlight(destination.key);
          return;
        }
        if (flight?.page) {
          const page = targetOf(flight.page.key);
          if (!page) cancelCameraFlight();
          // Device presets and page reordering can change geometry without a new URL.
          else if (page.left !== flight.page.left || page.width !== flight.page.width)
            startFlight(page.key);
          return;
        }
        // Collapsing a shelf or reordering pages can move the selection away from the camera.
        if (
          destination &&
          selection === key &&
          !flight &&
          !fittingInitialPage &&
          !isCanvasCameraSnapped(rest(target), viewportSize, destination)
        )
          startFlight(destination.key);
      },
      fitAll: startOverviewFlight,
    };
    const move = (next: CanvasCamera, immediate = false) => {
      markMoving();
      cancelCameraFlight();
      // Any new camera interaction takes precedence over the remembered view.
      restoredCamera = undefined;
      fittingInitialPage = false;
      applyCamera(next, immediate);
      releaseSelection();
    };
    const continuityBinding = {
      capture: () => {
        const held = flight ? undefined : targetOf(selection);
        const element =
          held &&
          Array.from(content.querySelectorAll<HTMLElement>("[data-canvas-page]")).find(
            (element) => element.dataset.canvasPage === held.key,
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
          pathname: element ? element.dataset.canvasPathname : undefined,
          anchor,
        };
      },
      /** Snap to the selected page, at the anchor's reading point or the previous camera's. */
      restore: (anchor: ViewportAnchor | undefined, previous: CanvasCamera | undefined) => {
        // The Canvas stays mounted while hidden, so its selection may have
        // changed since it mounted. Land on it directly, without the flight
        // that the change started while hidden.
        const destination = targetOf(selection);
        if (!destination) return;
        cancelCameraFlight();
        const page = Array.from(content.querySelectorAll<HTMLElement>("[data-canvas-page]")).find(
          (element) => element.dataset.canvasPage === destination.key,
        );
        const doc = page ? canvasPageIframe(page)?.contentDocument : undefined;
        updateGeometry();
        const fit = fitCanvasPage(viewportSize, destination);
        let next = previous ? { ...fit, y: rescaleY(previous, fit.scale) } : fit;
        if (anchor && doc) {
          const y = resolveViewportAnchor(doc, anchor);
          const frameOffsetY = page
            ? (page.getBoundingClientRect().top - viewport.getBoundingClientRect().top - camera.y) /
              camera.scale
            : 0;
          next = placeCanvasPageAnchor(viewportSize, destination, y, fit.scale, frameOffsetY);
        }
        fittingInitialPage = false;
        restoredCamera = next;
        applyCamera(next, true);
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
      // The selection stays snapped as the window resizes.
      const held =
        nextViewport.width !== viewportSize.width && !flight && !fittingInitialPage
          ? targetOf(selection)
          : undefined;
      updateGeometry(nextViewport, nextContent);
      if (held) {
        const fit = fitCanvasPage(viewportSize, held);
        const next = { ...fit, y: rescaleY(restoredCamera ?? target, fit.scale) };
        if (restoredCamera) restoredCamera = next;
        camera = constrain(camera, true);
        applyCamera(next, true);
        return;
      }
      if (flight) {
        // Iframe sizing and window resizes must not jump to the old destination.
        camera = constrain(camera, true);
        if (flight.page) startFlight(flight.page.key);
        else if (flight.pan) startPan(target);
        else startOverviewFlight();
        return;
      }
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
      camera = constrain(camera, true);
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
      rowRef.current?.onEditorMove?.();
      // Interrupt before computing intent so input starts at the painted view,
      // not the offscreen destination of an unfinished navigation.
      cancelCameraFlight();
      if (event.ctrlKey || event.metaKey) {
        const point = localPoint(event.clientX, event.clientY);
        move(zoom(target, point, Math.exp(-dy * CANVAS_WHEEL_ZOOM_RATE), event.timeStamp));
        return;
      }
      endZoom();
      const previous =
        gesture?.kind === "pan" &&
        gesture.source === "wheel" &&
        event.timeStamp - gesture.time < GESTURE_IDLE_MS
          ? gesture.rail
          : undefined;
      const rail: CanvasVerticalRail =
        !event.shiftKey &&
        !pointers.size &&
        targets().length > 0 &&
        isCanvasPageScale(target.scale, canvasMaximumScale(viewportSize, targets(), minimumScale))
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
      rowRef.current?.onEditorMove?.();
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
      // A pinch ends as soon as it has fewer than two pointers.
      if (pointers.size < 2) endZoom();
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
      // Keyboard zoom snaps like any other zoom.
      const factor =
        event.key === "+" || event.key === "="
          ? 1.25
          : event.key === "-"
            ? 0.8
            : event.key === "0"
              ? 1 / target.scale
              : undefined;
      if (factor) {
        gesture = undefined;
        event.preventDefault();
        rowRef.current?.onEditorMove?.();
        move(zoom(target, center, factor, event.timeStamp));
        return;
      }
      if (event.key === "Home" || (event.shiftKey && event.code === "Digit1")) {
        endZoom();
        gesture = undefined;
        event.preventDefault();
        rowRef.current?.onEditorMove?.();
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
      rowRef.current?.onEditorMove?.();
      endZoom();
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
      settle = 0;
      ownerWindow.clearTimeout(zoomEnd);
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
      delete viewport.dataset.canvasPromoted;
      delete viewport.dataset.canvasBlockOverlap;
      paintMirror.current = null;
    };
  }, [workspaceKey, continuity]);

  return {
    viewportRef,
    contentRef,
    flyTo,
    mirrorCamera,
    keepInView,
    reveal,
    fitAll,
  };
}
