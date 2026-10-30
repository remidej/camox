import { CAMOX_ACTOR, type EndedDraft } from "@camox/api-contract/drafts";
import type { FindingView, PatrollerId } from "@camox/api-contract/patrol";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import {
  ConflictsChangedError,
  decodeInput,
  InvalidInputError,
  PublishBlockedError,
  RevisionChangedError,
  TranslationsPendingError,
  FindingsOpenError,
  ChecksRunningError,
} from "../../lib/errors";
import { record } from "../../lib/journal";
import { logSpan } from "../../lib/timing";
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
import type { ServiceContext } from "../_shared/service-context";
import { sharedPlacementId } from "../blocks/shared-content";
import { deleteDraftCode } from "../code/drafts";
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
import { requestStaleChecks, staleChecks } from "../patrol/checks";
import * as patrolFindings from "../patrol/findings";
import { draftFindings } from "../patrol/read";
import * as patrolReports from "../patrol/reports";
import { reportCatchUpPublished } from "../patrol/translator";
import { holdPublishPush } from "../publishes/queue";
import { uploadAhead } from "../publishes/upload-ahead";
import { rootOfItem } from "../repeatable-items/roots";
import { codeOfDraft, type PreviewCode } from "../revisions/preview";
import { endingThread } from "../threads/service";
import * as translationBookkeeping from "../translations/bookkeeping";
import { listedChanges } from "../translations/review";
import * as translations from "../translations/service";
import { accessTo } from "./access";
import { camoxContext } from "./camox-context";
import { isCatchUpDraft } from "./catch-up";
import {
  checkContentProblems,
  CONTENT_PROBLEM_CODES,
  type ContentFinding,
  type ProblemPlace,
} from "./content-checks";
import { type FieldDiff, fieldDiffsOf } from "./field-values";
import * as overlay from "./overlay";
import {
  clearStatements as clearOverviewStatements,
  fingerprintOfChanges,
  type Overview,
  overviewOf,
  requestIfOutdated,
} from "./overview";
import { peopleNamed } from "./people";
import { checkRemovals, REMOVAL_PROBLEM_CODES, type RemovalFinding } from "./removals";
import { drafts, endedDrafts } from "./schema";
import { draftIn, draftOf, type DraftScope, inLocale, type ReadScope } from "./scope";
import { dropIfEmpty, findEndedDraft } from "./service";
import { describeSubjects, type RecordRow, type Subject } from "./subjects";

export type { Owner, Subject, SubjectKind } from "./subjects";

// Publishing a draft and deleting it (ADR 0009). The preview lists what publishing will do;
// its token records the conflicts it showed, and publishing aborts when they've changed since.

type Scope = NonNullable<DraftScope>;
type BatchItem = overlay.BatchItem;
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
  "codeDoesNotBuild",
  "codeDoesNotTypeCheck",
  "codeDoesNotMerge",
  ...FILE_PROBLEM_CODES,
  ...CONTENT_PROBLEM_CODES,
  ...REMOVAL_PROBLEM_CODES,
] as const;

/** A blocker, or the same problem already on Live as a warning, naming what to fix. */
export type Problem = Subject &
  InLocale &
  ProblemPlace & {
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
   * waits for them (ADR 0033).
   */
  translating: string[];
  /**
   * The draft's open findings, the oldest first. Publishing waits for each to be fixed or
   * dismissed (ADR 0033).
   */
  findings: FindingView[];
  /**
   * The patrollers whose check at publish hasn't read the draft's latest changes yet, in the
   * registry's order. Publishing waits for them (ADR 0033).
   */
  checking: { id: PatrollerId; role: string }[];
  /** The tag of the default locale, which the others are translated from (null: none yet). */
  defaultLocale: string | null;
  /** Sent back to publish, which aborts when the conflicts no longer match it. */
  token: string;
  /** The draft's overview: AI's headline and bullets about its changes. */
  overview: Overview;
  /** Where the draft's code stands, for a draft whose code the agent changed. */
  code: PreviewCode | null;
};

export const previewPublishInput = z.object({ projectId: z.number() });
export const publishInput = z.object({
  projectId: z.number(),
  token: z.string(),
  /**
   * The revision the review showed (`code.revision`), for a draft with code: publishing ships it,
   * and is refused once the agent left a newer one.
   */
  revision: z.string().optional(),
});
export const deleteInput = z.object({ projectId: z.number() });
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

// --- The draft's code (spec #560, section 10) ---

/** A blocker about the draft's code, which only the agent fixes, in the draft's thread. */
const codeBlocker = (
  draftId: string,
  code: "codeDoesNotBuild" | "codeDoesNotTypeCheck" | "codeDoesNotMerge",
  message: string,
): Problem => ({
  entity: "code",
  id: draftId,
  label: "The website's code",
  owner: null,
  locale: null,
  code,
  field: "",
  fieldKind: null,
  blockId: null,
  message,
});

/**
 * The preview's `code`, and the blockers the draft's code has: merging Live's code into it
 * clashed and Camox's reconcile turn hasn't fixed it, or else its head revision isn't built,
 * built but its definitions can't be used, so the preview doesn't show it, or built but doesn't
 * type check.
 */
const checkCode = Effect.fn("drafts.checkCode")(function* (ctx: ServiceContext, scope: Scope) {
  const { code, head, clashed } = yield* Effect.promise(() =>
    codeOfDraft(ctx.env, ctx.db, scope.id),
  );
  const blockers: Problem[] = [];
  // Who wrote the head, and who fixes it: a member's push is theirs to fix, or the agent's.
  const pushed = head?.leftBy === "push";
  const changes = pushed ? "The code pushed last" : "The agent's latest code changes";
  const fix = pushed
    ? "fix them in your checkout and push again, or ask Camox's agent in the draft's thread"
    : "ask it to fix them in the draft's thread";
  if (clashed) {
    blockers.push(
      codeBlocker(
        scope.id,
        "codeDoesNotMerge",
        "The draft's code doesn't merge with Live's latest code: Camox's agent fixes it in the draft's thread, where you can ask it again",
      ),
    );
  } else if (head && head.buildStatus !== "built" && head.buildStatus !== "building") {
    blockers.push(
      codeBlocker(
        scope.id,
        "codeDoesNotBuild",
        `${changes} ${pushed ? "doesn't" : "don't"} build: ${fix}`,
      ),
    );
  } else if (
    head?.buildStatus === "built" &&
    head.leftBy !== "merge" &&
    head.id !== code?.revision &&
    !code?.building
  ) {
    // It built, but the draft can't use its definitions, so the preview doesn't show it.
    blockers.push(
      codeBlocker(scope.id, "codeDoesNotBuild", `${changes} can't be shown in the preview: ${fix}`),
    );
  } else if (head?.buildStatus === "built" && head.typeCheckStatus === "failed") {
    blockers.push(
      codeBlocker(
        scope.id,
        "codeDoesNotTypeCheck",
        `${changes} ${pushed ? "has" : "have"} type errors: ${fix}`,
      ),
    );
  }
  return { code, blockers };
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
  const removals = yield* checkRemovals(ctx, scope);
  const findings = [
    ...fileChecks.blockers,
    ...fileChecks.warnings,
    ...checked.blockers,
    ...checked.warnings,
    ...removals,
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
    fieldKind,
    blockId,
    message,
  }: ContentFinding | Finding | RemovalFinding): Problem => ({
    ...describe(entity, id),
    locale,
    code,
    field,
    fieldKind,
    blockId,
    message,
  });

  const checkedCode = yield* checkCode(ctx, scope);
  const blockers = [
    ...checkedCode.blockers,
    ...fileChecks.blockers.map(asProblem),
    ...checked.blockers.map(asProblem),
  ];
  const warnings = [
    ...removals.map(asProblem),
    ...fileChecks.warnings.map(asProblem),
    ...checked.warnings.map(asProblem),
  ];

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

  const fingerprint = yield* fingerprintOfChanges(stored);

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
    findings: yield* draftFindings(ctx.db, scope),
    checking: (yield* staleChecks(ctx.db, scope.id, fingerprint)).map(({ id, role }) => ({
      id,
      role,
    })),
    defaultLocale,
    token: encodeToken(storedConflicts),
    overview: row ? overviewOf(row, fingerprint) : ({ status: "none" } as const),
    code: checkedCode.code,
    /** The fingerprint of the draft's changes, which its overview records: not in the preview. */
    fingerprint,
  } satisfies PublishPreview & { fingerprint: string | null };
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
 * The draft a request names, which publishing and deleting need. They act on every locale,
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
  const { fingerprint, ...preview } = yield* computePreview(ctx, scope);
  // Someone is reviewing the draft: an outdated overview is written now, not after the debounce,
  // and so are the patrollers' checks that read other changes.
  yield* requestIfOutdated(ctx.db, scope.id, preview.overview);
  yield* requestStaleChecks(ctx.db, scope.id, fingerprint);
  // Publishing it is near: its publish script goes up now, unless it already did.
  if (preview.code?.revision && !preview.code.publishing) {
    ctx.waitUntil(
      uploadAhead(ctx.env, ctx.db, { draftId: scope.id, revisionId: preview.code.revision }),
    );
  }
  return preview;
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
  // The reverts are content writes: once this succeeds, `runService` requests a new overview of
  // the draft, as after any other change to it (`requestOverviewsOfWrites`).
  return {};
});

/**
 * The draft a request names, or how it ended when an earlier attempt published or deleted
 * it, so a retried publish or delete reports that instead of applying anything again.
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
 * draft ended, also when an earlier attempt ended it.
 */
export type PublishResult =
  | { empty: true; ended: null }
  | { empty: false; ended: EndedDraft | null; publishing?: undefined }
  | { empty: false; ended: null; publishing: true };

const nothingToPublish: PublishResult = { empty: true, ended: null };
const publishingStarted: PublishResult = { empty: false, ended: null, publishing: true };
const endedAs = (ended: EndedDraft | null): PublishResult => ({ empty: false, ended });

/**
 * Publishes a draft whose preview was checked, by `publishedBy`, if Live's conflicts are still
 * those `shown`, while it still has nothing left to translate (ADR 0033). Whether it applied, and
 * how the draft ended: when it didn't apply, a concurrent publish or delete may have ended it;
 * otherwise Live changed, or a translation was requested.
 *
 * Once it applied, its follow-ups end the draft's thread, delete the files no one uses anymore
 * and request Live's generated values and merges. With `followUpsApart`, they're returned to
 * run as a unit of work of their own, once this one's journal told the draft's viewers it ended:
 * a unit's realtime messages go once all of it succeeded.
 */
const publishChecked = Effect.fn("drafts.publishChecked")(function* (
  ctx: ServiceContext,
  scope: Scope,
  options: {
    shown: overlay.ConflictKey[];
    publishedBy: string;
    stored: overlay.StoredChange[];
    /** Statements of the batch's own, run once Live holds what the draft publishes. */
    after?: BatchItem[];
    followUpsApart?: boolean;
  },
) {
  const { projectId } = scope;
  // Collected before the batch drops the draft's rows and replaces Live's.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const ogImageBlobs = yield* ogImageBlobsOf(ctx.db, projectId);
  const thread = yield* endingThread(ctx, scope.id, {
    outcome: "published",
    byUserId: options.publishedBy,
  });
  const applied = yield* Effect.result(
    overlay.publish(ctx.db, scope, {
      shown: options.shown,
      publishedBy: options.publishedBy,
      now: Date.now(),
      after: [
        translations.noPendingTranslationsGuard(scope.id),
        ...generatedValueStatements.publishStatements(ctx.db, scope),
        ...clearOverviewStatements(ctx.db, scope.id),
        ...filePublishStatements(scope.projectId),
        ...translationBookkeeping.publishStatements(scope),
        ...translations.endStatements(ctx.db, scope.id),
        ...patrolReports.endStatements(ctx.db, scope.id),
        ...patrolFindings.endStatements(ctx.db, scope.id),
        ...(options.after ?? []),
      ],
    }),
  );
  if (applied._tag === "Failure") {
    const ended = yield* findEndedDraft(ctx.db, projectId, scope.id);
    return { applied: false, ended: ended ?? null, followUps: undefined };
  }

  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  yield* recordEnded(ctx, projectId, ended);
  const followUps = Effect.gen(function* () {
    yield* thread.end;
    yield* deleteUnreferencedBlobs(ctx, blobs);
    yield* deleteUnreferencedOgImageBlobs(ctx, ogImageBlobs);
    yield* requestLiveGeneration(ctx, scope, options.stored);
    yield* translations.requestLiveMerges(ctx.db, scope, options.stored);
  });
  if (options.followUpsApart) return { applied: true, ended, followUps };
  yield* followUps;
  return { applied: true, ended, followUps: undefined };
});

/**
 * Publishes the request's draft whole, once it has no blockers and no pending translations, if
 * its conflicts are still those the token was given for (ADR 0033).
 *
 * A draft with code is published by a publish Workflow instead (`../publishes/workflow.ts`), once
 * the revision the review showed, `revision`, is still the one the draft previews: the request
 * starts it and returns at once, `publishing`. Its viewers learn how it ends through the project
 * room.
 */
export const publishDraft = Effect.fn("drafts.publishDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof publishInput>,
) {
  const { projectId, token, revision } = yield* decodeInput(publishInput, rawInput);
  const startedAt = Date.now();
  const { draft: scope, ended: earlier } = yield* draftOrEnded(ctx, projectId);
  if (!scope) return endedAs(earlier);
  const span = { projectId, draftId: scope.id, revisionId: revision };
  const shown = yield* decodeToken(token);
  const stored = yield* overlay.changesOf(ctx.db, scope);
  const previewStartedAt = Date.now();
  const preview = yield* computePreview(ctx, scope);
  logSpan("publish.request.computePreview", Date.now() - previewStartedAt, {
    ...span,
    withCode: !!preview.code,
  });
  // A draft with code publishes its code even when it changed no content.
  if (stored.length === 0 && !preview.code) return nothingToPublish;

  // A publish of this draft already running, such as one whose response was lost, is the same.
  if (preview.code?.publishing) {
    const row = yield* Effect.promise(() =>
      ctx.db
        .select({ revision: drafts.publishingRevisionId })
        .from(drafts)
        .where(eq(drafts.id, scope.id))
        .get(),
    );
    if (row?.revision === revision) return publishingStarted;
    return yield* new RevisionChangedError({
      message: "The draft is already being published from another review",
    });
  }
  if (preview.blockers.length > 0) {
    return yield* new PublishBlockedError({
      message: `The draft has ${preview.blockers.length} blocker(s) to fix before publishing`,
    });
  }
  if (preview.translating.length > 0) return yield* translationsPending(preview.translating);
  const held = heldByPatrol(preview);
  if (held) return yield* held;

  const user = yield* requireUser(ctx);
  if (preview.code) {
    // Publishing ships exactly the revision members previewed: not changes still building, nor
    // a revision older than the one the draft previews now.
    if (preview.code.building || !preview.code.revision || preview.code.revision !== revision) {
      return yield* new RevisionChangedError({
        message: preview.code.building
          ? "The draft's latest code changes are still building: publish once they're done"
          : "The draft's code changed since the review. Review it again before publishing.",
      });
    }
    const startPublishAt = Date.now();
    const instanceId = yield* startPublish(ctx, scope, {
      revision: preview.code.revision,
      token,
      publishedBy: user.id,
    });
    logSpan("publish.request.startPublish", Date.now() - startPublishAt, { ...span, instanceId });
    // Only the request: its publish Workflow's spans go on from there.
    logSpan("publish.request", Date.now() - startedAt, { ...span, instanceId, withCode: true });
    return publishingStarted;
  }

  const { applied, ended } = yield* publishChecked(ctx, scope, {
    shown,
    publishedBy: user.id,
    stored,
  });
  logSpan("publish.request", Date.now() - startedAt, { ...span, withCode: false, applied });
  if (!applied) {
    if (ended) return endedAs(ended);
    // A translation requested since the preview holds publishing too.
    const translating = (yield* translations.translatingLocales(ctx.db, [scope.id])).get(scope.id);
    if (translating) return yield* translationsPending(translating);
    return yield* new ConflictsChangedError({
      message: "Live changed since the preview. Review the new preview before publishing.",
    });
  }
  return endedAs(ended);
});

/** Publishing waits for the translations into `translating` (ADR 0033). */
const translationsPending = (translating: readonly string[]) =>
  new TranslationsPendingError({
    message: `Translations into ${translating.join(", ")} are still running: publishing waits for them`,
    translating,
  });

/** What an open finding is, in a publish refusal: "“About” in Footer links to a missing page". */
export const findingLine = ({ about, subject }: FindingView) => {
  const what = `“${about.text}” in ${subject.name}`;
  switch (about.kind) {
    case "missingPage":
      return `${what} links to ${about.page ?? "a page"}, which no longer exists`;
    case "brokenLink":
      return `${what} links to ${about.url}, which doesn't work`;
    case "misspelling":
      return `${what} may be misspelled`;
    case "grammar":
      return `${what} may be a grammar mistake`;
  }
};

/**
 * Why the patrollers hold publishing, if they do (ADR 0033): the draft's open findings, each to
 * fix or for a member to dismiss, or their checks still to read its latest changes.
 */
export const heldByPatrol = (preview: Pick<PublishPreview, "findings" | "checking">) => {
  const { findings, checking } = preview;
  if (findings.length > 0) {
    return new FindingsOpenError({
      message:
        `The draft has ${findings.length} open finding(s) to fix, or for a member to dismiss, ` +
        `before publishing: ${findings.map(findingLine).join("; ")}`,
    });
  }
  if (checking.length > 0) {
    const roles = checking.map(({ role }) => role);
    const who = roles.map((role) => `the ${role}`).join(" and ");
    return new ChecksRunningError({
      message: `${who[0]!.toUpperCase()}${who.slice(1)} ${roles.length > 1 ? "are" : "is"} still checking the draft: publishing waits for ${roles.length > 1 ? "them" : "it"}`,
      checking: roles,
    });
  }
  return null;
};

/**
 * Puts a draft with code in its publishing state, pinned to `revision`, and starts its publish
 * Workflow, which waits for the project's publishes before it to end. Another publish of the
 * draft starting at the same moment is refused.
 */
const startPublish = Effect.fn("drafts.startPublish")(function* (
  ctx: ServiceContext,
  scope: Scope,
  params: { revision: string; token: string; publishedBy: string },
) {
  const instanceId = crypto.randomUUID();
  const started = yield* Effect.promise(() =>
    ctx.db
      .update(drafts)
      .set({
        publishingRevisionId: params.revision,
        publishInstanceId: instanceId,
        publishRequestedAt: Date.now(),
        publishAbortReason: null,
      })
      .where(and(eq(drafts.id, scope.id), isNull(drafts.publishingRevisionId)))
      .returning({ id: drafts.id }),
  );
  if (started.length === 0) {
    return yield* new RevisionChangedError({ message: "The draft is already being published" });
  }
  const created = yield* Effect.promise(() =>
    ctx.env.PUBLISH_WORKFLOW.create({
      id: instanceId,
      params: { draftId: scope.id, projectId: scope.projectId, ...params },
    }).then(
      () => true,
      (error: unknown) => {
        console.error("The publish Workflow didn't start", error);
        return false;
      },
    ),
  );
  if (!created) {
    yield* Effect.promise(() =>
      ctx.db
        .update(drafts)
        .set({ publishingRevisionId: null, publishInstanceId: null, publishRequestedAt: null })
        .where(and(eq(drafts.id, scope.id), eq(drafts.publishInstanceId, instanceId))),
    );
    return yield* Effect.die(new Error("The publish couldn't start: try again"));
  }
  // The draft's viewers see it publishing.
  yield* record(ctx.db, { kind: "drafts", projectId: scope.projectId });
  return instanceId;
});

/**
 * The publish batch of a draft with code, which its publish Workflow runs once the revision's
 * own Worker serves Live: the draft's content, as `publishDraft` applies it, and the pinned
 * revision's definitions, replacing Live's, in one batch. It aborts when Live's conflicts are no
 * longer those `token` records, or when the draft previews another revision than `revision`.
 * Returns whether it applied, and how the draft ended, also when an earlier run ended it, with
 * its follow-ups once it applied, to run as a unit of work of their own (`publishChecked`).
 */
export const publishWithCode = Effect.fn("drafts.publishWithCode")(function* (
  db: ServiceContext["db"],
  {
    draftId,
    revision,
    token,
    publishedBy,
    instanceId,
  }: {
    draftId: string;
    revision: string;
    token: string;
    publishedBy: string;
    /** The publish Workflow's instance, which keeps its place in the project's queue. */
    instanceId: string;
  },
) {
  const row = yield* Effect.promise(() =>
    db.select().from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (!row) {
    const ended = yield* Effect.promise(() =>
      db
        .select({ projectId: endedDrafts.projectId })
        .from(endedDrafts)
        .where(eq(endedDrafts.id, draftId))
        .get(),
    );
    const found = ended ? yield* findEndedDraft(db, ended.projectId, draftId) : undefined;
    return { applied: false, ended: found ?? null, followUps: undefined };
  }
  const scope = draftOf(row);
  const shown = yield* decodeToken(token);
  const stored = yield* overlay.changesOf(db, scope);
  const result = yield* publishChecked(camoxContext(db), scope, {
    shown,
    publishedBy,
    stored,
    after: [
      previewsRevisionGuard(draftId, revision),
      ...definitionsPublishStatements(db, scope),
      // The draft's row goes: the publish keeps its place in the queue until it pushed to `main`.
      holdPublishPush(db, {
        projectId: scope.projectId,
        instanceId,
        requestedAt: row.publishRequestedAt ?? Date.now(),
      }),
    ],
    followUpsApart: true,
  });
  // Live's viewers read its new definitions.
  if (result.applied) {
    yield* record(db, { kind: "definitions", projectId: scope.projectId, draftId: null });
  }
  return result;
});

/** Aborts the publish batch unless the draft still previews `revision`, its definitions' source. */
const previewsRevisionGuard = (draftId: string, revision: string): BatchItem =>
  sql`select case when exists (
      select 1 from ${drafts} where ${drafts.id} = ${draftId} and ${drafts.previewedRevisionId} = ${revision})
    then 1 else json('the draft previews another revision') end`;

/**
 * Replaces Live's definitions with the draft's, which its previewed revision synced (ADR 0020):
 * Live's rows go, and the draft's become Live's, before the draft's own would cascade with it.
 */
function definitionsPublishStatements(db: ServiceContext["db"], scope: Scope): BatchItem[] {
  return [blockDefinitions, layouts, collectionDefinitions].flatMap((table) => [
    db.delete(table).where(and(eq(table.projectId, scope.projectId), isNull(table.draftId))),
    db.update(table).set({ draftId: null }).where(eq(table.draftId, scope.id)),
  ]);
}

export { camoxContext };

/**
 * Publishes a catch-up draft once nothing is left to translate in it and its patrollers checked
 * it, as Camox (ADR 0017, ADR 0033). It stays open, like any other draft, while it has blockers,
 * conflicts or open findings, for a member to review;
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
  const { fingerprint, ...preview } = yield* computePreview(ctx, scope);
  if (preview.blockers.length > 0 || preview.conflicts.length > 0) return;
  // Its patrollers' checks settling publishes it later; what they found waits for a member.
  if (preview.checking.length > 0) return yield* requestStaleChecks(db, scope.id, fingerprint);
  if (preview.findings.length > 0) return;
  const { applied } = yield* publishChecked(ctx, scope, {
    shown: [],
    publishedBy: CAMOX_ACTOR,
    stored,
  });
  // The Translator reports on Live that Live's translations caught up (ADR 0024).
  if (applied) yield* reportCatchUpPublished(db, scope);
});

/**
 * Deletes the request's draft with every row it stores. Returns how the draft ended, also when
 * an earlier attempt ended it.
 */
export const deleteDraft = Effect.fn("drafts.deleteDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteInput>,
) {
  const { projectId } = yield* decodeInput(deleteInput, rawInput);
  const { draft: scope, ended: earlier } = yield* draftOrEnded(ctx, projectId);
  if (!scope) return { ended: earlier as EndedDraft | null };
  const user = yield* requireUser(ctx);
  // Collected before the cascade drops the draft's rows.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const ogImageBlobs = yield* ogImageBlobsOf(ctx.db, projectId);
  const thread = yield* endingThread(ctx, scope.id, { outcome: "deleted", byUserId: user.id });
  const result = yield* Effect.result(
    overlay.deleteDraft(ctx.db, scope, {
      deletedBy: user.id,
      now: Date.now(),
      alongside: [
        ...generatedValueStatements.deleteStatements(ctx.db, scope.id),
        ...clearOverviewStatements(ctx.db, scope.id),
        ...translations.endStatements(ctx.db, scope.id),
        ...patrolReports.endStatements(ctx.db, scope.id),
        ...patrolFindings.endStatements(ctx.db, scope.id),
      ],
    }),
  );
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  if (result._tag === "Failure" && !ended) return yield* Effect.die(result.failure);
  if (result._tag === "Success") {
    yield* thread.end;
    yield* deleteDraftCode(ctx, { projectId, draftId: scope.id });
    yield* deleteUnreferencedBlobs(ctx, blobs);
    yield* deleteUnreferencedOgImageBlobs(ctx, ogImageBlobs);
    yield* recordEnded(ctx, projectId, ended);
  }
  return { ended };
});
