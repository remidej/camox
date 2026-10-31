import {
  LIVE_KEY_SCOPE,
  scopeOfKey,
  type InvalidationMessage,
  type QueryKey,
} from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";

import { createContentEditor } from "../../core/editing/contentEdits";
import type { DraftScope } from "../../lib/draft-scope";
import type { StudioCache, StudioCacheChange } from "../../lib/studio-reads";
import { canvasStore } from "../canvas/canvasStore";
import { previewStore } from "../preview/previewStore";
import { referencePickerFocus } from "../preview/referencePickerFocus";
import type { StudioNotice } from "../preview/studioNotice";
import {
  deferredInbox,
  RENDERER_PROTOCOL,
  SDK_VERSION,
  type ForwardedEvents,
  type ForwardedStore,
  type Inbox,
  type MirroredStore,
  type RendererAnswer,
  type RendererFrameTarget,
  type RendererMessage,
  type RendererQuestion,
  type StoreEventMessage,
  type StoreMessage,
  type StudioHandle,
  type StudioMessage,
} from "./protocol";

/** The studio's state of each store the renderer mirrors. */
const storeMessages: { [Store in MirroredStore]: () => StoreMessage<Store> } = {
  preview: () => ({ type: "store", store: "preview", context: previewStore.getSnapshot().context }),
  canvas: () => ({ type: "store", store: "canvas", context: canvasStore.getSnapshot().context }),
};

/** The stores the renderer forwards its events to, as the host applies them. */
const forwarded: {
  [Store in ForwardedStore]: { send: (event: ForwardedEvents[Store]) => void };
} = { preview: previewStore, referencePickerFocus };

/** Applies an event the renderer forwarded to the studio's store. */
const applyStoreEvent = <Store extends ForwardedStore>(message: StoreEventMessage<Store>) => {
  const store = forwarded[message.store];
  if (!store) return;
  store.send(message.event);
};

/** What the studio hears about one of its frames. */
export interface FrameListener {
  /** The page committed, or settled again after a change. */
  rendered?: () => void;
  /** The page threw while rendering. */
  failed?: (message: string) => void;
  /** The page navigated. */
  navigate?: (to: string) => void;
  /** An element of the page wants into view. */
  reveal?: (element: Element, immediate: boolean) => void;
}

/**
 * The studio's side of the renderer frame (see `protocol.ts`). It owns the connection to the
 * renderer document, whichever one is connected, and keeps it told of the studio's state.
 */
export interface RendererHost {
  /** What the renderer frame's element holds, for its document to connect with. */
  readonly handle: StudioHandle;
  /**
   * Has the renderer render `target` into `slot`, an element of a visible frame's document, until
   * hidden. Showing the same frame again updates what it shows. `hears` is told what the renderer
   * says about it.
   */
  show(
    frameId: string,
    slot: HTMLElement,
    target: RendererFrameTarget,
    hears?: FrameListener,
  ): void;
  /** Has the renderer stop rendering the frame. */
  hide(frameId: string): void;
  /**
   * Stops talking to the renderer connected, as another renderer document is loading to take its
   * place: what the studio sends and asks from here on waits for that one.
   */
  replacing(): void;
  /**
   * Asks the renderer what only the draft's code knows. Settles once a renderer answers: the one
   * connected, or else the next to connect.
   */
  ask<Question extends RendererQuestion>(question: Question): Promise<RendererAnswer<Question>>;
  /**
   * Has the renderer render a thumbnail of a `blockType` block into `slot`, an element of the
   * thumbnail's frame, until hidden.
   */
  showThumbnail(thumbnailId: string, slot: HTMLElement, blockType: string): void;
  /** Has the renderer stop rendering the thumbnail. */
  hideThumbnail(thumbnailId: string): void;
  /**
   * Calls `listener` each time a renderer connects, as the answers the last one gave may change.
   * Returns a function that stops calling it.
   */
  subscribe(listener: () => void): () => void;
  /** Where the connection to the renderer document stands. */
  status(): RendererStatus;
  /** Calls `listener` each time the status changes. Returns a function that stops calling it. */
  subscribeStatus(listener: () => void): () => void;
  /** Stops following the studio. A renderer still connected hears nothing more. */
  close(): void;
}

/**
 * Where the connection stands: no renderer said hello yet, one of the studio's SDK version did,
 * or one of another version did, so the frames wait for a revision built with the studio's.
 */
export type RendererStatus = "connecting" | "connected" | "updating";

type ShownFrame = { slot: HTMLElement; target: RendererFrameTarget; hears: FrameListener };

/**
 * The host of the studio whose cache is `studioCache`, viewing the draft `draftScope` names, which
 * the renderer shows too. Without them, the renderer hears nothing of the studio's cache.
 * The edits the renderer makes in place are written with the studio's own mutations, through
 * `queryClient`; without it, every one fails. What the renderer's pages tell the editor goes to
 * `notify`.
 */
export function createRendererHost({
  studioCache,
  draftScope,
  queryClient,
  notify,
}: {
  studioCache?: StudioCache;
  draftScope?: DraftScope;
  queryClient?: QueryClient;
  notify?: (notice: StudioNotice) => void;
} = {}): RendererHost {
  const applyEdit =
    queryClient && studioCache ? createContentEditor({ queryClient, studioCache }) : undefined;
  const frames = new Map<string, ShownFrame>();
  const thumbnails = new Map<string, { slot: HTMLElement; blockType: string }>();
  /** The questions asked that no renderer answered yet. */
  const asked = new Map<
    number,
    {
      question: RendererQuestion;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  let lastAskId = 0;
  const connectionListeners = new Set<() => void>();
  let status: RendererStatus = "connecting";
  const statusListeners = new Set<() => void>();
  const setStatus = (next: RendererStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener();
  };
  let renderer: Inbox<StudioMessage> | null = null;
  /** Sends to the renderer once it said hello, in the protocol it speaks. */
  let welcomed = false;
  const post = (message: StudioMessage) => {
    if (welcomed) renderer?.(message);
  };
  const postStore = (store: MirroredStore) => post(storeMessages[store]());

  const subscriptions = [
    previewStore.subscribe(() => postStore("preview")),
    canvasStore.subscribe(() => postStore("canvas")),
  ];

  // The renderer shows the draft the studio views, so it reads the same scope of keys.
  const shownScope = () => draftScope?.current() ?? LIVE_KEY_SCOPE;
  const shown = (queryKey: QueryKey) => scopeOfKey(queryKey) === shownScope();
  /** Whether a project room invalidation reaches the reads of the draft the renderer shows. */
  const reaches = (message: InvalidationMessage) =>
    message.draftId === null || (!!draftScope && message.draftId === shownScope());
  const relayChange = (change: StudioCacheChange) => {
    switch (change.type) {
      case "received": {
        const { message, projectId } = change;
        if (reaches(message)) post({ type: "invalidate", message, projectId });
        return;
      }
      case "wrote":
        if (!shown(change.queryKey)) return;
        post({
          type: "write",
          queryKey: change.queryKey,
          ...("value" in change && change.value !== undefined && { value: change.value }),
        });
        return;
      case "outdated": {
        const queryKeys = change.queryKeys.filter(shown);
        if (queryKeys.length) post({ type: "outdated", queryKeys });
        return;
      }
    }
  };
  const stopRelaying = studioCache?.subscribe(relayChange);
  // A draft the studio's first content write starts shows what Live did: the renderer enters it.
  const stopFollowing = draftScope?.subscribe(({ draftId, move }) => {
    if (move === "started" && draftId) post({ type: "draftStarted", draftId });
  });

  const receive = (message: RendererMessage) => {
    switch (message.type) {
      case "hello": {
        if (message.protocol !== RENDERER_PROTOCOL) return;
        // Both sides learn the other's version. Another SDK's renderer hears nothing more.
        renderer?.({ type: "welcome", protocol: RENDERER_PROTOCOL, sdkVersion: SDK_VERSION });
        if (message.sdkVersion !== SDK_VERSION) return setStatus("updating");
        welcomed = true;
        setStatus("connected");
        for (const store of Object.keys(storeMessages) as MirroredStore[]) postStore(store);
        for (const [frameId, { slot, target }] of frames)
          post({ type: "frame", frameId, slot, target });
        for (const [thumbnailId, { slot, blockType }] of thumbnails)
          post({ type: "thumbnail", thumbnailId, slot, blockType });
        for (const [askId, { question }] of asked) post({ type: "ask", askId, question });
        for (const listener of connectionListeners) listener();
        return;
      }
      case "storeEvent":
        return applyStoreEvent(message);
      case "rendered":
        return frames.get(message.frameId)?.hears.rendered?.();
      case "error":
        return frames.get(message.frameId)?.hears.failed?.(message.message);
      case "navigate":
        return frames.get(message.frameId)?.hears.navigate?.(message.to);
      case "reveal":
        return frames.get(message.frameId)?.hears.reveal?.(message.element, message.immediate);
      case "answer": {
        const question = asked.get(message.askId);
        if (!question) return;
        asked.delete(message.askId);
        if (message.error === undefined) question.resolve(message.value ?? null);
        else question.reject(new Error(message.error));
        return;
      }
      case "notify":
        return notify?.(message.notice);
      case "edit": {
        const { editId, edit } = message;
        // The answer goes to the renderer that sent the edit: one connected since never hears it.
        const sender = renderer;
        const answer = (error?: string) => {
          if (renderer === sender) post({ type: "edited", editId, ...(error && { error }) });
        };
        if (!applyEdit) return answer("The studio can't save changes made here.");
        void applyEdit(edit).then(
          () => answer(),
          (cause: unknown) =>
            answer(cause instanceof Error ? cause.message : "Couldn't save the change."),
        );
        return;
      }
    }
  };

  return {
    handle: {
      connect(inbox) {
        // A new renderer document replaces the last one, which hears nothing more.
        renderer = deferredInbox(inbox);
        welcomed = false;
        const connected = renderer;
        return deferredInbox((message: RendererMessage) => {
          if (renderer === connected) receive(message);
        });
      },
    },
    show(frameId, slot, target, hears = {}) {
      frames.set(frameId, { slot, target, hears });
      post({ type: "frame", frameId, slot, target });
    },
    hide(frameId) {
      if (!frames.delete(frameId)) return;
      post({ type: "frameEnd", frameId });
    },
    replacing() {
      // The pages it rendered stay in their slots until the next renderer's replace them.
      renderer = null;
      welcomed = false;
    },
    ask(question) {
      return new Promise((resolve, reject) => {
        const askId = ++lastAskId;
        asked.set(askId, { question, resolve: resolve as (value: unknown) => void, reject });
        post({ type: "ask", askId, question });
      });
    },
    showThumbnail(thumbnailId, slot, blockType) {
      thumbnails.set(thumbnailId, { slot, blockType });
      post({ type: "thumbnail", thumbnailId, slot, blockType });
    },
    hideThumbnail(thumbnailId) {
      if (!thumbnails.delete(thumbnailId)) return;
      post({ type: "thumbnailEnd", thumbnailId });
    },
    subscribe(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    status: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    close() {
      connectionListeners.clear();
      statusListeners.clear();
      for (const subscription of subscriptions) subscription.unsubscribe();
      stopRelaying?.();
      stopFollowing?.();
      renderer = null;
    },
  };
}
