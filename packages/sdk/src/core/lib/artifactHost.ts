import type { ArtifactData } from "./artifactData";

/** The studio context an artifact sees as `camox.studio`; `null` on the website. */
export type ArtifactStudio = { editMode: boolean; canvas: boolean };

/** What the page shares with an artifact through its runtime. */
export type ArtifactHostState = {
  studio: ArtifactStudio | null;
  /** The artifact's Artifact Data; the frame's `srcDoc` holds its initial value. */
  data?: ArtifactData;
};

export type ArtifactHost = {
  /** Shares new state with the artifact; unchanged state sends nothing. */
  update(state: ArtifactHostState): void;
  disconnect(): void;
};

type RuntimeMessage = { camox: string; channel?: unknown };

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
  const sendData = () => post("data", { data: state.data ?? {} });

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
      sendStudio();
      // The data may have changed since the `srcDoc` was rendered; the runtime skips equal data.
      sendData();
    }
  };

  page.addEventListener("message", onMessage);
  // The runtime may already be running, if the frame loaded before the host connected.
  post("connect");

  return {
    update(next) {
      const previous = state;
      state = next;
      if (!ready) return;
      if (!sameStudio(previous.studio, next.studio)) sendStudio();
      if (JSON.stringify(previous.data) !== JSON.stringify(next.data)) sendData();
    },
    disconnect() {
      page.removeEventListener("message", onMessage);
    },
  };
}
