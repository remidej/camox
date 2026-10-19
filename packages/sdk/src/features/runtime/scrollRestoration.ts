/**
 * Scroll positions of the website's history entries. Each entry the runtime creates carries a
 * key in `history.state`, so two entries with the same URL keep their own positions. Positions
 * are kept in sessionStorage, so they survive reloads and documents the browser had to load again.
 *
 * The page scrolls in its viewport: the visitor's window, or the Studio frame showing the page.
 * The history belongs to the top window either way.
 */

const STORAGE_KEY = "camox:scroll-positions";
const STATE_KEY = "camoxScrollKey";
/** Keeps sessionStorage small for long sessions. Older entries scroll to the top instead. */
const MAX_ENTRIES = 100;

type Position = [x: number, y: number];

export type ScrollIntent =
  /** The document just opened, as on reload: back to where the entry was left, if known. */
  | "resume"
  /** History traversal: back to where the entry was left, else its fragment, else the top. */
  | "restore"
  /** A new entry: its fragment, else the top. */
  | "enter"
  /** The same page: its fragment, if the page has it. */
  | "fragment";

function keyOf(state: unknown): string | undefined {
  if (!state || typeof state !== "object" || !(STATE_KEY in state)) return undefined;
  const key = (state as Record<string, unknown>)[STATE_KEY];
  return typeof key === "string" ? key : undefined;
}

function createKey() {
  return Math.random().toString(36).slice(2, 10);
}

function readPositions(storage: Storage | undefined): Map<string, Position> {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (stored) return new Map(JSON.parse(stored) as [string, Position][]);
  } catch {
    // Storage can be disabled or full; positions then last as long as the document.
  }
  return new Map();
}

/** The element a fragment names, or `"top"` for the fragments that name the top of the page. */
function fragmentTarget(doc: Document, hash: string): Element | "top" | null {
  const fragment = hash.replace(/^#/, "");
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // A malformed escape names only what it spells.
  }
  // As browsers do: the fragment as written, then decoded, names an element by ID or anchor name.
  // Without such an element, an empty fragment or `#top` names the top.
  const find = (id: string) =>
    (id && (doc.getElementById(id) ?? doc.getElementsByName(id)[0])) || null;
  const element = find(fragment) ?? find(decoded);
  if (!element && (!decoded || decoded.toLowerCase() === "top")) return "top";
  return element;
}

export function createScrollRestoration(win: Window) {
  const storage = (() => {
    try {
      return win.sessionStorage;
    } catch {
      return undefined;
    }
  })();
  const positions = readPositions(storage);
  let viewport: Window | null = null;

  // The runtime restores positions itself, once the next page has rendered.
  win.history.scrollRestoration = "manual";
  let currentKey = keyOf(win.history.state);
  const keyEntry = () => {
    currentKey = createKey();
    win.history.replaceState({ ...(win.history.state as object), [STATE_KEY]: currentKey }, "");
  };
  if (!currentKey) keyEntry();

  const persist = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify([...positions]));
    } catch {
      // See readPositions.
    }
  };

  /** Records where the shown entry's page is scrolled to. */
  const save = () => {
    if (!currentKey || !viewport) return;
    positions.delete(currentKey);
    positions.set(currentKey, [viewport.scrollX, viewport.scrollY]);
    while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value!);
    persist();
  };

  // Leaving the document, the browser restores this entry best: from the back/forward cache, or
  // on reload. Positions of the document's other entries stay in sessionStorage.
  const onPageHide = () => {
    save();
    win.history.scrollRestoration = "auto";
  };
  // Back from the back/forward cache, the runtime restores positions again. The mode belongs to
  // each entry, and new entries copy it.
  const onPageShow = () => {
    win.history.scrollRestoration = "manual";
  };
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);

  return {
    save,
    /** Where the page scrolls from now on, or null while nothing shows it. */
    setViewport(next: Window | null) {
      viewport = next;
    },
    /** Where the page scrolls, if anything shows it. */
    viewport: () => viewport,
    /** State for a new history entry, which gets a key of its own. */
    stateForNewEntry: () => ({ [STATE_KEY]: createKey() }),
    /** Follows the history entry the browser now shows, and gives it a key if it has none. */
    entered() {
      currentKey = keyOf(win.history.state);
      if (!currentKey) keyEntry();
    },
    /**
     * Scrolls `page`, which just rendered the shown entry at `hash`, as `intent` says. Returns the
     * fragment's element it scrolled to, if any.
     */
    apply(page: Window, intent: ScrollIntent, hash: string): Element | null {
      const scrollTo = (top: number, left = 0) => page.scrollTo({ top, left, behavior: "instant" });
      if (intent === "resume" || intent === "restore") {
        const saved = currentKey && positions.get(currentKey);
        if (saved) {
          scrollTo(saved[1], saved[0]);
          return null;
        }
        // On reload without a saved position, the browser has already placed the page.
        if (intent === "resume") return null;
      }
      const target = hash ? fragmentTarget(page.document, hash) : null;
      if (target === "top") scrollTo(0);
      else if (target) {
        // scrollIntoView honors the target's scroll-margin, as fragment navigations do. Within
        // the page, the site's scroll-behavior applies; a page just shown appears in place.
        target.scrollIntoView({ behavior: intent === "fragment" ? "auto" : "instant" });
        return target;
      } else if (intent !== "fragment") scrollTo(0);
      return null;
    },
    dispose() {
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("pageshow", onPageShow);
      win.history.scrollRestoration = "auto";
    },
  };
}

export type ScrollRestoration = ReturnType<typeof createScrollRestoration>;
