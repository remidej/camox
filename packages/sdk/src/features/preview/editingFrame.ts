import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import type { OverlayMessage } from "./overlayMessages";
import { previewStore, type EditingOwner } from "./previewStore";

/**
 * The editing frame: the frame whose Page or Layout the Studio edits, where the
 * Preview and the Canvas meet. The Preview and Canvas frames claim it, and the
 * Studio's sidebars and toolbars send it overlay messages, never reaching into a
 * frame themselves.
 *
 * - One claim is active at a time, and the latest claim wins.
 * - A claim belongs to the component that made it, not to its frame: the Preview
 *   and the Canvas slot of the selected Page share one frame, yet each releases
 *   only its own claim.
 * - Releasing clears the selection, but only while the claim is still active.
 * - Claiming again for the same owner keeps the selection; another owner clears it.
 */

/**
 * What the module needs from a frame: its document, and its window to post to.
 * An iframe is one; tests pass a fake that records what is sent.
 */
export interface EditingFrameElement {
  readonly contentDocument: Document | null;
  readonly contentWindow: {
    postMessage(message: OverlayMessage, targetOrigin: string): void;
  } | null;
}

/** Ends a claim, unless another one has replaced it since. */
export type ReleaseEditingFrame = () => void;

type Claim = { holder: symbol; frame: EditingFrameElement | null };

const editingFrameStore = createStore({
  context: { claim: null as Claim | null },
  on: {
    claim: (_, claim: Claim) => ({ claim }),
    release: () => ({ claim: null }),
  },
});

function holds(holder: symbol) {
  return editingFrameStore.getSnapshot().context.claim?.holder === holder;
}

function claim(holder: symbol, frame: EditingFrameElement | null, owner: EditingOwner | null) {
  editingFrameStore.send({ type: "claim", holder, frame });
  if (owner?.kind === "layout") {
    previewStore.send({ type: "activateLayout", layoutId: owner.layoutId });
    return;
  }
  previewStore.send({ type: "activatePage", pageId: owner?.pageId ?? null });
}

function release(holder: symbol) {
  if (!holds(holder)) return;
  editingFrameStore.send({ type: "release" });
  previewStore.send({ type: "clearSelection" });
}

/**
 * The owner a frame edits. A derived layout's pages have no page row, so they edit
 * their layout; any other Page edits itself.
 */
export function useEditingOwner({
  pageId,
  layoutId,
}: {
  pageId?: string;
  layoutId?: string;
}): EditingOwner | null {
  return React.useMemo(() => {
    if (layoutId != null) return { kind: "layout", layoutId };
    if (pageId != null) return { kind: "page", pageId };
    return null;
  }, [pageId, layoutId]);
}

/**
 * For the Preview and the Canvas: returns a stable `claim`, which makes `frame`
 * the editing frame, for `owner`, and returns its release. Call it from effects
 * and handlers, never while rendering.
 *
 * The claim follows `frame` while it is active, so it may be made before the frame
 * loads. Unmounting releases it.
 */
export function useEditingFrameClaim(
  frame: EditingFrameElement | null,
  owner: EditingOwner | null,
): () => ReleaseEditingFrame {
  const [holder] = React.useState(() => Symbol("editing frame claim"));
  const latest = React.useRef({ frame, owner });
  React.useLayoutEffect(() => {
    latest.current = { frame, owner };
  });
  React.useLayoutEffect(() => {
    if (!holds(holder)) return;
    editingFrameStore.send({ type: "claim", holder, frame });
  }, [holder, frame]);
  React.useLayoutEffect(() => () => release(holder), [holder]);
  return React.useCallback(() => {
    claim(holder, latest.current.frame, latest.current.owner);
    return () => release(holder);
  }, [holder]);
}

/**
 * For everything else: the editing frame's document, if any, and `send`, which
 * posts an overlay message to it. Sending without an editing frame does nothing.
 * `send` changes with the editing frame, so an effect's cleanup reaches the frame
 * its effect sent to.
 */
export function useEditingFrame() {
  const frame = useSelector(editingFrameStore, (state) => state.context.claim?.frame ?? null);
  const send = React.useCallback(
    (message: OverlayMessage) => frame?.contentWindow?.postMessage(message, "*"),
    [frame],
  );
  return { document: frame?.contentDocument ?? null, send };
}
