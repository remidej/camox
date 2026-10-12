/**
 * The `camox` runtime, injected at the top of every artifact's `srcDoc` so `window.camox` always
 * exists before the artifact source runs.
 *
 * Protocol (every message is `{ camox: <type>, channel?, ...payload }`, posted with `"*"`):
 * - runtime → page: `hello` when the runtime starts, so the page's hosts (re)connect their frames.
 * - host → frame: `connect` with the host's private `channel`. The runtime adopts it and answers.
 * - runtime → page: `ready` on that channel. Only the host that owns the channel listens to it,
 *   so hosts never need `event.source`, which can't be compared across realms.
 * - host → frame: state messages on the channel, such as `studio`.
 * - runtime → page: `observe-viewport` with `observe`, when the artifact's first `onViewport`
 *   subscription starts or its last one ends. While observed, the host sends `viewport` with
 *   `progress` and `visibleRatio` whenever they change.
 * - host → frame: `measure`, for frames sized to their content. The runtime then reports the
 *   document's `height` whenever it changes.
 * - runtime → page: `navigate` with an `href`. The host acts only with transient user activation.
 *
 * Kept as plain JavaScript in a string: it runs in the artifact's document, not in the SDK's
 * bundle, so it can't share code or build helpers with it.
 */
export const ARTIFACT_RUNTIME = `(() => {
  "use strict";
  const host = window.parent;
  let channel = null;
  let studio = null;
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
      studio = next ? Object.freeze({ editMode: !!next.editMode, canvas: !!next.canvas }) : null;
    },
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
