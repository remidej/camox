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
import {
  deferredInbox,
  RENDERER_PROTOCOL,
  type ForwardedStore,
  type Inbox,
  type MirroredStore,
  type RendererFrameTarget,
  type RendererMessage,
  type StoreEvent,
  type StudioHandle,
  type StudioMessage,
} from "./protocol";

/** A store the studio owns, as the host needs it. */
type OwnedStore = {
  send: (event: never) => void;
  getSnapshot: () => { context: unknown };
  subscribe: (observer: (snapshot: { context: unknown }) => void) => { unsubscribe: () => void };
};

const mirrored: Record<MirroredStore, OwnedStore> = {
  preview: previewStore as unknown as OwnedStore,
  canvas: canvasStore as unknown as OwnedStore,
};

const forwarded: Record<ForwardedStore, OwnedStore> = {
  preview: previewStore as unknown as OwnedStore,
  referencePickerFocus: referencePickerFocus as unknown as OwnedStore,
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
  /** Stops following the studio. A renderer still connected hears nothing more. */
  close(): void;
}

type ShownFrame = { slot: HTMLElement; target: RendererFrameTarget; hears: FrameListener };

/**
 * The host of the studio whose cache is `studioCache`, viewing the draft `draftScope` names, which
 * the renderer shows too. Without them, the renderer hears nothing of the studio's cache.
 * The edits the renderer makes in place are written with the studio's own mutations, through
 * `queryClient`; without it, every one fails.
 */
export function createRendererHost({
  studioCache,
  draftScope,
  queryClient,
}: {
  studioCache?: StudioCache;
  draftScope?: DraftScope;
  queryClient?: QueryClient;
} = {}): RendererHost {
  const applyEdit =
    queryClient && studioCache ? createContentEditor({ queryClient, studioCache }) : undefined;
  const frames = new Map<string, ShownFrame>();
  let renderer: Inbox<StudioMessage> | null = null;
  /** Sends to the renderer once it said hello, in the protocol it speaks. */
  let welcomed = false;
  const post = (message: StudioMessage) => {
    if (welcomed) renderer?.(message);
  };
  const postStore = (store: MirroredStore) =>
    post({ type: "store", store, context: mirrored[store].getSnapshot().context });

  const subscriptions = (Object.keys(mirrored) as MirroredStore[]).map((store) =>
    mirrored[store].subscribe(() => postStore(store)),
  );

  // The renderer shows the draft the studio views, so it reads the same scope of keys.
  const shownScope = () => draftScope?.current() ?? LIVE_KEY_SCOPE;
  const shown = (queryKey: QueryKey) => scopeOfKey(queryKey) === shownScope();
  /** Whether a project room invalidation reaches the reads of the draft the renderer shows. */
  const reaches = async (message: InvalidationMessage, projectId: number) => {
    if (message.draftId === null) return true;
    if (!draftScope) return false;
    return (await draftScope.keyScopeOfDraft(message.draftId, projectId)) === shownScope();
  };
  const relayChange = (change: StudioCacheChange) => {
    switch (change.type) {
      case "received": {
        const { message, projectId } = change;
        void reaches(message, projectId).then(
          (reached) => reached && post({ type: "invalidate", message, projectId }),
        );
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
        welcomed = true;
        post({ type: "welcome", protocol: RENDERER_PROTOCOL });
        for (const store of Object.keys(mirrored) as MirroredStore[]) postStore(store);
        for (const [frameId, { slot, target }] of frames)
          post({ type: "frame", frameId, slot, target });
        return;
      }
      case "storeEvent": {
        const store = forwarded[message.store];
        if (!store) return;
        store.send(message.event as StoreEvent as never);
        return;
      }
      case "rendered":
        return frames.get(message.frameId)?.hears.rendered?.();
      case "error":
        return frames.get(message.frameId)?.hears.failed?.(message.message);
      case "navigate":
        return frames.get(message.frameId)?.hears.navigate?.(message.to);
      case "reveal":
        return frames.get(message.frameId)?.hears.reveal?.(message.element, message.immediate);
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
    close() {
      for (const subscription of subscriptions) subscription.unsubscribe();
      stopRelaying?.();
      stopFollowing?.();
      renderer = null;
    },
  };
}
