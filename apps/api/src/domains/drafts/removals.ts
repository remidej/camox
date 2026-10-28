import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  layouts,
  locales,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import { type Field, fieldsOf, itemSchemas } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import { type ContentFinding, NO_PLACE } from "./content-checks";
import * as overlay from "./overlay";
import { draftOf, type DraftScope, inLocale, type ReadScope } from "./scope";

// What a draft's code removes while Live content uses it (ADR 0021): a block, layout or
// collection definition, or a field. Content outlives its definitions (ADR 0007), so it's a
// warning, never a blocker, but no developer meant the removal, so a member should notice it.
// Only a draft with code holds definitions of its own that can differ from Live's.
//
// Live content is what Live holds and the draft keeps: content the draft deletes won't be on
// Live once it publishes, and content it adds isn't Live's. Each piece of content is named once,
// in the first locale it's found in.

type Scope = NonNullable<DraftScope>;

export const REMOVAL_PROBLEM_CODES = ["removedInUse"] as const;

/** Live content using something the draft's code removes. */
export type RemovalFinding = Omit<ContentFinding, "code"> & {
  code: (typeof REMOVAL_PROBLEM_CODES)[number];
};

type ItemRow = typeof repeatableItems.$inferSelect;

/** A content table's rows in the project, as a scope reads them. */
const rowsIn = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: ReadScope,
  projectId: number,
  table: T,
) => overlay.select(ctx.db, scope, table, overlay.registrationOf(table).inProject(projectId));

/** Live content the draft keeps in a locale: what it reads in a table that Live has too. */
const liveContentIn = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: Scope,
  tag: string,
  table: T,
) =>
  Effect.gen(function* () {
    const live = new Set(
      (yield* rowsIn(ctx, inLocale(null, tag), scope.projectId, table)).map((row) => row.id),
    );
    const kept = yield* rowsIn(ctx, inLocale(scope, tag), scope.projectId, table);
    return kept.filter((row) => live.has(row.id));
  });

/** A definition table's rows, as Live and as the draft read them, by name. */
const definitionsOf = <
  T extends typeof blockDefinitions | typeof layouts | typeof collectionDefinitions,
>(
  ctx: ServiceContext,
  scope: Scope,
  table: T,
  nameOf: (row: T["$inferSelect"]) => string,
) =>
  Effect.gen(function* () {
    const read = (definitions: DraftScope) =>
      Effect.promise(
        () =>
          ctx.db
            .select()
            .from(table as typeof blockDefinitions)
            .where(
              and(eq(table.projectId, scope.projectId), definitionsIn(table, definitions)),
            ) as unknown as Promise<T["$inferSelect"][]>,
      );
    const byName = (rows: T["$inferSelect"][]) => new Map(rows.map((row) => [nameOf(row), row]));
    return { live: byName(yield* read(null)), draft: byName(yield* read(scope)) };
  });

/** Whether content holds a value: anything but nothing, an empty string or an empty list. */
const holdsValue = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  value !== "" &&
  !(Array.isArray(value) && value.length === 0);

/** The fields of Live's schema that the draft's lacks. */
const removedFields = (live: unknown, draft: unknown): Field[] => {
  const kept = new Set(fieldsOf(draft).map((field) => field.name));
  return fieldsOf(live).filter((field) => !kept.has(field.name));
};

/** Warnings about what the draft's code removes while Live content uses it. */
export const checkRemovals = Effect.fn("drafts.checkRemovals")(function* (
  ctx: ServiceContext,
  draft: Scope,
) {
  const scope = draftOf(draft);
  const { projectId } = scope;
  const blockDefs = yield* definitionsOf(ctx, scope, blockDefinitions, (row) => row.blockId);
  const layoutDefs = yield* definitionsOf(ctx, scope, layouts, (row) => row.layoutId);
  const collectionDefs = yield* definitionsOf(
    ctx,
    scope,
    collectionDefinitions,
    (row) => row.collectionId,
  );
  // A regular draft without code reads Live's definitions, and removes nothing.
  const readsLive = ({
    live,
    draft,
  }: {
    live: Map<string, { rowId: number }>;
    draft: typeof live;
  }) => [...live].every(([name, row]) => draft.get(name)?.rowId === row.rowId);
  if ([blockDefs, layoutDefs, collectionDefs].every(readsLive)) return [];

  const found = new Map<string, RemovalFinding>();
  const add = (finding: Omit<RemovalFinding, "code">) => {
    const key = JSON.stringify([finding.entity, finding.id, finding.field]);
    if (!found.has(key)) found.set(key, { ...finding, code: "removedInUse" });
  };

  /**
   * Fields of a holder's Live schemas that its draft schemas lack, and that it holds a value
   * for: in its content or settings, or as items under a removed repeater.
   */
  const checkFields = (
    holder: Pick<RemovalFinding, "entity" | "id" | "locale" | "blockId">,
    stored: { content: unknown; settings?: unknown },
    schemas: { live: unknown; draft: unknown; liveSettings?: unknown; draftSettings?: unknown },
    hasItems: (field: string) => boolean,
    what: string,
  ) => {
    const valueOf = (from: unknown, field: Field) =>
      field.kind === "Repeater"
        ? hasItems(field.name)
        : holdsValue((from as Record<string, unknown> | null)?.[field.name]);
    const removed = [
      ...removedFields(schemas.live, schemas.draft).filter((f) => valueOf(stored.content, f)),
      ...removedFields(schemas.liveSettings, schemas.draftSettings).filter((f) =>
        valueOf(stored.settings, f),
      ),
    ];
    for (const field of removed) {
      add({
        ...holder,
        field: field.name,
        fieldKind: field.kind,
        message: `This draft's code removes the "${field.title}" field from ${what}, which holds a value for it here`,
      });
    }
  };

  /** A block's or shared content's fields and its items', against both of its definitions. */
  const checkTree = (
    holder: Pick<RemovalFinding, "entity" | "id" | "locale" | "blockId">,
    stored: { content: unknown; settings: unknown },
    definitions: {
      live: typeof blockDefinitions.$inferSelect;
      draft: typeof blockDefinitions.$inferSelect;
    },
    tree: ItemRow[],
  ) => {
    const what = `the "${definitions.live.title}" block`;
    const under = (parent: string | null) => (field: string) =>
      tree.some((item) => item.parentItemId === parent && item.fieldName === field);
    checkFields(
      holder,
      stored,
      {
        live: definitions.live.contentSchema,
        draft: definitions.draft.contentSchema,
        liveSettings: definitions.live.settingsSchema,
        draftSettings: definitions.draft.settingsSchema,
      },
      under(null),
      what,
    );
    const live = itemSchemas(definitions.live.contentSchema, tree);
    const kept = itemSchemas(definitions.draft.contentSchema, tree);
    for (const item of tree) {
      const liveSchemas = live.get(item.id);
      const draftSchemas = kept.get(item.id);
      // An item under a removed repeater is named by the repeater, on its holder.
      if (!liveSchemas || !draftSchemas) continue;
      checkFields(
        { entity: "repeatableItem", id: item.id, locale: holder.locale, blockId: item.blockId },
        item,
        {
          live: liveSchemas.content,
          draft: draftSchemas.content,
          liveSettings: liveSchemas.settings,
          draftSettings: draftSchemas.settings,
        },
        under(item.id),
        what,
      );
    }
  };

  for (const { tag } of yield* rowsIn(ctx, scope, projectId, locales)) {
    const visiblePages = new Set(
      (yield* rowsIn(ctx, inLocale(scope, tag), projectId, pages)).map((page) => page.id),
    );
    const items = yield* liveContentIn(ctx, scope, tag, repeatableItems);
    const treeOf = (root: (item: ItemRow) => boolean) => items.filter(root);

    for (const page of yield* liveContentIn(ctx, scope, tag, pages)) {
      if (layoutDefs.draft.has(page.layoutId)) continue;
      const layout = layoutDefs.live.get(page.layoutId);
      if (!layout) continue;
      add({
        entity: "page",
        id: page.id,
        locale: tag,
        field: "",
        ...NO_PLACE,
        message: `This draft's code removes the "${layout.title ?? layout.layoutId}" layout, which this page uses`,
      });
    }

    for (const block of yield* liveContentIn(ctx, scope, tag, blocks)) {
      if (block.pageId !== null && !visiblePages.has(block.pageId)) continue;
      const live = blockDefs.live.get(block.type);
      if (!live) continue;
      const holder = { entity: "block" as const, id: block.id, locale: tag, blockId: block.id };
      const kept = blockDefs.draft.get(block.type);
      if (!kept) {
        add({
          ...holder,
          field: "",
          fieldKind: null,
          message: `This draft's code removes the "${live.title}" block, which this content uses`,
        });
        continue;
      }
      // A synced block's placements hold their content in its shared content.
      if (live.synced) continue;
      checkTree(
        holder,
        block,
        { live, draft: kept },
        treeOf((item) => item.blockId === block.id),
      );
    }

    for (const shared of yield* liveContentIn(ctx, scope, tag, sharedContents)) {
      const live = blockDefs.live.get(shared.type);
      const kept = blockDefs.draft.get(shared.type);
      // Its placements name a removed synced block.
      if (!live || !kept) continue;
      checkTree(
        { entity: "sharedContent", id: shared.id, locale: tag, blockId: null },
        shared,
        { live, draft: kept },
        treeOf((item) => item.sharedContentType === shared.type),
      );
    }

    for (const record of yield* liveContentIn(ctx, scope, tag, collectionRecords)) {
      const live = collectionDefs.live.get(record.collectionId);
      if (!live) continue;
      const holder = { entity: "record" as const, id: record.id, locale: tag, blockId: null };
      const kept = collectionDefs.draft.get(record.collectionId);
      if (!kept) {
        add({
          ...holder,
          field: "",
          fieldKind: null,
          message: `This draft's code removes the "${live.title}" collection, which holds this record`,
        });
        continue;
      }
      checkFields(
        holder,
        record,
        { live: live.contentSchema, draft: kept.contentSchema },
        () => false,
        `the "${live.title}" collection`,
      );
    }
  }
  return [...found.values()];
});
