import { observeArtifactTheme, readArtifactTheme } from "./artifactTheme";

/** The studio context an artifact sees as `camox.studio`; `null` on the website. */
export type ArtifactStudio = { editMode: boolean; canvas: boolean };

/** What the page shares with an artifact through its runtime. */
export type ArtifactHostState = { studio: ArtifactStudio | null };

/** How a block's artifact field sizes its frame, and what the page does for the artifact. */
export type ArtifactHostOptions = {
  /** With `"content"`, the artifact reports its height through `onHeight`. */
  size?: "fill" | "content";
  /** Applies the height the artifact's content needs, in CSS pixels. */
  onHeight?: (height: number) => void;
  /** Navigates the page's client router to an internal path (with its query and hash). */
  navigate?: (path: string) => void;
};

export type ArtifactHost = {
  /** Shares new state with the artifact; unchanged state sends nothing. */
  update(state: ArtifactHostState): void;
  disconnect(): void;
};

type RuntimeMessage = { camox: string; channel?: unknown; [key: string]: unknown };

function isRuntimeMessage(data: unknown): data is RuntimeMessage {
  return (
    typeof data === "object" && data !== null && typeof (data as RuntimeMessage).camox === "string"
  );
}

function sameStudio(a: ArtifactStudio | null, b: ArtifactStudio | null) {
  if (!a || !b) return a === b;
  return a.editMode === b.editMode && a.canvas === b.canvas;
}

/**
 * Where an artifact's `camox.navigate(href)` leads: an internal path for the client router, an
 * external URL for a new tab, or nowhere for anything but web URLs (such as `javascript:`).
 */
function navigationTarget(
  href: string,
  page: Window,
): { internal: string } | { external: string } | null {
  if (href.startsWith("/") && !href.startsWith("//")) return { internal: href };
  let url: URL;
  try {
    url = new URL(href, page.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === page.location.origin) {
    return { internal: `${url.pathname}${url.search}${url.hash}` };
  }
  return { external: url.href };
}

/**
 * Follows an artifact's navigation, only right after a real click: a click inside the frame
 * gives the page transient user activation too, so an artifact can't redirect visitors itself.
 */
function navigateFromArtifact(href: string, page: Window, options: ArtifactHostOptions) {
  if (page.navigator.userActivation?.isActive !== true) return;
  const target = navigationTarget(href, page);
  if (!target) return;
  if ("internal" in target) {
    options.navigate?.(target.internal);
    return;
  }
  page.open(target.external, "_blank", "noopener,noreferrer");
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Where a frame sits in its page's viewport: `progress` goes from 0 when its top enters at the
 * bottom of the viewport to 1 when its bottom leaves at the top; `visibleRatio` is the share of
 * the frame inside the viewport.
 */
function viewportOf(frame: HTMLIFrameElement, viewportHeight: number) {
  const { top, bottom, height } = frame.getBoundingClientRect();
  const travel = viewportHeight + height;
  const visible = Math.max(0, Math.min(bottom, viewportHeight) - Math.max(top, 0));
  return {
    progress: travel > 0 ? clamp((viewportHeight - top) / travel) : 0,
    visibleRatio: height > 0 ? clamp(visible / height) : 0,
  };
}

/** How far beyond the viewport a frame counts as near it, so it starts measuring ahead of time. */
const NEAR_VIEWPORT = "25% 0px";

/**
 * Follows the frame's place in the page's viewport, measuring at most once per animation frame
 * after a scroll or resize anywhere on the page, and reporting only changes. An
 * IntersectionObserver limits this to while the frame is near the viewport: far frames aren't
 * measured on scroll, and are measured once more as they leave, so they report where they went.
 */
function trackViewport(
  frame: HTMLIFrameElement,
  page: Window & typeof globalThis,
  report: (viewport: { progress: number; visibleRatio: number }) => void,
) {
  let pending = 0;
  let last: { progress: number; visibleRatio: number } | null = null;
  const measure = () => {
    pending = 0;
    const next = viewportOf(frame, page.innerHeight);
    if (last && last.progress === next.progress && last.visibleRatio === next.visibleRatio) return;
    last = next;
    report(next);
  };
  const schedule = () => {
    if (pending) return;
    pending = page.requestAnimationFrame(measure);
  };

  // Capturing catches scrolls of any scroll container, not only the page's.
  const listener = { capture: true, passive: true } as const;
  let following = false;
  const follow = (near: boolean) => {
    if (near === following) return;
    following = near;
    if (near) {
      page.addEventListener("scroll", schedule, listener);
      page.addEventListener("resize", schedule, listener);
      return;
    }
    page.removeEventListener("scroll", schedule, listener);
    page.removeEventListener("resize", schedule, listener);
  };

  const intersection =
    "IntersectionObserver" in page
      ? new page.IntersectionObserver(
          (entries) => {
            const entry = entries.at(-1);
            if (!entry) return;
            follow(entry.isIntersecting);
            schedule();
          },
          { rootMargin: NEAR_VIEWPORT },
        )
      : null;
  if (intersection) intersection.observe(frame);
  else follow(true);
  schedule();

  return {
    schedule,
    stop() {
      intersection?.disconnect();
      follow(false);
      if (pending) page.cancelAnimationFrame(pending);
    },
  };
}

/**
 * Connects an artifact frame to the `camox` runtime inside it, and owns the frame's message
 * channel (see `artifactRuntime.ts` for the protocol).
 *
 * The block's code may run in another realm than the frame's parent (the studio renders its
 * preview that way), so this only goes through the frame element's own document: never the
 * global `window`, and never `event.source`, whose identity differs across realms.
 */
export function connectArtifactHost(
  frame: HTMLIFrameElement,
  initialState: ArtifactHostState,
  options: ArtifactHostOptions = {},
): ArtifactHost {
  const page = frame.ownerDocument.defaultView;
  if (!page) return { update() {}, disconnect() {} };

  const channel = crypto.randomUUID();
  let state = initialState;
  let ready = false;

  const post = (type: string, payload: object = {}) => {
    frame.contentWindow?.postMessage({ ...payload, camox: type, channel }, "*");
  };
  const sendStudio = () => post("studio", { studio: state.studio });
  let sentTheme: string | null = null;
  const sendTheme = (force: boolean) => {
    const tokens = readArtifactTheme(frame);
    const serialized = JSON.stringify(tokens);
    if (!force && serialized === sentTheme) return;
    sentTheme = serialized;
    post("theme", { tokens });
  };

  let viewport: ReturnType<typeof trackViewport> | null = null;
  const observeViewport = (observe: boolean) => {
    viewport?.stop();
    viewport = observe ? trackViewport(frame, page, (next) => post("viewport", next)) : null;
  };

  const onMessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (!isRuntimeMessage(message)) return;
    // Any runtime starting on the page may be this frame's, after a load or a reload.
    if (message.camox === "hello") {
      post("connect");
      return;
    }
    if (message.channel !== channel) return;
    if (message.camox === "ready") {
      ready = true;
      // A new runtime starts unsubscribed, whatever the previous one observed.
      observeViewport(false);
      sendStudio();
      sendTheme(true);
      if (options.size === "content") post("measure");
      return;
    }
    if (message.camox === "height") {
      const { height } = message;
      if (options.size !== "content" || typeof height !== "number") return;
      if (!Number.isFinite(height) || height < 0) return;
      options.onHeight?.(height);
      viewport?.schedule();
      return;
    }
    if (message.camox === "observe-viewport") observeViewport(message.observe === true);
    if (message.camox === "navigate" && typeof message.href === "string") {
      navigateFromArtifact(message.href, page, options);
    }
  };

  page.addEventListener("message", onMessage);
  const stopObservingTheme = observeArtifactTheme(frame, () => {
    if (ready) sendTheme(false);
  });
  // The runtime may already be running, if the frame loaded before the host connected.
  post("connect");

  return {
    update(next) {
      const previous = state;
      state = next;
      if (ready && !sameStudio(previous.studio, next.studio)) sendStudio();
    },
    disconnect() {
      page.removeEventListener("message", onMessage);
      observeViewport(false);
      stopObservingTheme();
    },
  };
}
