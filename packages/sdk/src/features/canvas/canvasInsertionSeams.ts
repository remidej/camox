import type { OverlayMessage } from "../preview/overlayMessages";
import type { CanvasOverlayTarget } from "./canvasOverlayGeometry";

export type CanvasBlockInsertion = {
  position: string;
  before: boolean;
  after: boolean;
  afterPosition?: string | null;
};

export type CanvasInsertionSeam = {
  key: string;
  x: number;
  y: number;
  request: Extract<OverlayMessage, { type: "CAMOX_ADD_BLOCK_REQUEST" }>;
};

/** Main block wrappers publish insertion permissions, including layout boundaries.
 * Detached block targets and fields deliberately do not publish this metadata. */
export function readBlockInsertion(element: Element): CanvasBlockInsertion | undefined {
  const value = element.getAttribute("data-camox-block-insertion");
  if (!value) return;
  try {
    const insertion = JSON.parse(value) as CanvasBlockInsertion;
    if (
      !insertion ||
      typeof insertion.position !== "string" ||
      typeof insertion.before !== "boolean" ||
      typeof insertion.after !== "boolean" ||
      (insertion.afterPosition !== undefined &&
        insertion.afterPosition !== null &&
        typeof insertion.afterPosition !== "string")
    )
      return;
    return insertion;
  } catch {
    return;
  }
}

/** Walk boundaries, not blocks: the bottom of one block and the top of its
 * successor describe ONE insertion seam, even when both permit insertion. */
export function canvasInsertionSeams(targets: CanvasOverlayTarget[]): CanvasInsertionSeam[] {
  const blocks = targets.filter(
    (target) => target.insertion && target.bounds.width > 0 && target.bounds.height > 0,
  );
  const seams: CanvasInsertionSeam[] = [];
  for (let index = 0; index <= blocks.length; index++) {
    const previous = blocks[index - 1];
    const next = blocks[index];
    const anchor = previous?.insertion?.after ? previous : next?.insertion?.before ? next : null;
    if (!anchor?.insertion) continue;
    const insertPosition = anchor === previous ? "after" : "before";
    const { position, afterPosition } = anchor.insertion;
    // Center in the gap when a layout puts space between adjacent blocks.
    const y =
      previous && next
        ? (previous.bounds.y + previous.bounds.height + next.bounds.y) / 2
        : anchor.bounds.y + (insertPosition === "after" ? anchor.bounds.height : 0);
    seams.push({
      key: `${previous?.element.getAttribute("data-camox-block-id") ?? "start"}:${next?.element.getAttribute("data-camox-block-id") ?? "end"}`,
      x: anchor.bounds.x + anchor.bounds.width / 2,
      y,
      request: {
        type: "CAMOX_ADD_BLOCK_REQUEST",
        blockPosition: position,
        insertPosition,
        ...(afterPosition !== undefined ? { afterPosition } : {}),
      },
    });
  }
  return seams;
}
