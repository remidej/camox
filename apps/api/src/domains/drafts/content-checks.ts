import { PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
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
  type Field,
  fieldOf,
  fieldsOf,
  itemSchemas,
  type Pointer,
  pointersIn,
  pointersOf,
} from "../_shared/fields";
import { type ContentLink, linksIn } from "../_shared/links";
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
import {
  draftIn,
  draftOf,
  inLocale,
  type DraftScope,
  type LiveInLocale,
  type ReadScope,
} from "./scope";

// What publishing a draft checks about content (ADR 0009): duplicate paths, dangling references,
// values of the wrong kind and missing meta titles. Each check returns findings in what the draft changed, which
// block publishing, and the same problems already on Live, which are warnings.
//
// Each locale's content is checked on its own (ADR 0015): a path or a record page value is
// unique within a locale, and every localization the draft changes is checked like the default
// locale's content.

type Scope = NonNullable<DraftScope>;
type RecordRow = typeof collectionRecords.$inferSelect;

export const CONTENT_PROBLEM_CODES = [
  "duplicatePath",
  "duplicateRecordPageValue",
  "emptyRequiredReference",
  "danglingReference",
  "wrongKindValue",
  "missingMetaTitle",
  "metaTitlePending",
  "localePrefixTaken",
  "duplicateLocale",
] as const;
export type ContentProblemCode = (typeof CONTENT_PROBLEM_CODES)[number];

/** An entity holding content, as previews name it. */
type ContentEntity = Exclude<overlay.EntityKind, "file">;

/** Where in content a problem is, for the studio to show it there. */
export type ProblemPlace = {
  /** The kind of the content field the problem is in, or null outside one. */
  fieldKind: Field["kind"] | null;
  /** The block the problem's content sits in: the block itself, an item's block, or null. */
  blockId: string | null;
};

/** Outside any block's content field, as a page's path or a locale. */
export const NO_PLACE: ProblemPlace = { fieldKind: null, blockId: null };

/** A problem found in an entity's field, in the locale of the localization it's found in. */
export type ContentFinding = ProblemPlace & {
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
        ...NO_PLACE,
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
    ...NO_PLACE,
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
            ...NO_PLACE,
            message: `Another record's page is also found by "${valueOf(record)}"`,
          });
        }
      }
    }
  },
);

/** Content to check against its definition: a block, shared content, item or record. */
export type Holder = {
  entity: "block" | "sharedContent" | "repeatableItem" | "record";
  id: string;
  /** The locale of the localization holding the content. */
  locale: string;
  /** The block holding the content: the block itself, or an item's block; null otherwise. */
  blockId: string | null;
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
  scope: Scope | LiveInLocale,
  projectId: number,
  visiblePages: Set<string>,
  records: RecordRow[],
) {
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
  const draft = draftIn(scope);
  const changed = (row: { draftId: string | null }) => draft !== null && storedBy(draft, row);

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
      blockId: block.id,
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
      blockId: null,
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
        blockId: item.blockId,
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
      blockId: null,
      projectId: record.projectId,
      changed: changed(record),
      content: record.content,
      schema: definition.contentSchema,
      rootSchema: definition.contentSchema,
    });
  }
  return holders;
});

/** Where in a holder's content a problem is: its field's kind, and the block holding it. */
export function problemPlaceIn(holder: Holder, field: Field | undefined): ProblemPlace {
  return { fieldKind: field?.kind ?? null, blockId: holder.blockId };
}

/** What content checks point at: records and pages. Publishing checks files on its own. */
type ContentPointer = Exclude<Pointer, { to: "file" }>;
type RecordPointer = Extract<Pointer, { to: "record" }>;

/**
 * References and reference-list entries pointing at nothing. Links to pages that don't exist are
 * the Link checker's findings (ADR 0034), not problems. Content the draft
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
  exists: { draft: (key: string) => boolean; live: (key: string) => boolean },
  excludedRecord: (id: string) => boolean,
  found: Findings,
) {
  for (const holder of holders) {
    const missingByField = new Map<string, { field: Field; missing: RecordPointer[] }>();
    for (const { field, pointer } of pointersIn(holder.schema, holder.content)) {
      if (pointer.to !== "record" || exists.draft(keyOf(holder.projectId, pointer))) continue;
      if (pointer.to === "record" && !isRequiredReference(field) && excludedRecord(pointer.id))
        continue;
      const entry = missingByField.get(field.name) ?? { field, missing: [] };
      entry.missing.push(pointer);
      missingByField.set(field.name, entry);
    }
    for (const [name, { field, missing }] of missingByField) {
      const { title } = field;
      const deletedByDraft = missing.some((pointer) =>
        exists.live(keyOf(holder.projectId, pointer)),
      );
      const blocking = holder.changed || deletedByDraft;
      (blocking ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: "danglingReference",
        field: name,
        ...problemPlaceIn(holder, field),
        message:
          !holder.changed && deletedByDraft
            ? `"${title}" points at a record this draft deletes: edit it in this draft`
            : `"${title}" points at a record that doesn't exist`,
      });
    }
  }
}

/** A single reference that has to point at a record. */
function isRequiredReference(field: Field) {
  return field.kind === "Reference" && field.required;
}

/**
 * Required references left empty. In content the draft changed they block publishing; on Live
 * they're warnings.
 */
function checkEmptyRequiredReferences(holders: Holder[], found: Findings) {
  for (const holder of holders) {
    const content = (holder.content ?? {}) as Record<string, unknown>;
    for (const field of fieldsOf(holder.schema)) {
      if (!isRequiredReference(field)) continue;
      if (pointersOf(field, content[field.name]).length > 0) continue;
      (holder.changed ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: "emptyRequiredReference",
        field: field.name,
        ...problemPlaceIn(holder, field),
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
      const definition = fieldOf(holder.schema, field);
      const title = definition?.title ?? field;
      (holder.changed ? found.blockers : found.warnings).push({
        entity: holder.entity,
        id: holder.id,
        code: "wrongKindValue",
        field,
        ...problemPlaceIn(holder, definition),
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
      ...NO_PLACE,
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
      ...NO_PLACE,
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
    projectId,
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
    { draft: (key) => inDraft.has(key), live: (key) => onLive.has(key) },
    (id) => excluded.has(id),
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

/** A link, in content a draft reads, to a page missing from the draft. */
export type MissingPageLink = {
  holder: Holder;
  /** The tag of the locale the content is in. */
  locale: string;
  field: Field;
  link: ContentLink;
  /** The missing page's name on Live, if Live has it. */
  page: string | null;
};

/**
 * Links to pages missing from the draft, in each locale it reads: in content the draft changed,
 * and in untouched Live content linking to a page the draft deletes, since deleting it is the
 * draft's change. Links Live already left leading nowhere aren't the draft's. A link to a page
 * missing from its locale leads to the default locale's page, so it isn't missing.
 */
export const missingPageLinks = Effect.fn("drafts.missingPageLinks")(function* (
  ctx: ServiceContext,
  draft: Scope,
) {
  const scope = draftOf(draft);
  const { projectId } = scope;
  const tags = new Set((yield* rowsIn(ctx, scope, projectId, locales)).map((locale) => locale.tag));
  const defaults = {
    draft: yield* rowsIn(ctx, scope, projectId, pages),
    live: yield* rowsIn(ctx, null, projectId, pages),
  };
  const missing: MissingPageLink[] = [];
  for (const tag of tags) {
    const inTag = inLocale(scope, tag);
    const draftPages = yield* rowsIn(ctx, inTag, projectId, pages);
    const livePages = yield* rowsIn(ctx, inLocale(null, tag), projectId, pages);
    const inDraft = new Set([...draftPages, ...defaults.draft].map((page) => page.id));
    const onLive = new Map([...defaults.live, ...livePages].map((page) => [page.id, page]));
    const records = yield* rowsIn(ctx, inTag, projectId, collectionRecords);
    const holders = yield* holdersIn(
      ctx,
      inTag,
      projectId,
      new Set(draftPages.map((page) => page.id)),
      records,
    );
    for (const holder of holders) {
      for (const { field, link } of linksIn(holder.schema, holder.content)) {
        if (!link.url.startsWith(PAGE_TEXT_LINK_PREFIX)) continue;
        const pageId = link.url.slice(PAGE_TEXT_LINK_PREFIX.length);
        if (inDraft.has(pageId)) continue;
        const live = onLive.get(pageId);
        if (!holder.changed && !live) continue;
        missing.push({ holder, locale: tag, field, link, page: live?.nickname ?? null });
      }
    }
  }
  return missing;
});

/** A link in content a draft reads, in a locale. */
export type LinkInContent = { holder: Holder; locale: string; field: Field; link: ContentLink };

/** The links in content the draft changed, in each locale it reads. */
export const changedLinks = Effect.fn("drafts.changedLinks")(function* (
  ctx: ServiceContext,
  draft: Scope,
) {
  const scope = draftOf(draft);
  const { projectId } = scope;
  const tags = new Set((yield* rowsIn(ctx, scope, projectId, locales)).map((locale) => locale.tag));
  const found: LinkInContent[] = [];
  for (const tag of tags) {
    const inTag = inLocale(scope, tag);
    const draftPages = yield* rowsIn(ctx, inTag, projectId, pages);
    const records = yield* rowsIn(ctx, inTag, projectId, collectionRecords);
    const holders = yield* holdersIn(
      ctx,
      inTag,
      projectId,
      new Set(draftPages.map((page) => page.id)),
      records,
    );
    for (const holder of holders.filter((candidate) => candidate.changed)) {
      for (const { field, link } of linksIn(holder.schema, holder.content)) {
        found.push({ holder, locale: tag, field, link });
      }
    }
  }
  return found;
});

/** A link in Live's content, in a locale, and whether it links to a page Live doesn't have. */
export type LiveLink = LinkInContent & { pageMissing: boolean };

/**
 * Every link in Live's content, in each of its locales: what the Link checker patrols (ADR 0034).
 * A link to a page missing from its locale leads to the default locale's page, so it isn't missing.
 */
export const liveLinks = Effect.fn("drafts.liveLinks")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const tags = new Set((yield* rowsIn(ctx, null, projectId, locales)).map((locale) => locale.tag));
  const defaults = yield* rowsIn(ctx, null, projectId, pages);
  const found: LiveLink[] = [];
  for (const tag of tags) {
    const inTag = inLocale(null, tag);
    const livePages = yield* rowsIn(ctx, inTag, projectId, pages);
    const onLive = new Set([...defaults, ...livePages].map((page) => page.id));
    const records = yield* rowsIn(ctx, inTag, projectId, collectionRecords);
    const holders = yield* holdersIn(
      ctx,
      inTag,
      projectId,
      new Set(livePages.map((page) => page.id)),
      records,
    );
    for (const holder of holders) {
      for (const { field, link } of linksIn(holder.schema, holder.content)) {
        const pageMissing =
          link.url.startsWith(PAGE_TEXT_LINK_PREFIX) &&
          !onLive.has(link.url.slice(PAGE_TEXT_LINK_PREFIX.length));
        found.push({ holder, locale: tag, field, link, pageMissing });
      }
    }
  }
  return found;
});

/**
 * The content of one block, shared content, repeatable item or record as a draft reads it in a
 * locale, with the definition it's read by: what a patroller's fix edits. Undefined once it's
 * gone, or read as nothing.
 */
export const holderOf = Effect.fn("drafts.holderOf")(function* (
  ctx: ServiceContext,
  draft: Scope,
  tag: string,
  subject: { entity: string; id: string },
) {
  const holders = yield* holdersOf(ctx, draft, tag);
  return holders.find((holder) => holder.entity === subject.entity && holder.id === subject.id);
});

/**
 * Every block, shared content, repeatable item and record a draft reads in a locale, with the
 * definition it's read by: what a patroller's check reads.
 */
export const holdersOf = Effect.fn("drafts.holdersOf")(function* (
  ctx: ServiceContext,
  draft: Scope,
  tag: string,
) {
  const scope = inLocale(draftOf(draft), tag);
  const { projectId } = scope;
  const visible = (yield* rowsIn(ctx, scope, projectId, pages)).map((page) => page.id);
  const records = yield* rowsIn(ctx, scope, projectId, collectionRecords);
  return yield* holdersIn(ctx, scope, projectId, new Set(visible), records);
});
