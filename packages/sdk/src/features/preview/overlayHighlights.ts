const states = ["hovered", "focused"] as const;

/** Detached borders represent their parent, not the portal div's DOM depth. */
function targetOf(element: Element): Element {
  return element.hasAttribute("data-camox-detached") ? (element.parentElement ?? element) : element;
}

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
export function observeOverlayHighlights(document: Document): () => void {
  const Observer = document.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const winners = new Map<(typeof states)[number], Set<Element>>();
  const update = () => {
    for (const state of states) {
      let winner: Element | undefined;
      let deepest = -1;
      const candidates = Array.from(document.querySelectorAll(`[data-camox-${state}]`));
      for (const candidate of candidates) {
        const depth = depthOf(targetOf(candidate));
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
  const observer = new Observer(update);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...states.map((state) => `data-camox-${state}`), "data-camox-hover-group"],
  });
  update();
  return () => {
    observer.disconnect();
    for (const [state, elements] of winners) {
      for (const element of elements) element.removeAttribute(`data-camox-highlight-${state}`);
    }
  };
}
