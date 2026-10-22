import {
  QueryObserver,
  type Query,
  type QueryClient,
  type QueryObserverOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import * as React from "react";

import { createFrameCapturer, type CaptureOptions, type FrameCapturer } from "./canvasFrameCapture";

/**
 * Below this zoom, Canvas Pages show a still image of themselves rather than their live frame,
 * except the selected one. Many live frames in view are what slows the camera down, while from
 * this far, an image looks the same.
 */
export const CANVAS_THUMBNAIL_MAX_ZOOM = 0.25;

/** A Page's still image: an object URL, and the size it covers in CSS pixels. */
export type CanvasThumbnail = {
  url: string;
  width: number;
  height: number;
  /** Whether what the Page shows may have changed since. It still shows until it's replaced. */
  stale: boolean;
};

type Entry = CanvasThumbnail & {
  /** Every value a read the Page used is named by: its path, its blocks and layout ids. */
  tokens: Set<string>;
  /** The reads the Page used, and their data when captured. */
  reads: Map<Query, unknown>;
  /** Keeps those reads cached while the Page shows its image, so their changes still reach it. */
  release: () => void;
};

/**
 * Whether this browser draws captures faithfully. WebKit draws an SVG image before the images
 * embedded in it have decoded, so its captures miss their images.
 */
export function canvasThumbnailsSupported() {
  if (typeof navigator === "undefined" || typeof OffscreenCanvas === "undefined") return false;
  const agent = navigator.userAgent;
  return !(/AppleWebKit/.test(agent) && !/Chrome|Chromium|CriOS|Edg\//.test(agent));
}

/**
 * Whether a read's data changed. Loading a page seeds the reads of its layout's blocks again,
 * with equal data but new objects, which mustn't make every Page sharing them stale.
 */
function changed(before: unknown, after: unknown) {
  return before !== after && replaceEqualDeep(before, after) !== before;
}

/** The longest a capture waits for fetches to finish. */
const FETCH_WAIT_MS = 5000;

/**
 * Resolves once nothing is fetching, or after `FETCH_WAIT_MS`. Blocks load their own data through
 * the same cache, and a refreshing Page refetches what changed: until those arrive, the frame
 * shows them loading, or out of date.
 */
function fetchesDone(queryClient: QueryClient) {
  if (!queryClient.isFetching()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, FETCH_WAIT_MS);
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (!queryClient.isFetching()) done();
    });
  });
}

/** Resolves after the frame renders twice more, so what arrived last is on screen. */
function framesRendered(frame: HTMLIFrameElement) {
  const view = frame.contentDocument?.defaultView;
  if (!view) return Promise.resolve();
  const next = () => new Promise((resolve) => view.requestAnimationFrame(resolve));
  return next().then(next);
}

/** The values a query key names, at any depth. */
function keyValues(value: unknown, values: string[] = []) {
  if (typeof value === "string" || typeof value === "number") values.push(String(value));
  else if (Array.isArray(value)) for (const item of value) keyValues(item, values);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) keyValues(item, values);
  return values;
}

/**
 * The still images of a Canvas's Pages. A Page's image goes stale once a read it used changes or
 * is invalidated, as realtime does for an agent's edits. Stale images refresh one at a time,
 * while the camera is still, by mounting their Page out of sight.
 */
export function createCanvasThumbnails(
  queryClient: QueryClient,
  capturer: Pick<FrameCapturer, "capture"> = createFrameCapturer(),
) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const waiting = new Set<string>();
  let refreshing: string | null = null;
  let moving = false;
  const generations = new Map<string, number>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const markStale = (key: string) => {
    const entry = entries.get(key);
    if (!entry || entry.stale) return;
    entries.set(key, { ...entry, stale: true });
    notify();
  };

  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entry.release();
    URL.revokeObjectURL(entry.url);
    entries.delete(key);
  };

  /** Holds `query` in the cache, without ever fetching it. */
  const hold = (query: Query) => {
    const observer = new QueryObserver(queryClient, {
      ...(query.options as QueryObserverOptions),
      queryKey: query.queryKey,
      enabled: false,
    });
    return observer.subscribe(() => {});
  };

  const pump = () => {
    if (refreshing !== null || moving) return;
    const next = waiting.values().next();
    if (next.done) return;
    refreshing = next.value;
    notify();
  };

  const finishRefresh = (key: string) => {
    waiting.delete(key);
    if (refreshing !== key) return;
    refreshing = null;
    notify();
    pump();
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get(key: string): CanvasThumbnail | null {
      return entries.get(key) ?? null;
    },
    isRefreshing(key: string) {
      return refreshing === key;
    },

    /** Follows the reads' changes, until the returned cleanup, which also drops every image. */
    connect() {
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" && event.type !== "removed") return;
        const { query } = event;
        const invalidated = event.type === "updated" && event.action.type === "invalidate";
        let values: Set<string> | null = null;
        for (const [key, entry] of entries) {
          if (entry.stale) continue;
          if (entry.reads.has(query)) {
            if (event.type === "removed" || invalidated) markStale(key);
            else if (changed(entry.reads.get(query), query.state.data)) markStale(key);
            continue;
          }
          // A read the Page didn't use yet, like one of a block an edit adds.
          if (!invalidated) continue;
          values ??= new Set(keyValues(query.queryKey));
          for (const value of values) {
            if (!entry.tokens.has(value)) continue;
            markStale(key);
            break;
          }
        }
      });
      return () => {
        unsubscribe();
        for (const key of Array.from(entries.keys())) drop(key);
        waiting.clear();
        refreshing = null;
        notify();
      };
    },

    /** Every image may be out of date, as after the website's code changed. */
    markAllStale() {
      for (const key of entries.keys()) markStale(key);
    },

    setMoving(next: boolean) {
      moving = next;
      if (!moving) pump();
    },

    /** Queues a stale image to refresh, until the returned cleanup. */
    requestRefresh(key: string) {
      waiting.add(key);
      pump();
      return () => finishRefresh(key);
    },

    /**
     * Draws `frame` as `key`'s image. The Page used reads named by `tokens`, and by the ids of
     * the blocks it shows. A newer capture of the same Page wins over an older one.
     */
    async capture(
      key: string,
      frame: HTMLIFrameElement,
      tokens: string[],
      options: CaptureOptions,
    ) {
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      await fetchesDone(queryClient);
      await framesRendered(frame);
      if (generations.get(key) !== generation) return;
      const root = frame.contentDocument?.body;
      const allTokens = new Set(tokens);
      root
        ?.querySelectorAll("[data-camox-viewport-block]")
        .forEach((block) => allTokens.add(block.getAttribute("data-camox-viewport-block") ?? ""));
      allTokens.delete("");
      // The reads as the capture starts, so a change during it still makes the image stale.
      const reads = new Map<Query, unknown>();
      for (const query of queryClient.getQueryCache().getAll()) {
        if (keyValues(query.queryKey).some((value) => allTokens.has(value)))
          reads.set(query, query.state.data);
      }
      const captured = await capturer.capture(frame, options);
      if (generations.get(key) !== generation) return;
      const url = URL.createObjectURL(captured.blob);
      // Decoded ahead, so the image shows the moment it replaces the frame.
      if (typeof Image !== "undefined") {
        const image = new Image();
        image.src = url;
        await image.decode().catch(() => {});
      }
      if (generations.get(key) !== generation) {
        URL.revokeObjectURL(url);
        return;
      }
      drop(key);
      const holds = Array.from(reads.keys(), hold);
      entries.set(key, {
        url,
        width: captured.width,
        height: captured.height,
        stale: false,
        tokens: allTokens,
        reads,
        release: () => holds.forEach((release) => release()),
      });
      finishRefresh(key);
      notify();
    },

    /** The capture of `key` failed: stop refreshing it for now. */
    abandon(key: string) {
      finishRefresh(key);
    },
  };
}

export type CanvasThumbnails = ReturnType<typeof createCanvasThumbnails>;

export const CanvasThumbnailsContext = React.createContext<CanvasThumbnails | null>(null);

const noThumbnails = () => () => {};

/** `key`'s image, and whether it's the one refreshing. */
export function useCanvasThumbnail(key: string) {
  const thumbnails = React.use(CanvasThumbnailsContext);
  const subscribe = thumbnails?.subscribe ?? noThumbnails;
  const thumbnail = React.useSyncExternalStore(subscribe, () => thumbnails?.get(key) ?? null);
  const refreshing = React.useSyncExternalStore(
    subscribe,
    () => thumbnails?.isRefreshing(key) ?? false,
  );
  return { thumbnails, thumbnail, refreshing };
}

/** How long a frame's content must stay unchanged before it counts as settled again. */
const SETTLE_DELAY_MS = 600;
/** The longest a frame waits for its images to load before it counts as settled anyway. */
const IMAGE_WAIT_MS = 3000;

/**
 * Calls `onSettled` once a frame's content has rendered, with its fonts and images loaded, and
 * again each time its content settles after changing.
 */
export function useFrameSettled(
  frame: HTMLIFrameElement | null,
  root: HTMLElement | null,
  onSettled: ((frame: HTMLIFrameElement) => void) | undefined,
) {
  const report = React.useEffectEvent((settled: HTMLIFrameElement) => onSettled?.(settled));
  const enabled = onSettled !== undefined;
  React.useEffect(() => {
    if (!frame || !root || !enabled) return;
    const doc = root.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    let run = 0;
    let timer = 0;
    let disposed = false;
    const nextFrame = () => new Promise((resolve) => view.requestAnimationFrame(resolve));
    const settle = async () => {
      const current = ++run;
      await doc.fonts.ready;
      // Lazy images out of the frame's view never load: the capture fetches those itself.
      const loading = Array.from(root.querySelectorAll("img")).filter(
        (image) => !image.complete && image.loading !== "lazy",
      );
      await Promise.race([
        Promise.all(loading.map((image) => image.decode().catch(() => {}))),
        new Promise((resolve) => view.setTimeout(resolve, IMAGE_WAIT_MS)),
      ]);
      await nextFrame();
      await nextFrame();
      if (!disposed && current === run) report(frame);
    };
    const changed = () => {
      run++;
      view.clearTimeout(timer);
      timer = view.setTimeout(() => void settle(), SETTLE_DELAY_MS);
    };
    const observer = new MutationObserver(changed);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    void settle();
    return () => {
      disposed = true;
      view.clearTimeout(timer);
      observer.disconnect();
    };
  }, [frame, root, enabled]);
}
