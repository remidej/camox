import type { Touch, TouchedBatch } from "@camox/api-contract/threads";

import type { NavigateOptions, NavigationSource } from "../navigation/navigation";
import { previewStore, sameEditingOwner, type EditingOwner } from "../preview/previewStore";

/**
 * How long following stays on a page it went to before it leaves for another one, in
 * milliseconds. A product tuning value: long enough to see each destination, short enough to
 * keep up with the agent.
 */
export const FOLLOW_MINIMUM_STAY = 2000;

/** A Page of the Canvas, as following locates the agent's writes on it. */
export interface FollowPage {
  /** Its Canvas item key. */
  key: string;
  /** Where selecting it navigates, in the viewed Locale; null for a derived page without one. */
  pathname: string | null;
  /** What its editing frame edits: the page row, or a layout page's layout. */
  owner: EditingOwner;
  /** The Layout it belongs to. */
  layoutId: string;
  /** Its blocks top to bottom, its Layout's included, once loaded. */
  blocks?: readonly { id: string; type: string }[];
}

/** Where the editor is, and the Studio content following needs to locate touches. */
export interface FollowWhere {
  /** The Canvas's Pages in Canvas order, in the viewed Locale. */
  pages: readonly FollowPage[];
  /** The viewed Locale's tag. */
  locale: string;
  /** The location, with the source of the navigation that led there. */
  location: { pathname: string; search: string; source?: NavigationSource };
  /** The key of the Page the editor is on, if any. */
  pageKey: string | null;
  /** The path of a block definition's Block Catalog item, in the viewed Locale. */
  blockCatalogPath: (blockType: string) => string;
}

/** Where a touched batch takes the editor. */
type Destination =
  | { kind: "page"; page: PageRef; blockIds: readonly string[] }
  | { kind: "catalog"; blockType: string };

/** A Page by its page row, which may not be on the Canvas yet, or by its Canvas item key. */
type PageRef = { pageId: string } | { key: string };

const pageRowId = (page: FollowPage) => (page.owner.kind === "page" ? page.owner.pageId : null);

function findPage(where: FollowWhere, ref: PageRef) {
  return where.pages.find((page) =>
    "key" in ref ? page.key === ref.key : pageRowId(page) === ref.pageId,
  );
}

const refKey = (ref: PageRef) => ("key" in ref ? `key:${ref.key}` : `page:${ref.pageId}`);

/** A touch located on a Page, with the block to select there, if any. */
type Located = { page: PageRef; blockId?: string } | { catalog: string };

function locate(where: FollowWhere, here: FollowPage | undefined, touch: Touch): Located | null {
  // A touch in another Locale counts toward its page only where the viewed Locale shows it, and
  // never selects its block: the editor sees the block's copy in their Locale, which it didn't
  // change.
  const elsewhere = !!touch.locale && touch.locale !== where.locale;
  // A deleted block's page is the destination, without it; settings name no block.
  const keptBlock = (id: string | undefined) =>
    id && !elsewhere && touch.kind !== "deleted" && touch.kind !== "settings" ? id : undefined;
  const at = (page: PageRef, blockId: string | undefined): Located => {
    const id = keptBlock(blockId);
    return { page, ...(id ? { blockId: id } : {}) };
  };
  if (touch.entity === "page") {
    const shown = where.pages.some((page) => pageRowId(page) === touch.pageId);
    if (elsewhere && !shown) return null;
    return at({ pageId: touch.pageId }, touch.blockId);
  }
  if (touch.entity === "layout") {
    const page =
      here?.layoutId === touch.layoutId
        ? here
        : where.pages.find(
            (candidate) => candidate.layoutId === touch.layoutId && candidate.pathname,
          );
    return page ? at({ key: page.key }, touch.blockId) : null;
  }
  // A Synced Block's shared content: where the editor sees one of its Placements, or its item
  // in the Block Catalog.
  const placement = here?.blocks?.find((block) => block.type === touch.blockType);
  if (here && placement) return at({ key: here.key }, placement.id);
  return elsewhere ? null : { catalog: touch.blockType };
}

function destinationOf(where: FollowWhere, batch: TouchedBatch): Destination | null {
  const here = where.pageKey ? where.pages.find((page) => page.key === where.pageKey) : undefined;
  // A deleted page gives no destination, and nothing else on it does either.
  const deletedPages = new Set(
    batch.touches.flatMap((touch) =>
      touch.entity === "page" && touch.kind === "deleted" && !touch.blockId ? [touch.pageId] : [],
    ),
  );
  const located = batch.touches
    .filter((touch) => !(touch.entity === "page" && deletedPages.has(touch.pageId)))
    .flatMap((touch) => {
      const at = locate(where, here, touch);
      return at ? [at] : [];
    });
  // Each touched Page, keyed by one identity whatever named it, with its touches in write order.
  const touched = new Map<string, { ref: PageRef; blockIds: string[]; count: number }>();
  const identity = (ref: PageRef) => {
    const page = findPage(where, ref);
    return page ? `key:${page.key}` : refKey(ref);
  };
  for (const at of located) {
    if ("catalog" in at) continue;
    const key = identity(at.page);
    const entry = touched.get(key) ?? { ref: at.page, blockIds: [], count: 0 };
    entry.count += 1;
    if (at.blockId && !entry.blockIds.includes(at.blockId)) entry.blockIds.push(at.blockId);
    touched.set(key, entry);
  }
  if (touched.size === 0) {
    const catalog = located.find((at) => "catalog" in at);
    return catalog && "catalog" in catalog ? { kind: "catalog", blockType: catalog.catalog } : null;
  }
  const order = (ref: PageRef) => {
    const page = findPage(where, ref);
    return page ? where.pages.indexOf(page) : where.pages.length;
  };
  const entries = [...touched.values()];
  const chosen =
    (here && touched.get(`key:${here.key}`)) ??
    entries.reduce((best, entry) =>
      entry.count > best.count || (entry.count === best.count && order(entry.ref) < order(best.ref))
        ? entry
        : best,
    );
  return { kind: "page", page: chosen.ref, blockIds: chosen.blockIds };
}

/** The topmost of the touched blocks by its order on the page; ones not shown yet come last. */
function topmostBlock(page: FollowPage, blockIds: readonly string[]) {
  const position = (id: string) => {
    const index = page.blocks?.findIndex((block) => block.id === id) ?? -1;
    return index === -1 ? Infinity : index;
  };
  return [...blockIds].sort((a, b) => position(a) - position(b))[0];
}

export interface FollowAgent {
  /** Follows what a script of a run this Studio follows touched. */
  receive(batch: TouchedBatch): void;
  /** Where the editor is now, after a navigation or a content change. */
  update(where: FollowWhere): void;
  /**
   * The editor panned, zoomed or selected something: following stops for the rest of the run,
   * dropping any destination it was heading to.
   */
  takeOver(): void;
  /** The editor's next message starts a run: following starts again. */
  resume(): void;
  dispose(): void;
}

export interface FollowClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: FollowClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Following the agent on the Canvas or in the Preview: each touched batch gives at most one
 * destination, which the Studio goes to through the existing selection. Pages are selected
 * through the URL, replacing the history entry, and blocks through the preview store once the
 * destination page's editing frame is active.
 */
export function createFollowAgent({
  navigate,
  where: initial,
  clock = systemClock,
}: {
  navigate: (options: NavigateOptions) => unknown;
  where: FollowWhere;
  clock?: FollowClock;
}): FollowAgent {
  let where = initial;
  let following = true;
  /** When following last arrived on another page; it stays there for the minimum stay. */
  let arrivedAt = -Infinity;
  /** The latest destination on another page, waiting for the minimum stay or for its page. */
  let pending: Destination | null = null;
  let timer: unknown = null;
  /** Blocks to select once their page's editing frame is active. */
  let pendingBlocks: { page: PageRef; blockIds: readonly string[] } | null = null;
  /** The block following last selected, to move to a topmost one that shows later. */
  let selected: { page: PageRef; blockIds: readonly string[]; blockId: string } | null = null;

  /** The block following selected last, whichever page it's on, to tell the editor's apart. */
  let ownSelection: { owner: EditingOwner; blockId: string } | null = null;
  const sendFocusedBlock = (owner: EditingOwner, blockId: string) => {
    ownSelection = { owner, blockId };
    previewStore.send({ type: "setFocusedBlock", ...owner, blockId });
  };

  const here = () =>
    where.pageKey ? where.pages.find((page) => page.key === where.pageKey) : undefined;

  const selectPendingBlocks = () => {
    if (!pendingBlocks) return;
    const page = findPage(where, pendingBlocks.page);
    if (!page) return;
    const { editingContext } = previewStore.getSnapshot().context;
    if (!sameEditingOwner(editingContext, page.owner)) return;
    const blockId = topmostBlock(page, pendingBlocks.blockIds);
    const { page: ref, blockIds } = pendingBlocks;
    pendingBlocks = null;
    if (!blockId) return;
    selected = { page: ref, blockIds, blockId };
    sendFocusedBlock(page.owner, blockId);
  };

  /** Reselects when a touched block above the selected one shows, while the selection is ours. */
  const reselectTopmost = () => {
    if (!selected) return;
    const page = findPage(where, selected.page);
    const selection = previewStore.getSnapshot().context.editingContext?.selection;
    if (!page || selection?.type !== "block" || selection.blockId !== selected.blockId) {
      selected = null;
      return;
    }
    const blockId = topmostBlock(page, selected.blockIds);
    if (!blockId || blockId === selected.blockId) return;
    selected = { ...selected, blockId };
    sendFocusedBlock(page.owner, blockId);
  };

  const clearTimer = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  /** Goes to the pending destination, once the minimum stay is over and its page is known. */
  const goToPending = () => {
    if (!pending) return;
    const wait = arrivedAt + FOLLOW_MINIMUM_STAY - clock.now();
    if (wait > 0) {
      if (timer === null) {
        timer = clock.setTimeout(() => {
          timer = null;
          goToPending();
        }, wait);
      }
      return;
    }
    let pathname: string | null | undefined;
    if (pending.kind === "catalog") pathname = where.blockCatalogPath(pending.blockType);
    else pathname = findPage(where, pending.page)?.pathname;
    // A page the agent just created shows once the page list refreshes.
    if (!pathname) return;
    const destination = pending;
    pending = null;
    arrivedAt = clock.now();
    pendingBlocks =
      destination.kind === "page" && destination.blockIds.length
        ? { page: destination.page, blockIds: destination.blockIds }
        : null;
    selected = null;
    void navigate({ to: `${pathname}${where.location.search}`, replace: true, source: "follow" });
  };

  /**
   * Whether the editor selected something themselves: a selection following didn't make.
   * Clearing it isn't one, as frames do when the Canvas mounts or a navigation releases them.
   */
  const editorSelected = () => {
    const { editingContext } = previewStore.getSnapshot().context;
    const selection = editingContext?.selection;
    if (!selection) return false;
    return !(
      ownSelection &&
      selection.type === "block" &&
      selection.blockId === ownSelection.blockId &&
      sameEditingOwner(editingContext, ownSelection.owner)
    );
  };

  let lastSelection = previewStore.getSnapshot().context.editingContext?.selection ?? null;
  const subscription = previewStore.subscribe(({ context }) => {
    const selection = context.editingContext?.selection ?? null;
    const changed = selection !== lastSelection;
    lastSelection = selection;
    if (changed && editorSelected()) {
      follow.takeOver();
      return;
    }
    selectPendingBlocks();
  });

  const follow: FollowAgent = {
    receive(batch) {
      if (!following) return;
      const destination = destinationOf(where, batch);
      if (!destination) return;
      const current = here();
      const onThisPage =
        destination.kind === "page" && current && findPage(where, destination.page) === current;
      if (onThisPage) {
        // The latest destination is where the editor is: only move within the page, right away.
        pending = null;
        clearTimer();
        if (!destination.blockIds.length) return;
        pendingBlocks = { page: destination.page, blockIds: destination.blockIds };
        selectPendingBlocks();
        return;
      }
      pending = destination;
      goToPending();
    },
    update(next) {
      // The editor went to another page themselves: from a link or their history. The Canvas
      // also navigates without the editor, as its camera leaves a snap; it reports the editor's
      // own selections itself.
      const navigated = next.location.pathname !== where.location.pathname;
      where = next;
      if (navigated && next.location.source === undefined) follow.takeOver();
      goToPending();
      selectPendingBlocks();
      reselectTopmost();
    },
    takeOver() {
      following = false;
      pending = null;
      pendingBlocks = null;
      selected = null;
      clearTimer();
    },
    resume() {
      following = true;
    },
    dispose() {
      clearTimer();
      subscription.unsubscribe();
    },
  };
  return follow;
}
