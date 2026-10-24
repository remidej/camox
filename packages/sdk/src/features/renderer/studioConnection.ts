import type { QueryClient } from "@tanstack/react-query";

import type { CamoxApp } from "../../core/createApp";
import type { ApplyContentEdit } from "../../core/editing/contentEdits";
import type { DraftScope } from "../../lib/draft-scope";
import type { StudioCache } from "../../lib/studio-reads";
import { canvasStore } from "../canvas/canvasStore";
import { previewStore } from "../preview/previewStore";
import { referencePickerFocus } from "../preview/referencePickerFocus";
import type { StudioNotice } from "../preview/studioNotice";
import { answerFromCode } from "./definitionAnswers";
import {
  deferredInbox,
  RENDERER_PROTOCOL,
  SDK_VERSION,
  type ForwardedStore,
  type Inbox,
  type MirroredStore,
  type MirrorEvent,
  type RendererFrameTarget,
  type RendererMessage,
  type StoreEvent,
  type StudioHandle,
  type StudioMessage,
} from "./protocol";

/** One frame the studio gave the renderer to fill. */
export interface RendererFrame {
  frameId: string;
  slot: HTMLElement;
  target: RendererFrameTarget;
}

/** One block thumbnail the studio gave the renderer to fill. */
export interface RendererThumbnail {
  thumbnailId: string;
  slot: HTMLElement;
  blockType: string;
}

/** A store of this document that mirrors or forwards to the studio's. */
type DocumentStore = {
  send: (event: never) => void;
  inspect: (observer: (event: { type: string; event?: StoreEvent }) => void) => {
    unsubscribe: () => void;
  };
};

/** A store of this document that takes the studio's state as it is (`mirror`). */
type MirroringStore = { send: (event: MirrorEvent) => void };

const mirrors: Record<MirroredStore, MirroringStore> = {
  preview: previewStore as unknown as MirroringStore,
  canvas: canvasStore as unknown as MirroringStore,
};

const forwards: Record<ForwardedStore, DocumentStore> = {
  preview: previewStore as unknown as DocumentStore,
  referencePickerFocus: referencePickerFocus as unknown as DocumentStore,
};

/** The renderer's side of its connection to the studio (see `protocol.ts`). */
export interface StudioConnection {
  /** Whether the studio welcomed the renderer, in its protocol and SDK version. */
  connected: () => boolean;
  /** The frames the studio gives the renderer to fill, in the order it gave them. */
  frames: () => RendererFrame[];
  /** The block thumbnails the studio gives the renderer to fill, in the order it gave them. */
  thumbnails: () => RendererThumbnail[];
  /** Calls `listener` whenever the frames or thumbnails change. */
  subscribe: (listener: () => void) => () => void;
  /** Tells the studio about one of its frames. */
  send(message: Exclude<RendererMessage, { type: "hello" | "storeEvent" | "edit" }>): void;
  /** Has the studio show the editor a notice. */
  notify(notice: StudioNotice): void;
  /** Has the studio write an edit made here. Settles as the studio answers. */
  edit: ApplyContentEdit;
  close(): void;
}

/**
 * Connects the renderer document to the studio through its handle. This document's stores then
 * mirror the studio's, its own events are forwarded to the studio, which owns their truth, and
 * its cache follows the studio's (see `protocol.ts`). The studio's questions are answered from
 * `camoxApp`, the draft's code; without it, none can be.
 */
export function connectToStudio(
  handle: StudioHandle,
  {
    queryClient,
    studioCache,
    draftScope,
    camoxApp,
  }: {
    queryClient: QueryClient;
    studioCache: StudioCache;
    draftScope: DraftScope;
    camoxApp?: CamoxApp;
  },
): StudioConnection {
  let welcomed = false;
  let frames: RendererFrame[] = [];
  const listeners = new Set<() => void>();
  let thumbnails: RendererThumbnail[] = [];
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const setFrames = (next: RendererFrame[]) => {
    frames = next;
    changed();
  };
  const setThumbnails = (next: RendererThumbnail[]) => {
    thumbnails = next;
    changed();
  };
  /** The edits sent to the studio that it hasn't answered yet. */
  const editsInFlight = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let lastEditId = 0;
  /** Whether the renderer holds the read under `queryKey`. */
  const holds = (queryKey: readonly unknown[]) =>
    !!queryClient.getQueryCache().find({ queryKey, exact: true });

  const receive = (message: StudioMessage) => {
    if (message.type === "welcome") {
      // Only a studio of the same SDK version speaks it: another one says it's updating.
      welcomed = message.protocol === RENDERER_PROTOCOL && message.sdkVersion === SDK_VERSION;
      return;
    }
    if (!welcomed) return;
    switch (message.type) {
      case "frame": {
        const frame = { frameId: message.frameId, slot: message.slot, target: message.target };
        const index = frames.findIndex(({ frameId }) => frameId === message.frameId);
        setFrames(
          index < 0
            ? [...frames, frame]
            : frames.map((shown, at) => (at === index ? frame : shown)),
        );
        return;
      }
      case "frameEnd":
        setFrames(frames.filter(({ frameId }) => frameId !== message.frameId));
        return;
      case "store":
        mirrors[message.store]?.send({ type: "mirror", context: message.context });
        return;
      case "draftStarted":
        draftScope.enterStarted(message.draftId);
        return;
      case "invalidate":
        void studioCache.receive(message.message, message.projectId);
        return;
      case "write":
        if (!holds(message.queryKey)) return;
        if ("value" in message && message.value !== undefined)
          queryClient.setQueryData(message.queryKey, message.value);
        else queryClient.removeQueries({ queryKey: message.queryKey, exact: true });
        return;
      case "outdated":
        for (const queryKey of message.queryKeys)
          if (holds(queryKey)) void queryClient.invalidateQueries({ queryKey, exact: true });
        return;
      case "thumbnail": {
        const { thumbnailId, slot, blockType } = message;
        const thumbnail = { thumbnailId, slot, blockType };
        const index = thumbnails.findIndex((shown) => shown.thumbnailId === thumbnailId);
        setThumbnails(
          index < 0
            ? [...thumbnails, thumbnail]
            : thumbnails.map((shown, at) => (at === index ? thumbnail : shown)),
        );
        return;
      }
      case "thumbnailEnd":
        setThumbnails(thumbnails.filter(({ thumbnailId }) => thumbnailId !== message.thumbnailId));
        return;
      case "ask": {
        const { askId, question } = message;
        if (!camoxApp) {
          studio({ type: "answer", askId, error: "The renderer has no code to answer with." });
          return;
        }
        void answerFromCode(camoxApp, question).then(
          (value) => studio({ type: "answer", askId, value }),
          (error: unknown) =>
            studio({
              type: "answer",
              askId,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
        return;
      }
      case "edited": {
        const edit = editsInFlight.get(message.editId);
        if (!edit) return;
        editsInFlight.delete(message.editId);
        if (message.error === undefined) edit.resolve();
        else edit.reject(new Error(message.error));
        return;
      }
    }
  };

  const studio: Inbox<RendererMessage> = handle.connect(deferredInbox(receive));
  studio({ type: "hello", protocol: RENDERER_PROTOCOL, sdkVersion: SDK_VERSION });

  // This document's events go to the studio, which applies them and sends its state back.
  // Applying them here first shows them at once: the studio's state, the same, then replaces it.
  const inspections = (Object.keys(forwards) as ForwardedStore[]).map((store) =>
    forwards[store].inspect((inspection) => {
      const event = inspection.event;
      if (inspection.type !== "@xstate.transition" || !event) return;
      if (event.type === "mirror" || event.type.startsWith("@xstate.")) return;
      studio({ type: "storeEvent", store, event: { ...event } });
    }),
  );

  return {
    connected: () => welcomed,
    frames: () => frames,
    thumbnails: () => thumbnails,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send: (message) => studio(message),
    notify: (notice) => studio({ type: "notify", notice }),
    edit: (edit) =>
      new Promise((resolve, reject) => {
        const editId = ++lastEditId;
        editsInFlight.set(editId, { resolve, reject });
        studio({ type: "edit", editId, edit });
      }),
    close() {
      for (const inspection of inspections) inspection.unsubscribe();
      listeners.clear();
    },
  };
}
