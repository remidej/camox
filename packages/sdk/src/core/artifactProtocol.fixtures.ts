import { Window } from "happy-dom";

type Viewport = { progress: number; visibleRatio: number };

/** What an artifact sees of its `camox` runtime. */
export type ArtifactWindow = Window & {
  camox: {
    readonly studio: { editMode: boolean; canvas: boolean } | null;
    readonly theme: ArtifactTheme;
    onTheme(callback: (theme: ArtifactTheme) => void): () => void;
    onViewport(callback: (viewport: Viewport) => void): () => void;
    navigate(href: string): void;
  };
};

type ArtifactTheme = {
  tokens: Record<string, string>;
  colors: Record<string, { r: number; g: number; b: number }>;
};

/** The page's viewport height, so tests can place frames relative to it. */
export const VIEWPORT_HEIGHT = 800;

/** Resize observers created inside each artifact, which happy-dom never fires on its own. */
const resizeObservers = new WeakMap<object, Set<() => void>>();

type Placement = { top: number; height: number };
type IntersectionEntry = { target: object; isIntersecting: boolean };

/**
 * Two-realm harness for the host-runtime protocol. The page window holds the artifact frame
 * elements, and each artifact loads its `srcDoc` in its own window. The global `window` is a
 * third window, standing in for the studio, which renders the preview from another realm: host
 * code that reaches for the global `window`, or that compares `event.source` with the frame's
 * `contentWindow`, never connects (happy-dom reports the receiving window as the source).
 *
 * happy-dom has no layout, so the harness stands in for it: `place` and `scroll` move a frame
 * within the page's viewport (and notify the page's intersection observers, which happy-dom
 * lacks), `measurements` counts how often the page read a frame's layout, and `resize` changes
 * the height of an artifact's content.
 */
export function createArtifactPage() {
  const studio = new Window();
  Object.assign(globalThis, { window: studio, document: studio.document });
  const page = new Window({ width: 1024, height: VIEWPORT_HEIGHT });
  setUserActivation(page, false);
  inheritCustomProperties(page);
  const placements = new WeakMap<object, Placement>();
  const layoutReads = new WeakMap<object, number>();
  const intersections = installIntersectionObserver(page, (target) => placements.get(target));

  return {
    page,
    /** Adds an empty artifact frame element to the page. */
    addFrame() {
      const frame = page.document.createElement("iframe");
      page.document.body.append(frame);
      return frame as unknown as HTMLIFrameElement;
    },
    /** Loads `srcDoc` into the frame as a new artifact document, running its scripts. */
    load(frame: HTMLIFrameElement, srcDoc: string) {
      const artifact = new Window({
        settings: {
          enableJavaScriptEvaluation: true,
          suppressInsecureJavaScriptEnvironmentWarning: true,
        },
      });
      Object.defineProperty(artifact, "parent", { value: page, configurable: true });
      Object.defineProperty(frame, "contentWindow", { value: artifact, configurable: true });
      installResizeObserver(artifact);
      artifact.document.write(srcDoc);
      return artifact as ArtifactWindow;
    },
    /** Lays the frame out `top` pixels below the top of the page's viewport, `height` tall. */
    place(frame: HTMLIFrameElement, top: number, height: number) {
      placements.set(frame, { top, height });
      Object.defineProperty(frame, "getBoundingClientRect", {
        configurable: true,
        value: () => {
          layoutReads.set(frame, (layoutReads.get(frame) ?? 0) + 1);
          return { top, bottom: top + height, height, left: 0, right: 0, width: 0 };
        },
      });
      intersections.update();
    },
    /** Scrolls the page so the frame's top lands `top` pixels below the viewport's top. */
    scroll(frame: HTMLIFrameElement, top: number) {
      this.place(frame, top, placements.get(frame)?.height ?? 0);
      page.dispatchEvent(new page.Event("scroll"));
    },
    /** How many times the page has read the frame's layout so far. */
    measurements(frame: HTMLIFrameElement) {
      return layoutReads.get(frame) ?? 0;
    },
    /** Makes the artifact's content `height` pixels tall, as its layout would. */
    resize(artifact: ArtifactWindow, height: number) {
      Object.defineProperty(artifact.document.documentElement, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ top: 0, bottom: height, height, left: 0, right: 0, width: 0 }),
      });
      for (const notify of resizeObservers.get(artifact) ?? []) notify();
    },
    /** Gives the page transient user activation, as right after a real click, or takes it away. */
    activate(active = true) {
      setUserActivation(page, active);
    },
    /** Waits until every message in flight between the windows has been delivered. */
    async settle() {
      for (let round = 0; round < 4; round++) {
        await new Promise((resolve) => setTimeout(resolve));
      }
    },
  };
}

function setUserActivation(page: Window, isActive: boolean) {
  Object.defineProperty(page.navigator, "userActivation", {
    configurable: true,
    value: { isActive },
  });
}

/** The top and bottom of an `IntersectionObserver` root margin, in pixels. */
function rootMarginOf(rootMargin: string, viewportHeight: number) {
  const [top = "0px", , bottom = top] = rootMargin.trim().split(/\s+/);
  const pixels = (length: string) =>
    length.endsWith("%") ? (parseFloat(length) / 100) * viewportHeight : parseFloat(length) || 0;
  return { top: pixels(top), bottom: pixels(bottom) };
}

/**
 * An `IntersectionObserver` for the page's realm, against its viewport and the harness's layout.
 * Like a browser's, it reports each target once observed, then whenever it starts or stops
 * intersecting the (margin-extended) viewport, asynchronously.
 */
function installIntersectionObserver(
  page: Window,
  placementOf: (target: object) => Placement | undefined,
) {
  const observers = new Set<HarnessIntersectionObserver>();
  class HarnessIntersectionObserver {
    #callback: (entries: IntersectionEntry[], observer: unknown) => void;
    #rootMargin: string;
    #targets = new Map<object, boolean | null>();
    constructor(
      callback: (entries: IntersectionEntry[], observer: unknown) => void,
      options: { rootMargin?: string } = {},
    ) {
      this.#callback = callback;
      this.#rootMargin = options.rootMargin ?? "0px";
      observers.add(this);
    }
    observe(target: object) {
      this.#targets.set(target, null);
      this.check();
    }
    unobserve(target: object) {
      this.#targets.delete(target);
    }
    disconnect() {
      this.#targets.clear();
      observers.delete(this);
    }
    takeRecords() {
      return [];
    }
    check() {
      const margin = rootMarginOf(this.#rootMargin, page.innerHeight);
      const entries: IntersectionEntry[] = [];
      for (const [target, previous] of this.#targets) {
        const placement = placementOf(target);
        const next =
          !!placement &&
          placement.top + placement.height >= -margin.top &&
          placement.top <= page.innerHeight + margin.bottom;
        if (next === previous) continue;
        this.#targets.set(target, next);
        entries.push({ target, isIntersecting: next });
      }
      if (entries.length === 0) return;
      setTimeout(() => {
        if (observers.has(this)) this.#callback(entries, this);
      });
    }
  }
  Object.defineProperty(page, "IntersectionObserver", {
    configurable: true,
    value: HarnessIntersectionObserver,
  });
  return {
    /** Reports targets whose intersection changed with the harness's layout. */
    update() {
      for (const observer of observers) observer.check();
    },
  };
}

/** A `ResizeObserver` for the artifact's realm that fires when the harness resizes content. */
function installResizeObserver(artifact: Window) {
  const observers = new Set<() => void>();
  resizeObservers.set(artifact, observers);
  class HarnessResizeObserver {
    #callback: (entries: unknown[], observer: unknown) => void;
    #notify = () => this.#callback([], this);
    constructor(callback: (entries: unknown[], observer: unknown) => void) {
      this.#callback = callback;
    }
    observe() {
      observers.add(this.#notify);
    }
    unobserve() {
      observers.delete(this.#notify);
    }
    disconnect() {
      observers.delete(this.#notify);
    }
  }
  Object.defineProperty(artifact, "ResizeObserver", {
    configurable: true,
    value: HarnessResizeObserver,
  });
}

/**
 * happy-dom computes custom properties only on the elements that declare them, while browsers
 * inherit them. Emulate inheritance in `getComputedStyle`, so a `.dark` section's tokens reach
 * the frames inside it as they do in a browser.
 */
function inheritCustomProperties(window: Window) {
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element) => {
    const style = getComputedStyle(element);
    const getPropertyValue = style.getPropertyValue.bind(style);
    style.getPropertyValue = (name) => {
      const value = getPropertyValue(name);
      if (value || !name.startsWith("--") || !element.parentElement) return value;
      return window.getComputedStyle(element.parentElement).getPropertyValue(name);
    };
    return style;
  };
}
