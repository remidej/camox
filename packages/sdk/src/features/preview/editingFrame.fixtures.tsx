import * as React from "react";

import {
  useEditingFrame,
  useEditingFrameClaim,
  type EditingFrameElement,
  type ReleaseEditingFrame,
} from "./editingFrame";
import type { OverlayMessage } from "./overlayMessages";
import type { EditingOwner } from "./previewStore";

/** A frame whose window records the overlay messages the Studio sends it. */
export function fakeEditingFrame(document: Document | null = null) {
  const sent: OverlayMessage[] = [];
  const frame: EditingFrameElement = {
    contentDocument: document,
    contentWindow: {
      postMessage: (message) => {
        sent.push(message);
      },
    },
  };
  return { frame, sent };
}

/**
 * Another frame of the Studio, such as a Canvas frame: claims the editing frame
 * once mounted, or with `claimed` false, only when `claim()` is called.
 */
export function EditingFrameClaimant({
  frame,
  owner,
  claimed = true,
  onClaim,
}: {
  frame: EditingFrameElement | null;
  owner: EditingOwner | null;
  claimed?: boolean;
  /** Receives the claim function, for claiming later. */
  onClaim?: (claim: () => ReleaseEditingFrame) => void;
}) {
  const claim = useEditingFrameClaim(frame, owner);
  React.useLayoutEffect(() => {
    onClaim?.(claim);
  }, [onClaim, claim]);
  React.useLayoutEffect(() => {
    if (claimed) claim();
  }, [claimed, claim, frame, owner]);
  return null;
}

/** What the Studio's sidebars see of the editing frame. */
export function editingFrameProbe() {
  const seen: { current?: ReturnType<typeof useEditingFrame> } = {};
  function EditingFrameProbe() {
    const editingFrame = useEditingFrame();
    React.useLayoutEffect(() => {
      seen.current = editingFrame;
    });
    return null;
  }
  return {
    EditingFrameProbe,
    get document() {
      return seen.current?.document ?? null;
    },
    send(message: OverlayMessage) {
      seen.current?.send(message);
    },
  };
}

/**
 * The rest of the Studio, in its own root: a sidebar reading the editing frame,
 * and other frames that may claim it. Rendered into `document`, after globals
 * such as `window` point at it.
 */
export async function editingFrameHarness(document: Document) {
  const { createRoot } = await import("react-dom/client");
  const sidebar = editingFrameProbe();
  const root = createRoot(document.createElement("div"));
  let other: React.ReactNode = null;
  const render = () =>
    React.act(async () =>
      root.render(
        <>
          <sidebar.EditingFrameProbe />
          {other}
        </>,
      ),
    );
  await render();
  return {
    /** The editing frame's document, as the Studio's sidebars see it. */
    get document() {
      return sidebar.document;
    },
    send: (message: OverlayMessage) => sidebar.send(message),
    /** Another frame, showing `frameDocument`, claims the editing frame for `owner`. */
    async claimElsewhere(
      owner: EditingOwner | null,
      frameDocument: Document = document.implementation.createHTMLDocument(),
    ) {
      const fake = fakeEditingFrame(frameDocument);
      other = <EditingFrameClaimant frame={fake.frame} owner={owner} />;
      await render();
      return { ...fake, document: frameDocument };
    },
    /** That other frame goes away, releasing its claim. */
    async releaseElsewhere() {
      other = null;
      await render();
    },
    async close() {
      await React.act(async () => root.unmount());
    },
  };
}
