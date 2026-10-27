import { Effect } from "effect";

import type {
  DraftOverviewRequest,
  OverviewChange,
  OverviewLocaleEdits,
  OverviewPlace,
} from "../../lib/ai-model";
import type { ServiceContext } from "../_shared/service-context";
import { differingFields, fieldValuesOf } from "./field-values";
import type * as overlay from "./overlay";
import type { Change } from "./publish";
import type { DraftScope } from "./scope";

// What the model reads to write a Draft Overview: the draft's changes as its review lists them,
// described field by field in the default locale, so its bullets say what actually changed.

type Scope = NonNullable<DraftScope>;

/**
 * How long the described changes may get, as JSON, before they're grouped by place instead:
 * enough for a few dozen changes, field by field.
 */
export const MAX_INPUT_LENGTH = 20_000;

/** How many values describe a created entity: its main ones, enough to tell what it is. */
export const CREATED_VALUES = 3;

/** Where a change sits, as the model reads it: its page's name and path, or what else holds it. */
function placeName(change: Change): string {
  const { owner, entity } = change;
  if (entity === "locale") return "Languages";
  if (!owner) return entity === "file" ? "Files" : "Elsewhere";
  if (owner.kind === "layout") return `Layout ${owner.name}`;
  if (owner.kind === "syncedBlock") return `Synced block ${owner.title}`;
  if (owner.kind === "collection") return `Collection ${owner.title}`;
  return owner.nickname ? `${owner.nickname} (${owner.path})` : owner.path;
}

const isEntity = (change: Change): change is Change & { entity: overlay.EntityKind } =>
  change.entity !== "code";

type PathRename = { change: OverviewChange; before: string; after: string; follows: boolean };

/**
 * Leaves out pages whose only change is a path following an ancestor's rename, counting them
 * under the ancestor: renaming a page rewrites every path under it.
 */
function describeRenamesOnce(changes: OverviewChange[], pages: Map<OverviewChange, PathRename>) {
  const renames = [...pages.values()];
  const under = (page: PathRename, ancestor: PathRename) => {
    if (ancestor === page) return false;
    const prefix = `${ancestor.before.replace(/\/$/, "")}/`;
    return (
      page.before.startsWith(prefix) &&
      page.after === `${ancestor.after.replace(/\/$/, "")}/${page.before.slice(prefix.length)}`
    );
  };
  for (const page of renames) {
    const onlyPath = page.change.fields?.length === 1;
    page.follows = onlyPath && renames.some((ancestor) => under(page, ancestor));
  }
  const left: OverviewChange[] = [];
  for (const change of changes) {
    const page = pages.get(change);
    if (page?.follows) {
      const top = renames.find((ancestor) => !ancestor.follows && under(page, ancestor));
      if (top) top.change.pagesUnder = (top.change.pagesUnder ?? 0) + 1;
      continue;
    }
    left.push(change);
  }
  return left;
}

/** The draft's changes in the default locale, one by one, field by field. */
const describeChanges = Effect.fn("drafts.describeOverviewChanges")(function* (
  ctx: ServiceContext,
  scope: Scope,
  changes: readonly Change[],
) {
  const valuesOf = yield* fieldValuesOf(ctx, scope, changes.filter(isEntity));
  const described: OverviewChange[] = [];
  const pages = new Map<OverviewChange, PathRename>();
  for (const change of changes) {
    const base = { place: placeName(change), label: change.label };
    if (change.change === "deleted" || !isEntity(change)) {
      described.push({ ...base, change: change.change });
      continue;
    }
    const values = valuesOf(change.entity, change.id);
    if (change.change === "created") {
      const held = (values.draft ?? [])
        .filter(({ value }) => value !== "")
        .slice(0, CREATED_VALUES);
      described.push({ ...base, change: "created", ...(held.length > 0 && { values: held }) });
      continue;
    }
    const fields = differingFields(values).map(({ field, live, draft }) => ({
      field,
      before: live,
      after: draft,
    }));
    if (fields.length === 0) {
      described.push({ ...base, change: values.moved ? "moved" : "changed" });
      continue;
    }
    const edited: OverviewChange = { ...base, change: "changed", fields };
    described.push(edited);
    const path = change.entity === "page" && fields.find(({ field }) => field === "Path");
    if (path) {
      pages.set(edited, { change: edited, before: path.before, after: path.after, follows: false });
    }
  }
  return describeRenamesOnce(described, pages);
});

/** The draft's changes counted by place and kind, for a draft with too many to list. */
function groupedByPlace(changes: readonly OverviewChange[]): OverviewPlace[] {
  const places = new Map<string, OverviewPlace>();
  for (const { place, change, pagesUnder } of changes) {
    let counts = places.get(place);
    if (!counts) {
      counts = { place, created: 0, changed: 0, deleted: 0, moved: 0 };
      places.set(place, counts);
    }
    counts[change] += 1 + (pagesUnder ?? 0);
  }
  return [...places.values()];
}

/** Hand edits in other locales, counted per locale with the places they're in. */
function localeEditsOf(changes: readonly Change[]): OverviewLocaleEdits[] {
  const byLocale = new Map<string, OverviewLocaleEdits>();
  for (const change of changes) {
    const locale = change.locale!;
    let edits = byLocale.get(locale);
    if (!edits) {
      edits = { locale, edits: 0, places: [] };
      byLocale.set(locale, edits);
    }
    edits.edits += 1;
    const place = placeName(change);
    if (!edits.places.includes(place)) edits.places.push(place);
  }
  return [...byLocale.values()];
}

const fits = (request: DraftOverviewRequest) => JSON.stringify(request).length <= MAX_INPUT_LENGTH;

/** The first `kept` places, then the others counted together, as one place. */
function keepPlaces(places: OverviewPlace[], kept: number): OverviewPlace[] {
  if (places.length <= kept + 1) return places;
  const others = places.slice(kept);
  const rest: OverviewPlace = {
    place: `${others.length} other places`,
    created: 0,
    changed: 0,
    deleted: 0,
    moved: 0,
  };
  for (const place of others) {
    for (const change of ["created", "changed", "deleted", "moved"] as const) {
      rest[change] += place[change];
    }
  }
  return [...places.slice(0, kept), rest];
}

/** Each locale's edits in their first `kept` places, saying how many others there are. */
function keepLocalePlaces(localeEdits: OverviewLocaleEdits[], kept: number) {
  return localeEdits.map((edits) =>
    edits.places.length <= kept + 1
      ? edits
      : {
          ...edits,
          places: [...edits.places.slice(0, kept), `${edits.places.length - kept} other places`],
        },
  );
}

/**
 * The request keeping the most places per list (`requestKeeping(kept)`, up to `most`) that fits
 * the size cap, or null when it doesn't fit even keeping none.
 */
function fitted(requestKeeping: (kept: number) => DraftOverviewRequest, most: number) {
  if (fits(requestKeeping(most))) return requestKeeping(most);
  if (!fits(requestKeeping(0))) return null;
  let fitting = 0;
  let tooMany = most;
  while (tooMany - fitting > 1) {
    const kept = Math.floor((fitting + tooMany) / 2);
    if (fits(requestKeeping(kept))) fitting = kept;
    else tooMany = kept;
  }
  return requestKeeping(fitting);
}

/**
 * What the model reads to write a draft's overview, from the changes its preview lists (which
 * leave out the localizations Camox wrote): the default locale's changes field by field, before
 * and after; created entities by their main values, deleted ones by their label; a block that
 * only moved as moved; a path rename once. Hand edits in other locales are counted per locale.
 * The whole input is capped at `MAX_INPUT_LENGTH`: past it, the changes are grouped by place,
 * with counts, and lists of places keep their first ones, counting the others.
 */
export const overviewInput = Effect.fn("drafts.overviewInput")(function* (
  ctx: ServiceContext,
  scope: Scope,
  draftName: string | null,
  changes: readonly Change[],
  defaultLocale: string | null,
) {
  const inDefault = (change: Change) =>
    change.locale === null || defaultLocale === null || change.locale === defaultLocale;
  const described = yield* describeChanges(ctx, scope, changes.filter(inDefault));
  const localeEdits = localeEditsOf(changes.filter((change) => !inDefault(change)));
  const localePlaces = Math.max(0, ...localeEdits.map((edits) => edits.places.length));
  const listed = fitted(
    (kept) => ({
      draftName,
      changes: described,
      localeEdits: keepLocalePlaces(localeEdits, kept),
    }),
    localePlaces,
  );
  if (listed) return listed;
  const places = groupedByPlace(described);
  const grouped = (kept: number): DraftOverviewRequest => ({
    draftName,
    places: keepPlaces(places, kept),
    localeEdits: keepLocalePlaces(localeEdits, kept),
  });
  return fitted(grouped, Math.max(places.length, localePlaces)) ?? grouped(0);
});
