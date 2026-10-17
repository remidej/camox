/**
 * The `camox` runtime, injected at the top of every artifact's `srcDoc` so `window.camox` always
 * exists before the artifact source runs.
 *
 * Protocol (every message is `{ camox: <type>, channel?, ...payload }`, posted with `"*"`):
 * - runtime → page: `hello` when the runtime starts, so the page's hosts (re)connect their frames.
 * - host → frame: `connect` with the host's private `channel`. The runtime adopts it and answers.
 * - runtime → page: `ready` on that channel. Only the host that owns the channel listens to it,
 *   so hosts never need `event.source`, which can't be compared across realms.
 * - host → frame: state messages on the channel, such as `studio`, and `theme` with the page's
 *   tokens at the frame's position and their sRGB `colors`, sent once ready and again when they
 *   change. The host converts the colors, so the runtime that every frame inlines stays small.
 * - host → frame: `data` with the latest Artifact Data. The initial data is inlined in the
 *   `srcDoc` as a `<script type="application/json" data-camox-data>` after the runtime and the
 *   font links, so it is read lazily, on first access.
 * - runtime → page: `observe-viewport` with `observe`, when the artifact's first `onViewport`
 *   subscription starts or its last one ends. While observed, the host sends `viewport` with
 *   `progress` and `visibleRatio` whenever they change.
 * - host → frame: `measure`, for frames sized to their content. The runtime then reports the
 *   document's `height` whenever it changes.
 * - runtime → page: `navigate` with an `href`. The host acts only with transient user activation.
 *
 * The theme part applies the tokens to the artifact's `:root` and keeps the body hidden until the
 * first theme arrives, so the artifact never paints in the wrong colors, or until a short fallback
 * timeout, so a page that never sends one can't hide it forever.
 *
 * Kept as plain JavaScript in a string: it runs in the artifact's document, not in the SDK's
 * bundle, so it can't share code or build helpers with it. The SDK's build minifies it (see
 * `plugins/minifyArtifactRuntime.ts`), so it must stay one template literal without
 * interpolations or backslashes.
 */
export const ARTIFACT_RUNTIME = `(() => {
  "use strict";
  const host = window.parent;
  let channel = null;
  let studio = null;
  let data;
  let dataJson;
  const dataListeners = new Set();
  const readData = () => {
    if (dataJson !== undefined) return data;
    const script = document.querySelector("script[data-camox-data]");
    try {
      data = script ? JSON.parse(script.textContent) : {};
    } catch {
      data = {};
    }
    dataJson = JSON.stringify(data);
    return data;
  };
  const camoxTheme = (() => {
    const listeners = new Set();
    let applied = [];
    let current = Object.freeze({ tokens: Object.freeze({}), colors: Object.freeze({}) });
    const hidden = document.createElement("style");
    hidden.textContent = "body { visibility: hidden !important; }";
    document.head.append(hidden);
    const reveal = () => hidden.remove();
    setTimeout(reveal, 300);
    const byte = (value) => (Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0);
    return {
      get current() {
        return current;
      },
      receive(message) {
        const tokens = {};
        const colors = {};
        const received = message.colors || {};
        for (const [name, value] of Object.entries(message.tokens || {})) {
          if (!name.startsWith("--") || typeof value !== "string") continue;
          tokens[name] = value;
          const color = Object.hasOwn(received, name) ? received[name] : null;
          if (!color || typeof color !== "object") continue;
          colors[name] = Object.freeze({ r: byte(color.r), g: byte(color.g), b: byte(color.b) });
        }
        const root = document.documentElement.style;
        for (const name of applied) if (!Object.hasOwn(tokens, name)) root.removeProperty(name);
        for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
        applied = Object.keys(tokens);
        reveal();
        current = Object.freeze({ tokens: Object.freeze(tokens), colors: Object.freeze(colors) });
        for (const listener of [...listeners]) listener(current);
      },
      subscribe(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    };
  })();
  const viewportCallbacks = new Set();
  let viewport = null;
  let heightObserver = null;
  let height = null;
  const reportHeight = () => {
    const next = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (next === height) return;
    height = next;
    send("height", { height });
  };
  const send = (type, message) => {
    if (channel) host.postMessage({ ...message, camox: type, channel }, "*");
  };
  const observeViewport = () => send("observe-viewport", { observe: viewportCallbacks.size > 0 });
  const receivers = {
    studio(message) {
      const next = message.studio;
      studio = next ? Object.freeze({ editing: !!next.editing, canvas: !!next.canvas }) : null;
    },
    data(message) {
      readData();
      const next = JSON.stringify(message.data ?? {});
      if (next === dataJson) return;
      data = JSON.parse(next);
      dataJson = next;
      for (const listener of [...dataListeners]) listener(data);
    },
    theme: camoxTheme.receive,
    measure() {
      height = null;
      if (!heightObserver) {
        heightObserver = new ResizeObserver(reportHeight);
        heightObserver.observe(document.documentElement);
      }
      reportHeight();
    },
    viewport(message) {
      const { progress, visibleRatio } = message;
      if (typeof progress !== "number" || typeof visibleRatio !== "number") return;
      viewport = Object.freeze({ progress, visibleRatio });
      document.documentElement.style.setProperty("--camox-progress", String(progress));
      for (const callback of viewportCallbacks) callback(viewport);
    },
  };
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.camox !== "string") return;
    if (message.camox === "connect") {
      if (typeof message.channel !== "string" || message.channel === channel) return;
      channel = message.channel;
      send("ready");
      if (viewportCallbacks.size > 0) observeViewport();
      return;
    }
    if (!channel || message.channel !== channel) return;
    if (Object.hasOwn(receivers, message.camox)) receivers[message.camox](message);
  });
  const camox = Object.freeze({
    get studio() {
      return studio;
    },
    get data() {
      return readData();
    },
    onData(callback) {
      dataListeners.add(callback);
      return () => {
        dataListeners.delete(callback);
      };
    },
    get theme() {
      return camoxTheme.current;
    },
    onTheme: camoxTheme.subscribe,
    navigate(href) {
      send("navigate", { href: String(href) });
    },
    onViewport(callback) {
      if (typeof callback !== "function") throw new TypeError("camox.onViewport needs a callback");
      const subscription = (next) => callback(next);
      viewportCallbacks.add(subscription);
      if (viewportCallbacks.size === 1) observeViewport();
      else if (viewport) {
        queueMicrotask(() => viewportCallbacks.has(subscription) && callback(viewport));
      }
      return () => {
        if (!viewportCallbacks.delete(subscription)) return;
        if (viewportCallbacks.size === 0) observeViewport();
      };
    },
  });
  Object.defineProperty(window, "camox", { value: camox, enumerable: true });
  if (host !== window) host.postMessage({ camox: "hello" }, "*");
})();`;
