import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  locales,
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
import {
  fieldOf,
  fieldsOf,
  itemSchemas,
  type Pointer,
  pointersIn,
  pointersOf,
} from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import {
  pageValue,
  recordPageLayouts,
  recordsSharingPageValues,
} from "../collections/record-pages";
import { pagesWithDuplicatePaths } from "../pages/duplicate-paths";
import { generatedSeoOf, seoGenerated } from "../pages/generated-seo";
import { localizationExclusions } from "../translations/schema";
import * as overlay from "./overlay";
import { draftOf, inLocale, type DraftScope, type ReadScope } from "./scope";

// What publishing a draft checks about content (ADR 0009): duplicate paths, dangling references,
// values of the wrong kind and missing meta titles. Each check returns findings in what the draft changed, which
// block publishing, and the same problems already on Live, which are warnings.
//
// Each locale's content is checked on its own (ADR 0015): a path or a record page value is
// unique within a locale, and every localization the draft changes is checked like the default
// locale's content.

type Scope = NonNullable<DraftScope>;
type RecordRow = typeof collectionRecords.$inferSelect;

export type ContentProblemCode =
  | "duplicatePath"
  | "duplicateRecordPageValue"
  | "emptyRequiredReference"
  | "danglingReference"
  | "danglingPageLink"
  | "wrongKindValue"
  | "missingMetaTitle"
  | "metaTitlePending"
  | "localePrefixTaken"
  | "duplicateLocale";

/** An entity holding content, as previews name it. */
type ContentEntity = Exclude<overlay.EntityKind, "file">;

/** A problem found in an entity's field, in the locale of the localization it's found in. */
export type ContentFinding = {
  entity: ContentEntity;
  id: string;
  /** The tag of the localization's locale, or null for an entity stored once, like a locale. */
  locale: string | null;
  code: ContentProblemCode;
  field: string;
  message: string;
};

/** A finding before it's placed in a locale: the checks of one locale find them. */
type Finding = Omit<ContentFinding, "locale">;

type Findings = { blockers: Finding[]; warnings: Finding[] };

/** Whether the draft stores the row: it created or changed the entity. */
const storedBy = (scope: Scope, row: { draftId: string | null }) => row.draftId === scope.id;

/** A content table's rows in the project, as a scope reads them. */
const rowsIn = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: ReadScope,
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
  const finding = (page: { id: string }, code: ContentProblemCode, message: string): Finding => ({
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
        (d) => d.projectId === layout.projectId && d.collectionId === layout.collectionId,
      );
      if (!definition) continue;
      const rendered = records.filter(
        (r) => r.projectId === layout.projectId && r.collectionId === layout.collectionId,
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
export type Holder = {
  entity: Exclude<ContentEntity, "page">;
  id: string;
  /** The locale of the localization holding the content. */
  locale: string;
  projectId: number;
  /** Whether the draft created or changed it, rather than reading Live's. */
  changed: boolean;
  content: unknown;
  schema: unknown;
  /** The definition's whole content schema, which an item's schema is part of. */
  rootSchema: unknown;
};

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
  const blockDef = new Map(blockDefs.map((d) => [`${d.projectId}:${d.blockId}`, d]));
  const collectionDef = new Map(collectionDefs.map((d) => [`${d.projectId}:${d.collectionId}`, d]));
  const holders: Holder[] = [];
  const changed = (row: { draftId: string | null }) => storedBy(scope, row);

  // Item trees are rooted in a block or in shared content, read by the root's definition.
  const roots = new Map<string, unknown>();
  for (const block of yield* rowsIn(ctx, scope, projectId, blocks)) {
    if (block.pageId !== null && !visiblePages.has(block.pageId)) continue;
    const definition = blockDef.get(`${block.projectId}:${block.type}`);
    if (!definition) continue;
    roots.set(`block:${block.id}`, definition.contentSchema);
    if (definition.synced) continue;
    holders.push({
      entity: "block",
      id: block.id,
      locale: block.locale,
      projectId: block.projectId,
      changed: changed(block),
      content: block.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }
  for (const shared of yield* rowsIn(ctx, scope, projectId, sharedContents)) {
    const definition = blockDef.get(`${shared.projectId}:${shared.type}`);
    if (!definition) continue;
    roots.set(`shared:${shared.projectId}:${shared.type}`, definition.contentSchema);
    holders.push({
      entity: "sharedContent",
      id: shared.id,
      locale: shared.locale,
      projectId: shared.projectId,
      changed: changed(shared),
      content: shared.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }

  const items = yield* rowsIn(ctx, scope, projectId, repeatableItems);
  const blockProject = new Map(
    holders.filter((h) => h.entity === "block").map((h) => [h.id, h.projectId]),
  );
  const trees = new Map<string, typeof items>();
  for (const item of items) {
    const root =
      item.blockId !== null
        ? `block:${item.blockId}`
        : `shared:${item.projectId}:${item.sharedContentType}`;
    trees.set(root, [...(trees.get(root) ?? []), item]);
  }
  for (const [root, tree] of trees) {
    if (!roots.has(root)) continue;
    const schemas = itemSchemas(roots.get(root), tree);
    for (const item of tree) {
      const schema = schemas.get(item.id)?.content;
      const projectId = item.projectId ?? blockProject.get(item.blockId ?? "");
      if (!schema || projectId === undefined) continue;
      holders.push({
        entity: "repeatableItem",
        id: item.id,
        locale: item.locale,
        projectId,
        changed: changed(item),
        content: item.content,
        schema,
        rootSchema: roots.get(root),
      });
    }
  }

  for (const record of records) {
    const definition = collectionDef.get(`${record.projectId}:${record.collectionId}`);
    if (!definition) continue;
    holders.push({
      entity: "record",
      id: record.id,
      locale: record.locale,
      projectId: record.projectId,
      changed: changed(record),
      content: record.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }
  return holders;
});

/** What content checks point at: records and pages. Publishing checks files on its own. */
type ContentPointer = Exclude<Pointer, { to: "file" }>;

/**
 * References, reference-list entries and page links pointing at nothing. Content the draft
 * changed blocks publishing, and so does untouched Live content pointing at what the draft
 * deletes: the draft fixes it by editing that content. Pointers Live already left dangling are
 * warnings.
 *
 * A record excluded from the locale is missing there, like a deleted record (ADR 0015), yet
 * reference lists and optional references read it as left out: only a required reference to it
 * is dangling.
 */
function checkDanglingPointers(
  holders: Holder[],
  exists: {
    draft: (key: string) => boolean;
    live: (key: string) => boolean;
    excluded: (id: string) => boolean;
  },
  found: Findings,
) {
  for (const holder of holders) {
    const missingByField = new Map<string, { title: string; missing: ContentPointer[] }>();
    for (const { field, pointer } of pointersIn(holder.schema, holder.content)) {
      if (pointer.to === "file" || exists.draft(keyOf(holder.projectId, pointer))) continue;
      const required = field.kind === "Reference" && field.required;
      if (pointer.to === "record" && !required && exists.excluded(pointer.id)) continue;
      const entry = missingByField.get(field.name) ?? { title: field.title, missing: [] };
      entry.missing.push(pointer);
      missingByField.set(field.name, entry);
    }
    for (const [name, { title, missing }] of missingByField) {
      const deletedByDraft = missing.some((pointer) =>
        exists.live(keyOf(holder.projectId, pointer)),
      );
      const what = missing[0].to === "page" ? "a page" : "a record";
      const blocking = holder.changed || deletedByDraft;
      (blocking ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: missing[0].to === "page" ? "danglingPageLink" : "danglingReference",
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
 * Required references left empty. In content the draft changed they block publishing; on Live
 * they're warnings.
 */
function checkEmptyRequiredReferences(holders: Holder[], found: Findings) {
  for (const holder of holders) {
    const content = (holder.content ?? {}) as Record<string, unknown>;
    for (const field of fieldsOf(holder.schema)) {
      if (field.kind !== "Reference" || !field.required) continue;
      if (pointersOf(field, content[field.name]).length > 0) continue;
      (holder.changed ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: "emptyRequiredReference",
        field: field.name,
        message: `"${field.title}" is required but empty`,
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
    for (const field of fields) {
      const title = fieldOf(holder.schema, field)?.title ?? field;
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

function keyOf(projectId: number, pointer: ContentPointer) {
  return pointer.to === "page"
    ? `${projectId}:page:${pointer.id}`
    : `${projectId}:record:${pointer.collectionId}:${pointer.id}`;
}

type LocaleRow = typeof locales.$inferSelect;
type PageRow = typeof pages.$inferSelect;

/**
 * Locales whose prefix, their tag in lowercase, is a top-level path of the default locale's
 * pages: those pages would be shadowed. A locale or page the draft adds blocks publishing; a
 * clash already on Live is a warning.
 */
function checkLocalePrefixes(
  scope: Scope,
  others: LocaleRow[],
  defaultPages: PageRow[],
  found: Findings,
) {
  for (const locale of others) {
    const prefix = `/${locale.tag.toLowerCase()}`;
    const shadowed = defaultPages.filter(
      (page) => page.fullPath === prefix || page.fullPath.startsWith(`${prefix}/`),
    );
    if (shadowed.length === 0) continue;
    const drafted = storedBy(scope, locale) || shadowed.some((page) => storedBy(scope, page));
    (drafted ? found.blockers : found.warnings).push({
      entity: "locale",
      id: locale.id,
      code: "localePrefixTaken",
      field: "tag",
      message: `The "${locale.tag}" locale's prefix is a page path in the default locale: ${prefix}`,
    });
  }
}

/**
 * A locale the draft adds that Live has had since another draft published it: the draft has to
 * remove its own, and reads Live's.
 */
function checkDuplicateLocales(scope: Scope, tags: LocaleRow[], found: Findings) {
  const live = new Set(tags.filter((locale) => locale.draftId === null).map((row) => row.tag));
  for (const locale of tags) {
    if (!storedBy(scope, locale) || locale.baseVersion !== null || !live.has(locale.tag)) continue;
    found.blockers.push({
      entity: "locale",
      id: locale.id,
      code: "duplicateLocale",
      field: "tag",
      message: `Another draft published the "${locale.tag}" locale: remove it from this draft to keep Live's`,
    });
  }
}

/** Blockers and warnings about one locale's content, read by `scope` and on Live. */
const checkLocale = Effect.fn("drafts.checkLocale")(function* (
  ctx: ServiceContext,
  scope: Scope,
  defaults: { draft: PageRow[]; live: PageRow[] },
) {
  const found: Findings = { blockers: [], warnings: [] };
  const { projectId } = scope;
  const live = inLocale(null, scope.locale!);
  const draftPages = yield* rowsIn(ctx, scope, projectId, pages);
  const livePages = yield* rowsIn(ctx, live, projectId, pages);
  const draftRecords = yield* rowsIn(ctx, scope, projectId, collectionRecords);
  const liveRecords = yield* rowsIn(ctx, live, projectId, collectionRecords);

  checkDuplicatePaths(scope, draftPages, found);
  yield* checkMetaTitles(ctx, scope, draftPages, found);
  yield* checkDuplicateRecordPageValues(ctx, scope, draftRecords, found);

  // A link to a page missing from the locale leads to the default locale's page.
  const keys = (pageRows: PageRow[], recordRows: RecordRow[]) =>
    new Set([
      ...pageRows.map((page) => `${page.projectId}:page:${page.id}`),
      ...recordRows.map((r) => `${r.projectId}:record:${r.collectionId}:${r.id}`),
    ]);
  const inDraft = keys([...draftPages, ...defaults.draft], draftRecords);
  const onLive = keys([...livePages, ...defaults.live], liveRecords);
  const holders = yield* holdersIn(
    ctx,
    scope,
    new Set(draftPages.map((page) => page.id)),
    draftRecords,
  );
  checkEmptyRequiredReferences(holders, found);
  const excluded = new Set(
    (yield* rowsIn(ctx, scope, projectId, localizationExclusions))
      .filter((exclusion) => exclusion.entity === "record")
      .map((exclusion) => exclusion.id),
  );
  checkDanglingPointers(
    holders,
    {
      draft: (key) => inDraft.has(key),
      live: (key) => onLive.has(key),
      excluded: (id) => excluded.has(id),
    },
    found,
  );
  checkWrongKinds(holders, found);

  return { ...found, records: draftRecords, holders };
});

/**
 * Blockers and warnings about content: what the draft changed, and untouched Live content, in
 * each locale the draft reads.
 */
export const checkContentProblems = Effect.fn("drafts.checkContentProblems")(function* (
  ctx: ServiceContext,
  draft: Scope,
) {
  const scope = draftOf(draft);
  const { projectId } = scope;
  const tags = yield* rowsIn(ctx, scope, projectId, locales);
  const defaultLocale = tags.find((locale) => locale.isDefault)!;
  const defaults = {
    draft: yield* rowsIn(ctx, scope, projectId, pages),
    live: yield* rowsIn(ctx, null, projectId, pages),
  };

  const blockers: ContentFinding[] = [];
  const warnings: ContentFinding[] = [];
  const records: RecordRow[] = [];
  const holders: Holder[] = [];
  const unplaced: Findings = { blockers: [], warnings: [] };
  checkLocalePrefixes(
    scope,
    tags.filter((locale) => locale !== defaultLocale),
    defaults.draft,
    unplaced,
  );
  checkDuplicateLocales(scope, tags, unplaced);
  blockers.push(...unplaced.blockers.map((finding) => ({ ...finding, locale: null })));
  warnings.push(...unplaced.warnings.map((finding) => ({ ...finding, locale: null })));

  // A locale another draft published since this one added it is read once.
  for (const tag of new Set(tags.map((locale) => locale.tag))) {
    const found = yield* checkLocale(ctx, inLocale(scope, tag), defaults);
    blockers.push(...found.blockers.map((finding) => ({ ...finding, locale: tag })));
    warnings.push(...found.warnings.map((finding) => ({ ...finding, locale: tag })));
    records.push(...found.records);
    holders.push(...found.holders);
  }
  return { blockers, warnings, records, holders };
});
