const states = ["hovered", "focused"] as const;

function depthOf(element: Element): number {
  let depth = 0;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) depth++;
  return depth;
}

/**
 * Local and remote interactions publish the same candidate attributes. Resolve
 * them together, independently for hover and selection, before the browser paints.
 * A repeater-level hover represents all items in that group, not just its deepest
 * item. Individual targets still resolve by depth, with document order breaking ties.
 */
export function observeOverlayHighlights(
  document: Document,
  isEligible: (element: Element) => boolean = () => true,
): { refresh: () => void; dispose: () => void } {
  const Observer = document.defaultView?.MutationObserver;
  const winners = new Map<(typeof states)[number], Set<Element>>();
  const update = () => {
    for (const state of states) {
      let winner: Element | undefined;
      let deepest = -1;
      const candidates = Array.from(document.querySelectorAll(`[data-camox-${state}]`)).filter(
        isEligible,
      );
      for (const candidate of candidates) {
        const depth = depthOf(candidate);
        if (depth <= deepest) continue;
        deepest = depth;
        winner = candidate;
      }
      const group = state === "hovered" ? winner?.getAttribute("data-camox-hover-group") : null;
      const next = new Set(
        group
          ? candidates.filter(
              (candidate) => candidate.getAttribute("data-camox-hover-group") === group,
            )
          : winner
            ? [winner]
            : [],
      );
      const previous = winners.get(state) ?? new Set<Element>();
      for (const element of previous) {
        if (!next.has(element)) element.removeAttribute(`data-camox-highlight-${state}`);
      }
      for (const element of next) {
        if (!previous.has(element)) element.setAttribute(`data-camox-highlight-${state}`, "");
      }
      winners.set(state, next);
    }
  };
  const observer = Observer ? new Observer(update) : undefined;
  observer?.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...states.map((state) => `data-camox-${state}`), "data-camox-hover-group"],
  });
  update();
  return {
    refresh: update,
    dispose: () => {
      observer?.disconnect();
      for (const [state, elements] of winners) {
        for (const element of elements) element.removeAttribute(`data-camox-highlight-${state}`);
      }
    },
  };
}
