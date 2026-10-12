export type HighlightCandidate = {
  /** DOM depth. Repeatable items rank between their elements and those elements' parent. */
  depth: number;
  hovered: boolean;
  focused: boolean;
  hoverGroup?: string | null;
};

const states = ["hovered", "focused"] as const;

/**
 * Local and remote interactions publish the same candidate state. Resolve
 * them together, independently for hover and selection, before the browser paints.
 * A repeater-level hover represents all items in that group, not just its deepest
 * item. Individual targets still resolve by depth, with candidate order breaking ties.
 */
export function resolveOverlayHighlights<T extends HighlightCandidate>(
  candidates: readonly T[],
): Record<(typeof states)[number], Set<T>> {
  const resolve = (state: (typeof states)[number]) => {
    let winner: T | undefined;
    for (const candidate of candidates) {
      if (!candidate[state]) continue;
      if (winner && candidate.depth <= winner.depth) continue;
      winner = candidate;
    }
    const group = state === "hovered" ? winner?.hoverGroup : null;
    if (!group) return new Set(winner ? [winner] : []);
    return new Set(
      candidates.filter((candidate) => candidate[state] && candidate.hoverGroup === group),
    );
  };
  return { hovered: resolve("hovered"), focused: resolve("focused") };
}
