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
 * Equal-depth candidates (e.g. a sidebar-hovered list) use document order.
 */
export function observeOverlayHighlights(document: Document): () => void {
  const Observer = document.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const winners = new Map<(typeof states)[number], Element>();
  const update = () => {
    for (const state of states) {
      let winner: Element | undefined;
      let deepest = -1;
      for (const candidate of document.querySelectorAll(`[data-camox-${state}]`)) {
        const depth = depthOf(targetOf(candidate));
        if (depth <= deepest) continue;
        deepest = depth;
        winner = candidate;
      }
      const previous = winners.get(state);
      if (previous === winner) continue;
      previous?.removeAttribute(`data-camox-highlight-${state}`);
      winner?.setAttribute(`data-camox-highlight-${state}`, "");
      if (winner) winners.set(state, winner);
      else winners.delete(state);
    }
  };
  const observer = new Observer(update);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: states.map((state) => `data-camox-${state}`),
  });
  update();
  return () => {
    observer.disconnect();
    for (const [state, winner] of winners) {
      winner.removeAttribute(`data-camox-highlight-${state}`);
    }
  };
}
