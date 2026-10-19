import { and, eq, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";

import type { Database } from "../../db";
import { blocks, repeatableItems } from "../../schema";
import * as overlay from "../drafts/overlay";
import { blocksOfOwner } from "../layouts/identity";
import { itemsUnder, rootOfItem } from "../repeatable-items/roots";
import { type Bookkeeping, readBookkeepings, writeBookkeeping } from "./bookkeeping";
import type { Merged } from "./merge";
import type { TranslationScope } from "./scope";

// The order of a localized block among its page's or layout's blocks, or of a localized item
// among its repeater's items, merges three ways like its other values, but as a whole: a
// position only means something next to its siblings'. Orders are compared as orders of ids,
// never as positions, since rewriting a repeater gives every item a new position though its
// order stays.
//
// - A locale whose siblings are still in the order Camox last gave them (by the positions their
//   bookkeeping says Camox wrote) follows the source's order.
// - A locale that reordered them keeps its order; a sibling new to it lands after the sibling
//   the source has before it.
//
// Either way, a sibling only the locale has stays after the sibling it follows in the locale.
// Siblings keep their positions wherever the merged order allows, so a job rewrites as few as it
// can; where it rewrites a sibling following the source, it records the position in the
// sibling's bookkeeping, so the locale still counts as not having reordered.

type Ordered = { id: string; position: string };
type Row = Record<string, unknown> & Ordered;

export type OrderedEntity = "block" | "repeatableItem";

export const isOrderedEntity = (entity: string): entity is OrderedEntity =>
  entity === "block" || entity === "repeatableItem";

/** The rows sharing an entity's siblings with `row`, and whether a row is one of them. */
function siblingsOf(entity: OrderedEntity, row: Record<string, unknown>) {
  if (entity === "block") {
    const owner = blocksOfOwner(row as typeof blocks.$inferSelect);
    return owner && { table: blocks, where: owner, matches: () => true };
  }
  const item = row as typeof repeatableItems.$inferSelect;
  return {
    table: repeatableItems,
    where: and(itemsUnder(rootOfItem(item)), eq(repeatableItems.fieldName, item.fieldName))!,
    matches: (other: Row) => other.parentItemId === item.parentItemId,
  };
}

const select = (
  db: Database,
  scope: Parameters<typeof overlay.select>[1],
  siblings: { table: typeof blocks | typeof repeatableItems; where: SQL },
) => overlay.select(db, scope, siblings.table, siblings.where) as Effect.Effect<Row[]>;

const positionIn = (values: Record<string, unknown> | undefined) =>
  typeof values?.position === "string" ? values.position : undefined;

/** Whether `ids`, in the order a locale has them, are no longer in the order Camox gave them. */
function reordered(ids: readonly string[], written: ReadonlyMap<string, string>) {
  const known = ids.filter((id) => written.has(id));
  const byWritten = known
    .map((id) => ({ id, position: written.get(id)! }))
    .sort(overlay.compareByPosition)
    .map(({ id }) => id);
  return known.some((id, index) => byWritten[index] !== id);
}

/**
 * Positions for `ids` in this order, keeping every position it can from `positions`: the
 * longest run already in order keeps its own, the rest get positions between them.
 */
function positionsFor(ids: readonly string[], positions: ReadonlyMap<string, string>) {
  const at = (index: number): Ordered | undefined => {
    const position = positions.get(ids[index]!);
    return position === undefined ? undefined : { id: ids[index]!, position };
  };
  // Longest strictly increasing run of positions, in the order of `ids`.
  const lengths: number[] = [];
  const previous: number[] = [];
  let end = -1;
  for (let index = 0; index < ids.length; index++) {
    lengths[index] = 0;
    previous[index] = -1;
    const here = at(index);
    if (!here) continue;
    lengths[index] = 1;
    for (let before = 0; before < index; before++) {
      const there = at(before);
      if (!there || overlay.compareByPosition(there, here) >= 0) continue;
      if (lengths[before]! + 1 > lengths[index]!) {
        lengths[index] = lengths[before]! + 1;
        previous[index] = before;
      }
    }
    if (end === -1 || lengths[index]! > lengths[end]!) end = index;
  }
  const kept = new Set<number>();
  for (let index = end; index !== -1; index = previous[index]!) kept.add(index);

  const result = new Map<string, string>();
  let lower: string | null = null;
  let pending: string[] = [];
  const place = (upper: string | null) => {
    // Kept positions can be equal, ordered by id: no position fits between them.
    if (pending.length > 0 && lower !== null && upper !== null && lower >= upper) return false;
    const keys = generateNKeysBetween(lower, upper, pending.length);
    pending.forEach((id, index) => result.set(id, keys[index]!));
    pending = [];
    return true;
  };
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!;
    if (!kept.has(index)) {
      pending.push(id);
      continue;
    }
    const position = positions.get(id)!;
    if (!place(position)) {
      const keys = generateNKeysBetween(null, null, ids.length);
      return new Map(ids.map((every, at) => [every, keys[at]!]));
    }
    result.set(id, position);
    lower = position;
  }
  place(null);
  return result;
}

/**
 * Gives a merged block or item localization its position among its siblings in the locale, by
 * the three-way merge of their order, and repositions the siblings the merged order moves.
 */
export const placeLocalizedSibling = Effect.fn("translation.placeLocalizedSibling")(function* (
  db: Database,
  scope: TranslationScope,
  entity: OrderedEntity,
  source: Record<string, unknown> & { id: string },
  current: Record<string, unknown> | undefined,
  bookkeeping: Bookkeeping | undefined,
  merged: Merged,
) {
  const inSource = siblingsOf(entity, source);
  const inTarget = siblingsOf(entity, merged.values);
  if (!inSource || !inTarget) return;
  const theirs = overlay
    .sortByPosition((yield* select(db, scope.draft, inSource)).filter(inSource.matches))
    .map(({ id }) => id);
  const fromSource = new Set(theirs);
  const others = (yield* select(db, scope.target, inTarget)).filter(
    (row) => inTarget.matches(row) && row.id !== source.id,
  );
  const ownPosition = current && inTarget.matches(current as Row) ? positionIn(current) : undefined;
  const positions = new Map(others.map((row) => [row.id, row.position]));
  if (ownPosition !== undefined) positions.set(source.id, ownPosition);
  const ours = overlay
    .sortByPosition([...positions].map(([id, position]) => ({ id, position })))
    .map(({ id }) => id);

  // The positions Camox last wrote for the siblings both have.
  const shared = ours.filter((id) => fromSource.has(id));
  const bookkeepings = yield* readBookkeepings(
    db,
    scope.target,
    entity,
    shared.filter((id) => id !== source.id),
  );
  if (bookkeeping) bookkeepings.set(source.id, bookkeeping);
  const written = new Map(
    shared.flatMap((id) => {
      const position = positionIn(bookkeepings.get(id)?.output);
      return position === undefined ? [] : [[id, position] as const];
    }),
  );
  const follows = !reordered(shared, written);

  let order: string[];
  if (follows) {
    // Siblings only the locale has, after the shared sibling before them in the locale.
    const after = new Map<string | null, string[]>();
    let anchor: string | null = null;
    for (const id of ours) {
      if (fromSource.has(id)) anchor = id;
      else after.set(anchor, [...(after.get(anchor) ?? []), id]);
    }
    order = [...(after.get(null) ?? [])];
    for (const id of theirs) {
      if (id !== source.id && !positions.has(id)) continue;
      order.push(id, ...(after.get(id) ?? []));
    }
  } else {
    order = [...ours];
    if (!order.includes(source.id)) {
      const before = theirs.slice(0, theirs.indexOf(source.id)).findLast((id) => positions.has(id));
      order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, source.id);
    }
  }

  const placed = positionsFor(order, positions);
  for (const row of others) {
    const position = placed.get(row.id)!;
    if (position !== row.position) {
      yield* overlay.update(db, scope.target, inTarget.table, row.id, { position });
    }
    const kept = bookkeepings.get(row.id);
    if (follows && kept && positionIn(kept.output) !== position) {
      yield* writeBookkeeping(db, scope.target, entity, row.id, {
        source: kept.source,
        output: { ...kept.output, position },
      });
    }
  }
  const position = placed.get(source.id)!;
  merged.values.position = position;
  merged.output.position = follows ? position : (positionIn(bookkeeping?.output) ?? position);
});
