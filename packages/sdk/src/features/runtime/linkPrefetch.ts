/**
 * Loads a page before its link is followed: when the pointer rests on the link, when the link is
 * focused, or when a finger touches it. The next navigation to that page uses what was loaded.
 */

/** How long the pointer rests on a link before its page loads, so sweeping across links doesn't. */
export const HOVER_INTENT_DELAY = 50;
/** How long a loaded page may serve a navigation. Later, the navigation reads it afresh. */
export const PREFETCH_STALE_TIME = 30_000;

export function createPrefetchCache<T>({
  staleTime = PREFETCH_STALE_TIME,
  now = Date.now,
}: { staleTime?: number; now?: () => number } = {}) {
  const entries = new Map<string, { promise: Promise<T>; loadedAt: number }>();
  const fresh = (key: string) => {
    const entry = entries.get(key);
    if (entry && now() - entry.loadedAt < staleTime) return entry;
    entries.delete(key);
    return undefined;
  };
  return {
    /** Starts `load`ing `key`, unless a fresh load of it is already there or under way. */
    prefetch(key: string, load: () => Promise<T>) {
      if (fresh(key)) return;
      const entry = { promise: load(), loadedAt: now() };
      entries.set(key, entry);
      // A failed load is forgotten: the navigation loads the page itself.
      entry.promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
    },
    /** The fresh load of `key`, which then no longer serves later navigations. */
    take(key: string): Promise<T> | undefined {
      const entry = fresh(key);
      entries.delete(key);
      return entry?.promise;
    },
    clear() {
      entries.clear();
    },
  };
}

/** Whether the visitor asked to save data, or is on a connection too slow to spend on guesses. */
function savesData(win: Window) {
  const connection = (
    win.navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return !!connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "");
}

/**
 * Calls `onIntent` with each link the visitor is about to follow. `doc` delegates for every link,
 * including ones rendered later.
 */
export function listenForLinkIntent(
  doc: Document,
  onIntent: (anchor: HTMLAnchorElement) => void,
  { hoverDelay = HOVER_INTENT_DELAY }: { hoverDelay?: number } = {},
) {
  const win = doc.defaultView!;
  let hovered: { anchor: HTMLAnchorElement; timer: ReturnType<typeof setTimeout> } | null = null;
  const anchorOf = (target: EventTarget | null) =>
    target instanceof win.Element ? target.closest("a") : null;
  const intent = (anchor: HTMLAnchorElement) => {
    if (!anchor.href || savesData(win)) return;
    onIntent(anchor);
  };
  const cancelHover = () => {
    if (hovered) clearTimeout(hovered.timer);
    hovered = null;
  };

  const onMouseOver = (event: MouseEvent) => {
    const anchor = anchorOf(event.target);
    if (!anchor || hovered?.anchor === anchor) return;
    cancelHover();
    hovered = { anchor, timer: setTimeout(() => intent(anchor), hoverDelay) };
  };
  const onMouseOut = (event: MouseEvent) => {
    if (!hovered || hovered.anchor.contains(event.relatedTarget as Node | null)) return;
    if (anchorOf(event.target) === hovered.anchor) cancelHover();
  };
  // Keyboard focus and touch come right before following the link: no delay.
  const onFocusIn = (event: FocusEvent) => {
    const anchor = anchorOf(event.target);
    if (anchor) intent(anchor);
  };
  const onTouchStart = (event: TouchEvent) => {
    const anchor = anchorOf(event.target);
    if (anchor) intent(anchor);
  };

  doc.addEventListener("mouseover", onMouseOver);
  doc.addEventListener("mouseout", onMouseOut);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("touchstart", onTouchStart, { passive: true });
  return () => {
    cancelHover();
    doc.removeEventListener("mouseover", onMouseOver);
    doc.removeEventListener("mouseout", onMouseOut);
    doc.removeEventListener("focusin", onFocusIn);
    doc.removeEventListener("touchstart", onTouchStart);
  };
}
