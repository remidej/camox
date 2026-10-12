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
 * - host → frame: `data` with the latest Artifact Data. The initial data is inlined in the
 *   `srcDoc` as a `<script type="application/json" data-camox-data>` after the runtime, so it is
 *   read lazily, on first access.
 *
 * Kept as plain JavaScript in a string: it runs in the artifact's document, not in the SDK's
 * bundle, so it can't share code or build helpers with it.
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
  const send = (type, message) => {
    if (channel) host.postMessage({ ...message, camox: type, channel }, "*");
  };
  const receivers = {
    studio(message) {
      const next = message.studio;
      studio = next ? Object.freeze({ editMode: !!next.editMode, canvas: !!next.canvas }) : null;
    },
    data(message) {
      readData();
      const next = JSON.stringify(message.data ?? {});
      if (next === dataJson) return;
      data = JSON.parse(next);
      dataJson = next;
      for (const listener of [...dataListeners]) listener(data);
    },
  };
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.camox !== "string") return;
    if (message.camox === "connect") {
      if (typeof message.channel !== "string" || message.channel === channel) return;
      channel = message.channel;
      send("ready");
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
  });
  Object.defineProperty(window, "camox", { value: camox, enumerable: true });
  if (host !== window) host.postMessage({ camox: "hello" }, "*");
})();`;
