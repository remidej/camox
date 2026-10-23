import { CAMOX_ACTOR, type EndedDraft } from "@camox/api-contract/drafts";
import { env, waitUntil } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import {
  ConflictsChangedError,
  decodeInput,
  InvalidInputError,
  PublishBlockedError,
  TranslationsPendingError,
} from "../../lib/errors";
import { record } from "../../lib/journal";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  files,
  layouts,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import { sharedPlacementId } from "../blocks/shared-content";
import {
  publishStatements as filePublishStatements,
  withFileMetadata,
} from "../files/generated-metadata";
import { checkFileProblems, FILE_PROBLEM_CODES, type Finding } from "../files/publish-checks";
import { blobsOfDraft, deleteUnreferencedBlobs } from "../files/service";
import { type GenerationTarget, requestGenerations } from "../generated-values/generation";
import * as generatedValueStatements from "../generated-values/service";
import { homeOf } from "../generated-values/service";
import { defaultLocaleTag } from "../locales/default-locale";
import { locales } from "../locales/schema";
import { deleteUnreferencedOgImageBlobs, ogImageBlobsOf } from "../pages/og-image-blobs";
import { rootOfItem } from "../repeatable-items/roots";
import { endingThread } from "../threads/service";
import * as translationBookkeeping from "../translations/bookkeeping";
import { listedChanges } from "../translations/review";
import * as translations from "../translations/service";
import { accessTo } from "./access";
import { catchUpPending, isCatchUpDraft } from "./catch-up";
import { checkContentProblems, CONTENT_PROBLEM_CODES, type ContentFinding } from "./content-checks";
import { type FieldDiff, fieldDiffsOf } from "./field-values";
import * as overlay from "./overlay";
import { clearStatements as clearOverviewStatements, type Overview, overviewOf } from "./overview";
import { peopleNamed } from "./people";
import { drafts } from "./schema";
import { draftIn, draftOf, type DraftScope, inLocale, type ReadScope } from "./scope";
import { dropIfEmpty, findEndedDraft } from "./service";
import { describeSubjects, type RecordRow, type Subject } from "./subjects";

export type { Owner, Subject, SubjectKind } from "./subjects";

// Publishing a draft and discarding it (ADR 0009). The preview lists what publishing will do;
// its token records the conflicts it showed, and publishing aborts when they've changed since.

type Scope = NonNullable<DraftScope>;
type FileRow = typeof files.$inferSelect;

/**
 * Where an entity stored once per locale sits (ADR 0015): its locale's tag, or null for an entity
 * stored once, like a file or a locale.
 */
type InLocale = { locale: string | null };

export type Change = Subject & InLocale & { change: "created" | "changed" | "deleted" };

export type Conflict = Subject &
  InLocale & {
    /** A conflict is always on an entity a draft holds, never on a definition. */
    entity: overlay.EntityKind;
    /** Live's version now, or null when Live deleted the entity. */
    liveVersion: number | null;
    publishedBy: { id: string; name: string } | null;
    publishedAt: number | null;
    /** Whether a release made Live's version, which no member published (ADR 0006). */
    release: boolean;
    /**
     * What publishing overwrites: the first default-locale fields where Live's version and the
     * draft's copy differ, as short plain text. None when either side deleted the entity, or for
     * a conflict in another locale.
     */
    fields: FieldDiff[];
    /** How many more fields differ than `fields` lists. */
    moreFields: number;
    /**
     * Whether the draft can drop its copy to use Live's version instead (`revertToLive`): not
     * for a page or a locale, whose copies spread to other content.
     */
    revertible: boolean;
  };

/** How many differing fields a conflict lists. */
const CONFLICT_FIELDS = 3;

/** Why publishing drops a change. */
export const LOSS_REASONS = ["parentGone", "writtenAfterDeletion"] as const;

export type LostChange = Subject & InLocale & { reason: (typeof LOSS_REASONS)[number] };

/** What a blocker or warning is about. */
export const PROBLEM_CODES = [
  "definitionsDiffer",
  ...FILE_PROBLEM_CODES,
  ...CONTENT_PROBLEM_CODES,
] as const;

/** A blocker, or the same problem already on Live as a warning, naming what to fix. */
export type Problem = Subject &
  InLocale & {
    code: (typeof PROBLEM_CODES)[number];
    field: string;
    message: string;
  };

export type PublishPreview = {
  blockers: Problem[];
  conflicts: Conflict[];
  lost: LostChange[];
  warnings: Problem[];
  changes: Change[];
  /**
   * The tags of the locales the draft still has pending translations into, sorted. Publishing
   * waits for them unless it's asked to publish anyway (ADR 0017).
   */
  translating: string[];
  /** The tag of the default locale, which the others are translated from (null: none yet). */
  defaultLocale: string | null;
  /** Sent back to publish, which aborts when the conflicts no longer match it. */
  token: string;
  /** The draft's overview: AI's headline and bullets about its changes. */
  overview: Overview;
};

export const previewPublishInput = z.object({ projectId: z.number() });
export const publishInput = z.object({
  projectId: z.number(),
  token: z.string(),
  /**
   * Publishes while translations are pending: Camox finishes them in a draft of its own, which it
   * publishes once they're done (ADR 0017).
   */
  publishAnyway: z.boolean().optional(),
});
export const discardInput = z.object({ projectId: z.number() });
export const revertToLiveInput = z.object({
  projectId: z.number(),
  entity: z.enum(overlay.ENTITY_KINDS),
  id: z.string(),
});

/**
 * The kinds of entity a draft can drop its copy of to use Live's version instead. A page's copy
 * spreads to other content, as a path rename copies every page beneath it, and so does a
 * locale's, so they're never reverted alone.
 */
const REVERTIBLE_KINDS: ReadonlySet<overlay.EntityKind> = new Set([
  "block",
  "repeatableItem",
  "sharedContent",
  "record",
  "file",
]);

const tokenSchema = z.array(
  z.tuple([z.enum(overlay.ENTITY_KINDS), z.string(), z.number().nullable(), z.string().nullable()]),
);

function encodeToken(conflicts: overlay.StoredConflict[]): string {
  const keys: overlay.ConflictKey[] = conflicts
    .map((conflict): overlay.ConflictKey => [
      conflict.entity,
      conflict.id,
      conflict.liveVersion,
      conflict.locale,
    ])
    .sort((a, b) =>
      JSON.stringify([a[0], a[1], a[3]]) < JSON.stringify([b[0], b[1], b[3]]) ? -1 : 1,
    );
  return btoa(JSON.stringify(keys));
}

const decodeToken = (token: string) =>
  Effect.try({
    try: () => tokenSchema.parse(JSON.parse(atob(token))) as overlay.ConflictKey[],
    catch: () => new InvalidInputError({ message: "Invalid publish token" }),
  });

// --- Definitions of a development draft (ADR 0006) ---

type DefinitionRow = { name: string; schemaHash: string };

const DEFINITION_KINDS = [
  { kind: "block", label: "Block", table: blockDefinitions, name: blockDefinitions.blockId },
  { kind: "layout", label: "Layout", table: layouts, name: layouts.layoutId },
  {
    kind: "collection",
    label: "Collection",
    table: collectionDefinitions,
    name: collectionDefinitions.collectionId,
  },
] as const;

/**
 * A development draft publishes only while its definitions match Live's: the same names, and
 * the same schema hash for each (ADR 0006). Each definition that differs is a blocker, until a
 * release gives Live the same definitions. Regular drafts read Live's definitions.
 */
const checkDefinitions = Effect.fn("drafts.checkDefinitions")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  if (scope.kind !== "development") return [];
  const blockers: Problem[] = [];
  for (const { kind, label, table, name } of DEFINITION_KINDS) {
    const read = (definitions: DraftScope) =>
      Effect.promise(() =>
        ctx.db
          .select({ name, schemaHash: table.schemaHash })
          .from(table)
          .where(and(eq(table.projectId, scope.projectId), definitionsIn(table, definitions))),
      ) as Effect.Effect<DefinitionRow[]>;
    const live = new Map((yield* read(null)).map((row) => [row.name, row.schemaHash]));
    const local = new Map((yield* read(scope)).map((row) => [row.name, row.schemaHash]));
    const blocker = (definition: string, message: string): Problem => ({
      entity: "definition",
      id: `${kind}:${definition}`,
      label: `${label} "${definition}"`,
      owner: null,
      locale: null,
      code: "definitionsDiffer",
      field: "",
      message,
    });
    for (const [definition, hash] of local) {
      if (!live.has(definition)) {
        blockers.push(blocker(definition, "Only in your local code: release it before publishing"));
        continue;
      }
      if (live.get(definition) !== hash) {
        blockers.push(
          blocker(definition, "Differs from Live's: release your local code before publishing"),
        );
      }
    }
    for (const definition of live.keys()) {
      if (local.has(definition)) continue;
      blockers.push(
        blocker(
          definition,
          "On Live but not in your local code: sync or release before publishing",
        ),
      );
    }
  }
  return blockers.sort((a, b) => (a.id < b.id ? -1 : 1));
});

// --- Preview ---

export const computePreview = Effect.fn("drafts.computePreview")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  // Localizations still holding what Camox wrote aren't listed (ADR 0015).
  const stored = yield* listedChanges(ctx.db, scope, yield* overlay.changesOf(ctx.db, scope));
  const storedConflicts = yield* overlay.conflictsOf(ctx.db, scope);
  const losses = yield* overlay.lostOf(ctx.db, scope);
  const checked = yield* checkContentProblems(ctx, scope);
  const fileChecks = yield* checkFileProblems(ctx, scope, checked.holders);
  const findings = [
    ...fileChecks.blockers,
    ...fileChecks.warnings,
    ...checked.blockers,
    ...checked.warnings,
  ];

  const changedFiles = yield* withFileMetadata(
    ctx.db,
    scope,
    stored.flatMap((change) => (change.entity === "file" ? [change.row as FileRow] : [])),
  );
  const describe = yield* describeSubjects(
    ctx,
    scope,
    [
      ...stored.map(({ entity, row }) => ({ entity, id: row.id })),
      ...storedConflicts,
      ...losses.flatMap((loss) => (loss.reason === "parentGone" ? [loss] : [loss, loss.parent])),
      ...findings,
    ],
    {
      records: [
        ...checked.records,
        ...stored.flatMap((change) =>
          change.table === collectionRecords ? [change.row as RecordRow] : [],
        ),
      ],
      files: new Map([
        ...fileChecks.files,
        ...changedFiles.map((file) => [file.id, file] as const),
      ]),
    },
  );
  const asProblem = ({
    entity,
    id,
    locale,
    code,
    field,
    message,
  }: ContentFinding | Finding): Problem => ({
    ...describe(entity, id),
    locale,
    code,
    field,
    message,
  });

  const blockers = [
    ...(yield* checkDefinitions(ctx, scope)),
    ...fileChecks.blockers.map(asProblem),
    ...checked.blockers.map(asProblem),
  ];
  const warnings = [...fileChecks.warnings.map(asProblem), ...checked.warnings.map(asProblem)];

  const publishers = yield* peopleNamed(
    ctx.db,
    storedConflicts.flatMap((conflict) => conflict.publishedBy ?? []),
  );

  const defaultLocale = (yield* defaultLocaleTag(ctx.db, scope.projectId)) ?? null;
  const inDefault = (conflict: overlay.StoredConflict) =>
    conflict.locale === null || conflict.locale === defaultLocale;
  const fieldDiffs = yield* fieldDiffsOf(ctx, scope, storedConflicts.filter(inDefault));

  const conflicts: Conflict[] = storedConflicts.map((conflict) => {
    const fields = inDefault(conflict) ? fieldDiffs(conflict.entity, conflict.id) : [];
    return {
      ...describe(conflict.entity, conflict.id),
      entity: conflict.entity,
      locale: conflict.locale,
      liveVersion: conflict.liveVersion,
      publishedBy: (conflict.publishedBy && publishers.get(conflict.publishedBy)) || null,
      publishedAt: conflict.publishedAt,
      release: conflict.publishedAt !== null && conflict.publishedBy === null,
      fields: fields.slice(0, CONFLICT_FIELDS),
      moreFields: Math.max(0, fields.length - CONFLICT_FIELDS),
      revertible: REVERTIBLE_KINDS.has(conflict.entity),
    };
  });
  const lost: LostChange[] = losses.map((loss) => {
    if (loss.reason === "parentGone") {
      return { ...describe(loss.entity, loss.id), locale: loss.locale, reason: loss.reason };
    }
    const parent = describe(loss.parent.entity, loss.parent.id);
    return {
      ...describe(loss.entity, loss.id),
      locale: loss.locale,
      label: `Added to ${parent.label} after it was deleted`,
      owner: parent.owner,
      reason: loss.reason,
    };
  });
  const changes: Change[] = stored.map(({ entity, row, change }) => ({
    ...describe(entity, row.id),
    // A locale added or removed is named by its tag.
    ...(entity === "locale" && { label: (row as typeof locales.$inferSelect).tag }),
    locale: overlay.localeOfRow(row),
    change,
  }));

  const translating = yield* translations.translatingLocales(ctx.db, [scope.id]);
  const row = yield* Effect.promise(() =>
    ctx.db.select().from(drafts).where(eq(drafts.id, scope.id)).get(),
  );

  return {
    blockers,
    conflicts,
    lost,
    warnings,
    changes,
    translating: translating.get(scope.id) ?? [],
    defaultLocale,
    token: encodeToken(storedConflicts),
    overview: row ? overviewOf(row, changes.length > 0) : { status: "none" },
  } satisfies PublishPreview;
});

// --- Generated values after publishing (ADR 0012) ---

// D1 binds at most 100 parameters per statement.
const ID_CHUNK = 90;

/** Live's rows with these ids, in the locale a Live scope reads. */
const liveRows = Effect.fn("drafts.liveRows")(function* <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  live: ReadScope,
  table: T,
  ids: Iterable<string>,
) {
  const all = [...ids];
  const rows: T["$inferSelect"][] = [];
  for (let start = 0; start < all.length; start += ID_CHUNK) {
    const chunk = all.slice(start, start + ID_CHUNK);
    rows.push(...(yield* overlay.select(ctx.db, live, table, inArray(table.id, chunk))));
  }
  return rows;
});

/**
 * Requests Live's generated values for everything a publish changed and the parents above it:
 * another draft may have published to the same page since this one generated its values.
 * Children are generated first, so their parents start from the new summaries. Each locale's
 * values are requested in the locales of what changed (ADR 0015): summaries in the default
 * locale only, a page's SEO in the page's locale, and a file's alt text in every locale.
 */
const requestLiveGeneration = Effect.fn("drafts.requestLiveGeneration")(function* (
  ctx: ServiceContext,
  scope: Scope,
  stored: overlay.StoredChange[],
) {
  const kept = stored.filter((change) => change.change !== "deleted");
  const defaultTag = yield* defaultLocaleTag(ctx.db, scope.projectId);
  // Live now holds what the draft published, its locales included.
  const liveLocales = (yield* overlay.select(
    ctx.db,
    null,
    locales,
    eq(locales.projectId, scope.projectId),
  )).map((locale) => locale.tag);
  /** Live, read in a locale. */
  const liveIn = (tag: string): ReadScope => (tag === defaultTag ? null : inLocale(null, tag));
  // Each request writes and reaches a Durable Object: a few at a time, not one after another.
  const request = (
    live: ReadScope,
    targets: GenerationTarget[],
    options?: { immediately: boolean },
  ) =>
    requestGenerations(
      ctx.db,
      targets.map((target) => ({ home: homeOf(live, scope.projectId), target })),
      options,
    );

  const tags = new Set(kept.flatMap((change) => overlay.localeOfRow(change.row) ?? []));
  for (const tag of liveLocales.filter((tag) => tags.has(tag))) {
    const live = liveIn(tag);
    const inTag = kept.filter((change) => overlay.localeOfRow(change.row) === tag);
    const ids = (table: overlay.ContentTable) =>
      new Set(inTag.filter((change) => change.table === table).map((change) => change.row.id));
    const itemIds = ids(repeatableItems);
    const blockIds = ids(blocks);
    const pageIds = ids(pages);

    const items = yield* liveRows(ctx, live, repeatableItems, itemIds);
    const placementOf = new Map<string, string | null>();
    for (const item of items) {
      const root = rootOfItem(item);
      if ("blockId" in root) {
        blockIds.add(root.blockId);
        continue;
      }
      const key = `${root.sharedContent.projectId}:${root.sharedContent.type}`;
      if (!placementOf.has(key)) {
        placementOf.set(key, yield* sharedPlacementId(ctx.db, live, root.sharedContent));
      }
      const placement = placementOf.get(key);
      if (placement) blockIds.add(placement);
    }
    for (const change of inTag.filter((change) => change.table === sharedContents)) {
      const shared = change.row as typeof sharedContents.$inferSelect;
      const placement = yield* sharedPlacementId(ctx.db, live, shared);
      if (placement) blockIds.add(placement);
    }
    const blockRows = yield* liveRows(ctx, live, blocks, blockIds);
    for (const block of blockRows) if (block.pageId) pageIds.add(block.pageId);
    const pageRows = yield* liveRows(ctx, live, pages, pageIds);

    // Summaries are the default locale's only. Items are summarised right away; their blocks and
    // pages wait for them, as after an edit.
    if (tag === defaultTag) {
      yield* request(
        live,
        items.map((row) => ({ entity: "repeatableItem", row })),
        { immediately: true },
      );
      yield* request(
        live,
        blockRows.map((row) => ({ entity: "block", row })),
      );
    }
    yield* request(
      live,
      pageRows.map((row) => ({ entity: "page", row })),
    );
  }

  // Files are shared by every locale, each with its own alt text.
  const fileIds = new Set(
    kept.filter((change) => change.table === files).map((change) => change.row.id),
  );
  const fileRows = yield* liveRows(ctx, null, files, fileIds);
  for (const tag of liveLocales) {
    yield* request(
      liveIn(tag),
      fileRows.map((row) => ({ entity: "file", row })),
    );
  }
});

/**
 * The draft a request names, which publishing and discarding need. They act on every locale,
 * whichever one the request names.
 */
export const requireDraft = Effect.fn("drafts.requireDraft")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const { scope } = yield* Effect.scoped(
    accessTo({ ...ctx, locale: undefined }, { project: projectId }, "member"),
  );
  const draft = draftIn(scope);
  if (!draft) {
    return yield* new InvalidInputError({ message: "Live isn't a draft: name one to publish" });
  }
  return draft;
});

/** What publishing the request's draft will do, with the token to publish it. */
export const previewPublish = Effect.fn("drafts.previewPublish")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof previewPublishInput>,
) {
  const { projectId } = yield* decodeInput(previewPublishInput, rawInput);
  const scope = yield* requireDraft(ctx, projectId);
  return yield* computePreview(ctx, scope);
});

/**
 * Uses Live's version of an entity the draft conflicts on, instead of the draft's: drops the
 * draft's copy in every locale it holds one, so the draft reads Live's again and the conflict is
 * gone. Localizations translated from the dropped copy go with it. Only for an entity in the
 * draft's current conflicts, and of a kind that can be reverted alone.
 */
export const revertToLive = Effect.fn("drafts.revertToLive")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof revertToLiveInput>,
) {
  const { projectId, entity, id } = yield* decodeInput(revertToLiveInput, rawInput);
  if (!REVERTIBLE_KINDS.has(entity)) {
    return yield* new InvalidInputError({
      message: `A ${entity}'s copy spreads to other content: it can't use Live's version alone`,
    });
  }
  const scope = yield* requireDraft(ctx, projectId);
  const conflicts = yield* overlay.conflictsOf(ctx.db, scope);
  if (!conflicts.some((conflict) => conflict.entity === entity && conflict.id === id)) {
    return yield* new InvalidInputError({
      message: `This draft has no conflict on ${entity} ${id}`,
    });
  }
  const table = overlay.contentTableOf(entity);
  const copies = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(table as SQLiteTable)
      .where(and(overlay.storedIn(table, scope), eq(table.id, id))),
  );
  for (const copy of copies) {
    const locale = overlay.localeOfRow(copy);
    yield* overlay.revert(ctx.db, locale ? inLocale(scope, locale) : scope, table, id);
  }
  // TODO(#528): request a new draft overview, as any other change to the draft does.
  return {};
});

/**
 * The draft a request names, or how it ended when an earlier attempt published or discarded
 * it, so a retried publish or discard reports that instead of applying anything again.
 */
const draftOrEnded = (ctx: ServiceContext, projectId: number) =>
  requireDraft(ctx, projectId).pipe(
    Effect.map((draft) => ({ draft, ended: null })),
    Effect.catchTag("DraftEndedError", ({ ended }) => Effect.succeed({ draft: null, ended })),
  );

/** Tells the ended draft's viewers who ended it and how, so they go back to Live. */
const recordEnded = (ctx: ServiceContext, projectId: number, ended: EndedDraft | null) =>
  ended ? record(ctx.db, { kind: "ended", projectId, ended }) : Effect.void;

/**
 * What publishing did: nothing, for an empty draft, which publishing leaves as is; or how the
 * draft ended, also when an earlier attempt ended it (null for a development draft, which stays
 * open, emptied).
 */
export type PublishResult =
  | { empty: true; ended: null }
  | { empty: false; ended: EndedDraft | null };

const nothingToPublish: PublishResult = { empty: true, ended: null };
const endedAs = (ended: EndedDraft | null): PublishResult => ({ empty: false, ended });

/**
 * Publishes a draft whose preview was checked, by `publishedBy`, if Live's conflicts are still
 * those `shown`, and, when `translated`, while it still has nothing left to translate. Whether it
 * applied, and how the draft ended: when it didn't apply, a concurrent publish or discard may have
 * ended it; otherwise Live changed, or a translation was requested.
 */
const publishChecked = Effect.fn("drafts.publishChecked")(function* (
  ctx: ServiceContext,
  scope: Scope,
  options: {
    shown: overlay.ConflictKey[];
    publishedBy: string;
    stored: overlay.StoredChange[];
    /** Whether a translation requested since the check stops publishing, rather than dropping. */
    translated?: boolean;
  },
) {
  const { projectId } = scope;
  // Collected before the batch drops the draft's rows and replaces Live's.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const ogImageBlobs = yield* ogImageBlobsOf(ctx.db, projectId);
  const thread = yield* endingThread(ctx, scope.id);
  const applied = yield* Effect.result(
    overlay.publish(ctx.db, scope, {
      shown: options.shown,
      publishedBy: options.publishedBy,
      now: Date.now(),
      after: [
        ...(options.translated ? [translations.noPendingTranslationsGuard(scope.id)] : []),
        ...generatedValueStatements.publishStatements(ctx.db, scope),
        ...clearOverviewStatements(ctx.db, scope.id),
        ...filePublishStatements(scope.projectId),
        ...translationBookkeeping.publishStatements(scope),
        ...translations.endStatements(ctx.db, scope.id),
        ...thread.statements,
      ],
    }),
  );
  if (applied._tag === "Failure") {
    const ended = yield* findEndedDraft(ctx.db, projectId, scope.id);
    return { applied: false, ended: ended ?? null };
  }

  yield* thread.end;
  yield* deleteUnreferencedBlobs(ctx, blobs);
  yield* deleteUnreferencedOgImageBlobs(ctx, ogImageBlobs);
  yield* requestLiveGeneration(ctx, scope, options.stored);
  yield* translations.requestLiveMerges(ctx.db, scope, options.stored);
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  yield* recordEnded(ctx, projectId, ended);
  return { applied: true, ended };
});

/**
 * Publishes the request's draft whole, once it has no blockers and no pending translations, if
 * its conflicts are still those the token was given for. Published anyway, the translations
 * still pending carry on in Camox's catch-up draft, against the new Live.
 */
export const publishDraft = Effect.fn("drafts.publishDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof publishInput>,
) {
  const { projectId, token, publishAnyway } = yield* decodeInput(publishInput, rawInput);
  const { draft: scope, ended: earlier } = yield* draftOrEnded(ctx, projectId);
  if (!scope) return endedAs(earlier);
  const shown = yield* decodeToken(token);
  const stored = yield* overlay.changesOf(ctx.db, scope);
  if (stored.length === 0) return nothingToPublish;

  const preview = yield* computePreview(ctx, scope);
  if (preview.blockers.length > 0) {
    return yield* new PublishBlockedError({
      message: `The draft has ${preview.blockers.length} blocker(s) to fix before publishing`,
    });
  }
  if (preview.translating.length > 0 && !publishAnyway) {
    return yield* new TranslationsPendingError({
      message: `Translations into ${preview.translating.join(", ")} are still running: wait for them, or publish anyway`,
      translating: preview.translating,
    });
  }

  const user = yield* requireUser(ctx);
  // Read before the batch drops them with the draft's other translation state.
  const remaining = yield* translations.pendingRequestsOf(ctx.db, scope.id);
  const { applied, ended } = yield* publishChecked(ctx, scope, {
    shown,
    publishedBy: user.id,
    stored,
  });
  if (!applied) {
    if (ended) return endedAs(ended);
    return yield* new ConflictsChangedError({
      message: "Live changed since the preview. Review the new preview before publishing.",
    });
  }
  yield* catchUpPending(ctx.db, projectId, remaining);
  return endedAs(ended);
});

/** Camox's own context, outside any request: it acts with no session. */
export const camoxContext = (db: ServiceContext["db"]): ServiceContext => ({
  db,
  user: null,
  env,
  waitUntil,
  client: "camox",
  telemetryDisabled: true,
  draft: null,
});

/**
 * Publishes a catch-up draft once nothing is left to translate in it, as Camox (ADR 0017). It
 * stays open, like any other draft, while it has blockers or conflicts, for a member to review;
 * one left empty is dropped. A translation requested in it meanwhile stops publishing, and its
 * own settling publishes the draft later. Does nothing for any other draft.
 */
export const publishWhenTranslated = Effect.fn("drafts.publishWhenTranslated")(function* (
  db: ServiceContext["db"],
  draftId: string,
) {
  const row = yield* Effect.promise(() =>
    db.select().from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (!row || !isCatchUpDraft(row)) return;
  const translating = yield* translations.translatingLocales(db, [draftId]);
  if (translating.has(draftId)) return;

  const ctx = camoxContext(db);
  const scope = draftOf(row);
  const stored = yield* overlay.changesOf(db, scope);
  if (stored.length === 0) {
    if (yield* dropIfEmpty(db, scope)) {
      yield* record(db, { kind: "drafts", projectId: scope.projectId });
    }
    return;
  }
  const preview = yield* computePreview(ctx, scope);
  if (preview.blockers.length > 0 || preview.conflicts.length > 0) return;
  yield* publishChecked(ctx, scope, {
    shown: [],
    publishedBy: CAMOX_ACTOR,
    stored,
    translated: true,
  });
});

/**
 * Discards the request's draft: a regular draft is deleted with every row it stores, a
 * development draft is emptied. Returns how the draft ended, also when an earlier attempt
 * ended it.
 */
export const discardDraft = Effect.fn("drafts.discardDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof discardInput>,
) {
  const { projectId } = yield* decodeInput(discardInput, rawInput);
  const { draft: scope, ended: earlier } = yield* draftOrEnded(ctx, projectId);
  if (!scope) return { ended: earlier as EndedDraft | null };
  const user = yield* requireUser(ctx);
  // Collected before the cascade drops the draft's rows.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const ogImageBlobs = yield* ogImageBlobsOf(ctx.db, projectId);
  const thread = yield* endingThread(ctx, scope.id);
  const result = yield* Effect.result(
    overlay.discard(ctx.db, scope, {
      discardedBy: user.id,
      now: Date.now(),
      alongside: [
        ...generatedValueStatements.discardStatements(ctx.db, scope.id),
        ...clearOverviewStatements(ctx.db, scope.id),
        ...translations.endStatements(ctx.db, scope.id),
        ...thread.statements,
      ],
    }),
  );
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  if (result._tag === "Failure" && !ended) return yield* Effect.die(result.failure);
  if (result._tag === "Success") {
    yield* thread.end;
    yield* deleteUnreferencedBlobs(ctx, blobs);
    yield* deleteUnreferencedOgImageBlobs(ctx, ogImageBlobs);
    yield* recordEnded(ctx, projectId, ended);
  }
  return { ended };
});
