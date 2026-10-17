import type { FragmentInstance } from "react";

/**
 * Repeatable items render no element of their own: the editor tracks each item
 * through a Fragment ref over the author's elements, so the edited page keeps the
 * live site's DOM. This registry is how canvas overlays find
 * those items, since no attribute marks them in the document.
 */
export type RepeatableItemState = {
  hovered: boolean;
  focused: boolean;
  /** Shared by every item of a repeater hovered from the sidebar. */
  hoverGroup: string | null;
  synced: boolean;
};

export type RepeatableItemTarget = RepeatableItemState & {
  fragment: FragmentInstance;
  blockId: string;
  itemId: string;
  /** 0 for a block's repeater, +1 per enclosing item. */
  nesting: number;
};

type ChangeKind = "content" | "state";
type Registry = {
  items: Set<RepeatableItemTarget>;
  listeners: Set<(kind: ChangeKind) => void>;
};

const registries = new WeakMap<Document, Registry>();

function registryOf(document: Document) {
  let registry = registries.get(document);
  if (registry) return registry;
  registry = { items: new Set(), listeners: new Set() };
  registries.set(document, registry);
  return registry;
}

function notify(registry: Registry, kind: ChangeKind) {
  for (const listener of registry.listeners) listener(kind);
}

export function registerRepeatableItem(document: Document, target: RepeatableItemTarget) {
  const registry = registryOf(document);
  registry.items.add(target);
  notify(registry, "content");
  return {
    update(state: RepeatableItemState) {
      if (
        target.hovered === state.hovered &&
        target.focused === state.focused &&
        target.hoverGroup === state.hoverGroup &&
        target.synced === state.synced
      ) {
        return;
      }
      Object.assign(target, state);
      notify(registry, "state");
    },
    unregister() {
      registry.items.delete(target);
      notify(registry, "content");
    },
  };
}

/** Membership changes move geometry; state changes never do. */
export function subscribeRepeatableItems(
  document: Document,
  listener: (kind: ChangeKind) => void,
): () => void {
  const { listeners } = registryOf(document);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fragmentsOf(element: Element): ReadonlySet<FragmentInstance> | undefined {
  // React 19.3 records each Fragment ref owning a first-level host child.
  return (element as Element & { reactFragments?: Set<FragmentInstance> }).reactFragments;
}

/** Each registered item with its first-level elements, in document order. */
export function repeatableItemElements(document: Document) {
  const result = new Map<RepeatableItemTarget, Element[]>();
  const items = registries.get(document)?.items;
  if (!items?.size) return result;
  for (const item of items) result.set(item, []);
  for (const element of document.querySelectorAll("*")) {
    const fragments = fragmentsOf(element);
    if (!fragments) continue;
    for (const item of items) {
      if (fragments.has(item.fragment)) result.get(item)!.push(element);
    }
  }
  return result;
}
