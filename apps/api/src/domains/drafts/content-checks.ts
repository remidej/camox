import { isQueryBacked } from "@camox/api-contract";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { pageTextLinkIds } from "../../lib/lexical-state";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import {
  conformRecordContent,
  wrongKindBlockFields,
  wrongKindRecordFields,
} from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import {
  pageValue,
  recordPageLayouts,
  recordsSharingPageValues,
} from "../collections/record-pages";
import { itemSchemas, referenceListIds } from "../collections/references";
import { pagesWithDuplicatePaths } from "../pages/duplicate-paths";
import { generatedSeoOf, seoGenerated } from "../pages/generated-seo";
import * as overlay from "./overlay";
import type { DraftScope } from "./scope";

// What publishing a draft checks about content (ADR 0009): duplicate paths, dangling references,
// values of the wrong kind and missing meta titles. Each check returns findings in what the draft changed, which
// block publishing, and the same problems already on Live, which are warnings.

type Scope = NonNullable<DraftScope>;
type RecordRow = typeof collectionRecords.$inferSelect;

export type ContentProblemCode =
  | "duplicatePath"
  | "duplicateRecordPageValue"
  | "danglingReference"
  | "danglingPageLink"
  | "wrongKindValue"
  | "missingMetaTitle"
  | "metaTitlePending";

/** An entity holding content, as previews name it. */
type ContentEntity = "page" | "block" | "sharedContent" | "repeatableItem" | "record";

/** A problem found in an entity's field. */
export type ContentFinding = {
  entity: ContentEntity;
  id: string;
  code: ContentProblemCode;
  field: string;
  message: string;
};

type Findings = { blockers: ContentFinding[]; warnings: ContentFinding[] };

type Field = { fieldType?: string; title?: string; collectionId?: unknown; [key: string]: unknown };

/** Whether the draft stores the row: it created or changed the entity. */
const storedBy = (scope: Scope, row: { draftId: string | null }) => row.draftId === scope.id;

/** A content table's rows in the project, as a scope reads them. */
const rowsIn = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: DraftScope,
  projectId: number,
  table: T,
) => overlay.select(ctx.db, scope, table, overlay.registrationOf(table).inProject(projectId));

/**
 * Pages sharing a path. A page the draft creates or moves onto a used path blocks publishing;
 * pages already sharing a path on Live are warnings.
 */
function checkDuplicatePaths(scope: Scope, rows: (typeof pages.$inferSelect)[], found: Findings) {
  for (const group of pagesWithDuplicatePaths(rows)) {
    const drafted = group.filter((page) => storedBy(scope, page));
    const list = drafted.length > 0 ? found.blockers : found.warnings;
    for (const page of drafted.length > 0 ? drafted : group) {
      list.push({
        entity: "page",
        id: page.id,
        code: "duplicatePath",
        field: "path",
        message: `Another page already uses ${page.fullPath}`,
      });
    }
  }
}

/**
 * A page the draft creates or changes with no meta title blocks publishing: manual and empty, or
 * generated with nothing generated and no job pending. While generation is pending it's a
 * warning, so a model outage never stops publishing (ADR 0009, 0012).
 */
const checkMetaTitles = Effect.fn("drafts.checkMetaTitles")(function* (
  ctx: ServiceContext,
  scope: Scope,
  rows: (typeof pages.$inferSelect)[],
  found: Findings,
) {
  const drafted = rows.filter((page) => storedBy(scope, page));
  const generated = yield* generatedSeoOf(
    ctx.db,
    scope,
    drafted.filter(seoGenerated).map((page) => page.id),
  );
  const finding = (page: { id: string }, code: ContentProblemCode, message: string) => ({
    entity: "page" as const,
    id: page.id,
    code,
    field: "metaTitle",
    message,
  });
  for (const page of drafted) {
    if (!seoGenerated(page)) {
      if (page.metaTitle?.trim()) continue;
      found.blockers.push(
        finding(
          page,
          "missingMetaTitle",
          "The page has no meta title: write one or let AI generate it",
        ),
      );
      continue;
    }
    const shown = generated.get(page.id);
    if (shown?.value?.metaTitle.trim()) continue;
    if (shown?.pending) {
      found.warnings.push(
        finding(page, "metaTitlePending", "The page's meta title is still being generated"),
      );
      continue;
    }
    found.blockers.push(
      finding(page, "missingMetaTitle", "The page has no meta title: write one or generate it"),
    );
  }
});

/**
 * Records sharing the value their record pages are found by. A record the draft creates or
 * changes onto a used value blocks publishing; records already sharing one on Live are warnings.
 */
const checkDuplicateRecordPageValues = Effect.fn("drafts.checkDuplicateRecordPageValues")(
  function* (ctx: ServiceContext, scope: Scope, records: RecordRow[], found: Findings) {
    const definitions = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(collectionDefinitions)
        .where(
          and(
            eq(collectionDefinitions.projectId, scope.projectId),
            definitionsIn(collectionDefinitions, scope),
          ),
        ),
    );
    for (const layout of yield* recordPageLayouts(ctx.db, {
      projectId: scope.projectId,
      draft: scope,
    })) {
      const definition = definitions.find(
        (d) => d.environmentId === layout.environmentId && d.collectionId === layout.collectionId,
      );
      if (!definition) continue;
      const rendered = records.filter(
        (r) => r.environmentId === layout.environmentId && r.collectionId === layout.collectionId,
      );
      const valueOf = (record: RecordRow) =>
        pageValue(conformRecordContent(definition.contentSchema, record.content), layout.field);
      for (const group of recordsSharingPageValues(rendered, valueOf)) {
        const drafted = group.filter((record) => storedBy(scope, record));
        const list = drafted.length > 0 ? found.blockers : found.warnings;
        for (const record of drafted.length > 0 ? drafted : group) {
          list.push({
            entity: "record",
            id: record.id,
            code: "duplicateRecordPageValue",
            field: layout.field,
            message: `Another record's page is also found by "${valueOf(record)}"`,
          });
        }
      }
    }
  },
);

/** Content to check against its definition: a block, shared content, item or record. */
type Holder = {
  entity: Exclude<ContentEntity, "page">;
  id: string;
  environmentId: number;
  /** Whether the draft created or changed it, rather than reading Live's. */
  changed: boolean;
  content: unknown;
  schema: unknown;
  /** The definition's whole content schema, which an item's schema is part of. */
  rootSchema: unknown;
};

function propertiesOf(schema: unknown): Record<string, Field> {
  const properties = (schema as { properties?: unknown } | null | undefined)?.properties;
  return properties && typeof properties === "object" ? (properties as Record<string, Field>) : {};
}

/**
 * The content the scope reads in a project, each with the definition it's read by. Content
 * whose definition is gone reads as nothing (ADR 0007), and content the scope drops with its
 * page isn't read: neither is checked. Synced placements hold their content elsewhere.
 */
const holdersIn = Effect.fn("drafts.holdersIn")(function* (
  ctx: ServiceContext,
  scope: Scope,
  visiblePages: Set<string>,
  records: RecordRow[],
) {
  const { projectId } = scope;
  const blockDefs = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.projectId, projectId), definitionsIn(blockDefinitions, scope)),
      ),
  );
  const collectionDefs = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, projectId),
          definitionsIn(collectionDefinitions, scope),
        ),
      ),
  );
  const blockDef = new Map(blockDefs.map((d) => [`${d.environmentId}:${d.blockId}`, d]));
  const collectionDef = new Map(
    collectionDefs.map((d) => [`${d.environmentId}:${d.collectionId}`, d]),
  );
  const holders: Holder[] = [];
  const changed = (row: { draftId: string | null }) => storedBy(scope, row);

  // Item trees are rooted in a block or in shared content, read by the root's definition.
  const roots = new Map<string, unknown>();
  for (const block of yield* rowsIn(ctx, scope, projectId, blocks)) {
    if (block.pageId !== null && !visiblePages.has(block.pageId)) continue;
    const definition = blockDef.get(`${block.environmentId}:${block.type}`);
    if (!definition) continue;
    roots.set(`block:${block.id}`, definition.contentSchema);
    if (definition.synced) continue;
    holders.push({
      entity: "block",
      id: block.id,
      environmentId: block.environmentId,
      changed: changed(block),
      content: block.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }
  for (const shared of yield* rowsIn(ctx, scope, projectId, sharedContents)) {
    const definition = blockDef.get(`${shared.environmentId}:${shared.type}`);
    if (!definition) continue;
    roots.set(`shared:${shared.environmentId}:${shared.type}`, definition.contentSchema);
    holders.push({
      entity: "sharedContent",
      id: shared.id,
      environmentId: shared.environmentId,
      changed: changed(shared),
      content: shared.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }

  const items = yield* rowsIn(ctx, scope, projectId, repeatableItems);
  const blockEnvironment = new Map(
    holders.filter((h) => h.entity === "block").map((h) => [h.id, h.environmentId]),
  );
  const trees = new Map<string, typeof items>();
  for (const item of items) {
    const root =
      item.blockId !== null
        ? `block:${item.blockId}`
        : `shared:${item.environmentId}:${item.sharedContentType}`;
    trees.set(root, [...(trees.get(root) ?? []), item]);
  }
  for (const [root, tree] of trees) {
    if (!roots.has(root)) continue;
    const schemas = itemSchemas(roots.get(root), tree);
    for (const item of tree) {
      const schema = schemas.get(item.id);
      const environmentId = item.environmentId ?? blockEnvironment.get(item.blockId ?? "");
      if (!schema || environmentId === undefined) continue;
      holders.push({
        entity: "repeatableItem",
        id: item.id,
        environmentId,
        changed: changed(item),
        content: item.content,
        schema,
        rootSchema: roots.get(root),
      });
    }
  }

  for (const record of records) {
    const definition = collectionDef.get(`${record.environmentId}:${record.collectionId}`);
    if (!definition) continue;
    holders.push({
      entity: "record",
      id: record.id,
      environmentId: record.environmentId,
      changed: changed(record),
      content: record.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }
  return holders;
});

/** What a field points at: records of a collection, or pages. */
type Pointer = { kind: "record"; collectionId: string; id: string } | { kind: "page"; id: string };

/** The records and pages a field's value points at. */
function pointersOf(field: Field, value: unknown): Pointer[] {
  const collectionId = String(field.collectionId);
  switch (field.fieldType) {
    case "Reference":
      return typeof value === "string" && value !== ""
        ? [{ kind: "record", collectionId, id: value }]
        : [];
    case "ReferenceList":
      // A query-backed list resolves records: nothing it stores points anywhere.
      if (isQueryBacked(field)) return [];
      return referenceListIds(value).map((id) => ({ kind: "record", collectionId, id }));
    case "Link": {
      const link = value as { type?: unknown; pageId?: unknown } | null | undefined;
      return link?.type === "page" && typeof link.pageId === "string" && link.pageId !== ""
        ? [{ kind: "page", id: link.pageId }]
        : [];
    }
    case "String":
      return pageTextLinkIds(value).map((id) => ({ kind: "page", id }));
    default:
      return [];
  }
}

/**
 * References, reference-list entries and page links pointing at nothing. Content the draft
 * changed blocks publishing, and so does untouched Live content pointing at what the draft
 * deletes: the draft fixes it by editing that content. Pointers Live already left dangling are
 * warnings.
 */
function checkDanglingPointers(
  holders: Holder[],
  exists: { draft: (key: string) => boolean; live: (key: string) => boolean },
  found: Findings,
) {
  for (const holder of holders) {
    const content = (holder.content ?? {}) as Record<string, unknown>;
    if (typeof content !== "object") continue;
    for (const [name, field] of Object.entries(propertiesOf(holder.schema))) {
      const missing = pointersOf(field, content[name]).filter(
        (pointer) => !exists.draft(keyOf(holder.environmentId, pointer)),
      );
      if (missing.length === 0) continue;
      const deletedByDraft = missing.some((pointer) =>
        exists.live(keyOf(holder.environmentId, pointer)),
      );
      const title = field.title ?? name;
      const what = missing[0].kind === "page" ? "a page" : "a record";
      const blocking = holder.changed || deletedByDraft;
      (blocking ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: missing[0].kind === "page" ? "danglingPageLink" : "danglingReference",
        field: name,
        message:
          !holder.changed && deletedByDraft
            ? `"${title}" points at ${what} this draft deletes: edit it in this draft`
            : `"${title}" points at ${what} that doesn't exist`,
      });
    }
  }
}

/**
 * Values of the wrong kind for their definition, which reading replaces with the default
 * (ADR 0007). In content the draft changed they block publishing; on Live they're warnings.
 */
function checkWrongKinds(holders: Holder[], found: Findings) {
  for (const holder of holders) {
    const fields =
      holder.entity === "record"
        ? wrongKindRecordFields(holder.schema, holder.content)
        : wrongKindBlockFields(holder.content, holder.schema, holder.rootSchema);
    const properties = propertiesOf(holder.schema);
    for (const field of fields) {
      const title = properties[field]?.title ?? field;
      (holder.changed ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: "wrongKindValue",
        field,
        message: `"${title}" holds a value its definition no longer accepts, which reads as its default`,
      });
    }
  }
}

function keyOf(environmentId: number, pointer: Pointer) {
  return pointer.kind === "page"
    ? `${environmentId}:page:${pointer.id}`
    : `${environmentId}:record:${pointer.collectionId}:${pointer.id}`;
}

/** Blockers and warnings about content: what the draft changed, and untouched Live content. */
export const checkContentProblems = Effect.fn("drafts.checkContentProblems")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  const found: Findings = { blockers: [], warnings: [] };
  const { projectId } = scope;
  const draftPages = yield* rowsIn(ctx, scope, projectId, pages);
  const livePages = yield* rowsIn(ctx, null, projectId, pages);
  const draftRecords = yield* rowsIn(ctx, scope, projectId, collectionRecords);
  const liveRecords = yield* rowsIn(ctx, null, projectId, collectionRecords);

  checkDuplicatePaths(scope, draftPages, found);
  yield* checkMetaTitles(ctx, scope, draftPages, found);
  yield* checkDuplicateRecordPageValues(ctx, scope, draftRecords, found);

  const keys = (pageRows: typeof draftPages, recordRows: RecordRow[]) =>
    new Set([
      ...pageRows.map((page) => `${page.environmentId}:page:${page.id}`),
      ...recordRows.map((r) => `${r.environmentId}:record:${r.collectionId}:${r.id}`),
    ]);
  const inDraft = keys(draftPages, draftRecords);
  const onLive = keys(livePages, liveRecords);
  const holders = yield* holdersIn(
    ctx,
    scope,
    new Set(draftPages.map((page) => page.id)),
    draftRecords,
  );
  checkDanglingPointers(
    holders,
    { draft: (key) => inDraft.has(key), live: (key) => onLive.has(key) },
    found,
  );
  checkWrongKinds(holders, found);

  return { ...found, records: draftRecords };
});
