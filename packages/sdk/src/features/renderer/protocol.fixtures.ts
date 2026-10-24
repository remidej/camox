import {
  RENDERER_PROTOCOL,
  SDK_VERSION,
  type Inbox,
  type RendererMessage,
  type StudioHandle,
  type StudioMessage,
} from "./protocol";

/** Waits until every message in flight between the two sides has been handled. */
export async function settle() {
  for (let round = 0; round < 4; round++) await new Promise((resolve) => setTimeout(resolve));
}

/**
 * A renderer frame that speaks the protocol and nothing else: it connects through the studio's
 * handle, records what the studio tells it, and sends what the test says.
 */
export function fakeRenderer(
  handle: StudioHandle,
  { protocol = RENDERER_PROTOCOL, sdkVersion = SDK_VERSION } = {},
) {
  const received: StudioMessage[] = [];
  const studio = handle.connect((message) => received.push(message));
  studio({ type: "hello", protocol, sdkVersion });
  return {
    received,
    send: studio as Inbox<RendererMessage>,
    /** The messages of `type` received so far. */
    all<T extends StudioMessage["type"]>(type: T) {
      return received.filter(
        (message): message is Extract<StudioMessage, { type: T }> => message.type === type,
      );
    },
    /** The last message of `type` received, if any. */
    last<T extends StudioMessage["type"]>(type: T) {
      return this.all(type).at(-1);
    },
  };
}

/**
 * A studio that speaks the protocol and nothing else, for a renderer to connect to: it records
 * what the renderer tells it, and sends what the test says once the renderer said hello.
 */
export function fakeStudio({ protocol = RENDERER_PROTOCOL, sdkVersion = SDK_VERSION } = {}) {
  const received: RendererMessage[] = [];
  let renderer: Inbox<StudioMessage> | null = null;
  const handle: StudioHandle = {
    connect(inbox) {
      renderer = inbox;
      return (message) => {
        received.push(message);
        if (message.type === "hello") inbox({ type: "welcome", protocol, sdkVersion });
      };
    },
  };
  return {
    handle,
    received,
    send(message: StudioMessage) {
      if (!renderer) throw new Error("The renderer hasn't connected yet");
      renderer(message);
    },
    all<T extends RendererMessage["type"]>(type: T) {
      return received.filter(
        (message): message is Extract<RendererMessage, { type: T }> => message.type === type,
      );
    },
  };
}
