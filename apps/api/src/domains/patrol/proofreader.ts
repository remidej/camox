import type { FindingAbout } from "@camox/api-contract/patrol";
import { and, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { PatrolJob } from "../../lib/ai-job-queue";
import { AiModel, type ProofreadText } from "../../lib/ai-model";
import { attributedToCamox } from "../../lib/ai-usage";
import { Journal } from "../../lib/journal";
import { scheduleInBackground } from "../../lib/schedule-in-background";
import { camoxContext } from "../drafts/camox-context";
import type { Holder } from "../drafts/content-checks";
import * as overlay from "../drafts/overlay";
import { type Draft, draftOf, inLocale } from "../drafts/scope";
import { defaultLocaleTag } from "../locales/default-locale";
import { readBookkeeping, readStoredBookkeeping, valuesOf } from "../translations/bookkeeping";
import { sameValue } from "../translations/merge";
import { listedChanges } from "../translations/review";
import { type MergeUnit, mergeUnitsOf, textsOf } from "../translations/texts";
import { fieldOfKey, findSentence, holds, type TextAbout } from "./about";
import { holdersOf, liveHoldersOf, liveLocaleTags } from "./content";
import {
  type CheckedSubject,
  isCheckedEntity,
  type RaisedFinding,
  resolveFinding,
} from "./findings";
import type { CheckRequest, Checker, LivePatrol } from "./patrollers";
import { writeInScope } from "./reports";
import { findings, patrolChecks, proofreadingRequests } from "./schema";
import { conflictInScope, inWorkScope, type WorkScope } from "./scopes";
import type { PendingWorkOf } from "./working";

// The Proofreader (ADR 0034): it reads the text people wrote in what a draft changed since its
// last check, and raises each spelling or clear grammar mistake the model finds as a finding,
// with its fix. Each write records the subjects it wrote as requests; a check reads them, and
// settles them once it's done, even when it failed.

type Content = Record<string, unknown>;

/** The rows each statement writes: D1 binds at most 100 parameters per statement. */
const ROWS_PER_INSERT = 12;

/**
 * Records the subjects a draft's next check reads: what a write wrote, or, when the review opens
 * on changes the last check didn't read and nothing is requested, what changed since it.
 */
export const requestProofreading = Effect.fn("proofreader.request")(function* (
  db: Database,
  draft: Draft,
  request: CheckRequest,
) {
  const asked = request === "stale" ? yield* changedSinceLastCheck(db, draft) : request;
  yield* recordRequests(db, { projectId: draft.projectId, draftId: draft.id }, asked);
});

/**
 * Records subjects the next check of a scope reads. Requests show nowhere until a check starts
 * on them: recording one refreshes nothing. A draft that ended meanwhile takes none.
 */
const recordRequests = Effect.fn("proofreader.recordRequests")(function* (
  db: Database,
  scope: WorkScope,
  asked: readonly CheckedSubject[],
) {
  // A unit of work writing a subject twice requests it once.
  const subjects = [
    ...new Map(asked.map((subject) => [JSON.stringify(subject), subject])).values(),
  ];
  if (subjects.length === 0) return;
  const requestedAt = Date.now();
  const rows = subjects.map(({ entity, id, locale }) => ({
    ...scope,
    entity,
    entityId: id,
    locale,
    requestedAt,
    startedAt: null,
  }));
  const key = [
    proofreadingRequests.entity,
    proofreadingRequests.entityId,
    proofreadingRequests.locale,
  ];
  const conflict = conflictInScope(proofreadingRequests, scope.draftId, key);
  const write = async () => {
    for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
      await db
        .insert(proofreadingRequests)
        .values(rows.slice(start, start + ROWS_PER_INSERT))
        .onConflictDoUpdate({ ...conflict, set: { requestedAt, startedAt: null } });
    }
  };
  yield* Effect.tryPromise(write).pipe(
    Effect.catch((error) => Effect.logWarning("[proofreader] request not recorded", error)),
  );
});

/**
 * The subjects a draft changed since the Proofreader last checked it, or every one it changed if
 * it never did; none while some are requested already.
 */
const changedSinceLastCheck = Effect.fn("proofreader.changedSinceLastCheck")(function* (
  db: Database,
  draft: Draft,
) {
  const requested = yield* Effect.promise(() =>
    db
      .select({ rowId: proofreadingRequests.rowId })
      .from(proofreadingRequests)
      .where(eq(proofreadingRequests.draftId, draft.id))
      .limit(1),
  );
  if (requested.length > 0) return [];
  const last = yield* Effect.promise(() =>
    db
      .select({ checkedAt: patrolChecks.checkedAt })
      .from(patrolChecks)
      .where(and(eq(patrolChecks.draftId, draft.id), eq(patrolChecks.patroller, "proofreader")))
      .get(),
  );
  const since = last?.checkedAt ?? -Infinity;
  const changes = yield* listedChanges(db, draft, yield* overlay.changesOf(db, draft));
  return changes.flatMap((change): CheckedSubject[] => {
    const locale = overlay.localeOfRow(change.row);
    const updatedAt = (change.row as { updatedAt?: unknown }).updatedAt;
    if (!isCheckedEntity(change.entity) || locale === null) return [];
    if (typeof updatedAt === "number" && updatedAt <= since) return [];
    return [{ entity: change.entity, id: change.row.id, locale }];
  });
});

/**
 * Ends the requests a check started on, once it's done. A request since its start stays, as does
 * one it left for the next check. One check of a draft runs at a time.
 */
export const settleProofreading = (db: Database, draft: Draft) =>
  settleRequests(db, { projectId: draft.projectId, draftId: draft.id });

const settleRequests = Effect.fn("proofreader.settle")(function* (db: Database, scope: WorkScope) {
  yield* writeInScope(
    db,
    scope,
    () =>
      db.delete(proofreadingRequests).where(
        and(
          inWorkScope(proofreadingRequests, scope),
          // A request since its start reset it: it stays for the next check.
          isNotNull(proofreadingRequests.startedAt),
          lte(proofreadingRequests.requestedAt, proofreadingRequests.startedAt),
        ),
      ),
    "report",
  );
});

/** What the Proofreader is reading: the requests a check started on. */
export const pendingProofreading: PendingWorkOf = (db, projectId, scopes) => {
  const drafts = scopes.filter((scope) => scope !== null);
  const inScopes = [
    ...(scopes.includes(null) ? [isNull(proofreadingRequests.draftId)] : []),
    ...(drafts.length > 0 ? [inArray(proofreadingRequests.draftId, drafts)] : []),
  ];
  if (inScopes.length === 0) return Effect.succeed([]);
  return Effect.promise(() =>
    db
      .select({
        entity: proofreadingRequests.entity,
        id: proofreadingRequests.entityId,
        locale: proofreadingRequests.locale,
        requestedAt: proofreadingRequests.requestedAt,
      })
      .from(proofreadingRequests)
      .where(
        and(
          eq(proofreadingRequests.projectId, projectId),
          or(...inScopes),
          isNotNull(proofreadingRequests.startedAt),
        ),
      ),
  );
};

/** Starts reading a scope's requests: the subjects its check reads. */
const startRequests = Effect.fn("proofreader.startRequests")(function* (
  db: Database,
  scope: WorkScope,
) {
  const startedAt = Date.now();
  let started: CheckedSubject[] = [];
  yield* writeInScope(
    db,
    scope,
    async () => {
      const rows = await db
        .update(proofreadingRequests)
        .set({ startedAt })
        .where(inWorkScope(proofreadingRequests, scope))
        .returning({
          entity: proofreadingRequests.entity,
          id: proofreadingRequests.entityId,
          locale: proofreadingRequests.locale,
        });
      started = rows.flatMap(({ entity, ...rest }) =>
        isCheckedEntity(entity) ? [{ entity, ...rest }] : [],
      );
    },
    "report",
  );
  return started;
});

/** One text of a holder people wrote, keyed as the model is asked it. */
type WrittenText = { key: string; field: string; text: string };

/**
 * The texts people wrote in a holder, by key. In a draft, those in the fields it changed from
 * Live's, in a holder it changed; on Live (`draft` null), all of them. In a locale other than the
 * default one, only those edited by hand: what its bookkeeping says Camox wrote is the
 * Translator's.
 */
const writtenTexts = Effect.fn("proofreader.writtenTexts")(function* (
  db: Database,
  draft: Draft | null,
  holder: Holder,
  defaultTag: string | undefined,
) {
  if (draft && !holder.changed) return [];
  const table = overlay.contentTableOf(holder.entity);
  const live = draft && (yield* overlay.get(db, inLocale(null, holder.locale), table, holder.id));
  const bookkeeping =
    holder.locale === defaultTag
      ? undefined
      : draft
        ? yield* readBookkeeping(db, inLocale(draft, holder.locale), holder.entity, holder.id)
        : yield* readStoredBookkeeping(
            db,
            { draftId: null, locale: holder.locale },
            holder.entity,
            holder.id,
          );
  const output = bookkeeping?.output;
  if (holder.locale !== defaultTag && !output) return [];
  const values = { content: holder.content };
  const before = live && valuesOf(live);
  return mergeUnitsOf({ contentSchema: holder.schema }, [values]).flatMap((unit) => {
    const value = unit.get(values);
    if (before && sameValue(value, unit.get(before))) return [];
    if (output && sameValue(value, unit.get(output))) return [];
    return plainTexts(unit, value).map(({ key, text }): WrittenText => ({
      key,
      field: fieldOfKey(key),
      text,
    }));
  });
});

/** A unit's texts people read: not artifacts' HTML sources, nor URL path segments. */
const plainTexts = (unit: MergeUnit, value: unknown) =>
  (textsOf(unit, value)?.texts ?? []).filter((text) => text.format === "plain");

/** The sentence of `text` that the words at `index` are in. */
function sentenceAt(text: string, index: number, length: number, locale: string) {
  const segments = [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text)];
  const first = segments.findLast((segment) => segment.index <= index) ?? segments[0]!;
  const last = segments.findLast((segment) => segment.index < index + length) ?? segments.at(-1)!;
  return text.slice(first.index, last.index + last.segment.length).trim();
}

/**
 * A finding's identity: its subject, field and locale, the flagged text and its sentence. A
 * dismissal covers that one occurrence, until its sentence changes.
 */
const identityOf = (subject: CheckedSubject, field: string, text: string, sentence: string) =>
  JSON.stringify([subject.entity, subject.id, subject.locale, field, text, sentence]);

/** Proofreads one holder's texts: its findings, or undefined when the model failed. */
const proofreadHolder = Effect.fn("proofreader.proofreadHolder")(function* (
  holder: Holder,
  texts: readonly WrittenText[],
) {
  if (texts.length === 0) return [];
  const model = yield* AiModel;
  const asked: ProofreadText[] = texts.map(({ key, text }) => ({ key, text }));
  const fixes = yield* model
    .proofread({ locale: holder.locale, texts: asked })
    .pipe(Effect.catchTag("AiCallError", () => Effect.succeed(undefined)));
  if (!fixes) return undefined;
  const byKey = new Map(texts.map((text) => [text.key, text]));
  const subject = { entity: holder.entity, id: holder.id, locale: holder.locale };
  return fixes.flatMap((fix): RaisedFinding[] => {
    const written = byKey.get(fix.key);
    const index = written?.text.indexOf(fix.original) ?? -1;
    if (!written || index < 0) return [];
    const sentence = sentenceAt(written.text, index, fix.original.length, holder.locale);
    const about: FindingAbout = { kind: fix.kind, text: fix.original, sentence };
    return [
      {
        ...subject,
        field: written.field,
        identity: identityOf(subject, written.field, fix.original, sentence),
        about,
        fix: { kind: "replaceText", replacement: fix.replacement },
      },
    ];
  });
});

const sameSubject = (a: CheckedSubject, b: CheckedSubject) =>
  a.entity === b.entity && a.id === b.id && a.locale === b.locale;

/**
 * Proofreads the text people wrote in the subjects requested in a scope, a draft or Live (`draft`
 * null). A subject the model failed on stays requested, and the check isn't complete.
 */
const proofreadRequested = Effect.fn("proofreader.proofreadRequested")(function* (
  db: Database,
  scope: WorkScope,
  requested: readonly CheckedSubject[],
) {
  const ctx = camoxContext(db);
  const draft =
    scope.draftId === null ? null : draftOf({ id: scope.draftId, projectId: scope.projectId });
  const defaultTag = yield* defaultLocaleTag(db, scope.projectId);
  const found: RaisedFinding[] = [];
  const checked: CheckedSubject[] = [];
  const failed: CheckedSubject[] = [];
  for (const locale of new Set(requested.map((subject) => subject.locale))) {
    const holders = draft
      ? yield* holdersOf(ctx, draft, locale)
      : yield* liveHoldersOf(ctx, scope.projectId, locale);
    for (const subject of requested.filter((candidate) => candidate.locale === locale)) {
      const holder = holders.find((candidate) => sameSubject(candidate, subject));
      const texts = holder ? yield* writtenTexts(db, draft, holder, defaultTag) : [];
      const raised = holder ? yield* proofreadHolder(holder, texts) : [];
      if (raised === undefined) {
        failed.push(subject);
        continue;
      }
      checked.push(subject);
      found.push(...raised);
    }
  }
  if (failed.length > 0) yield* requestAgain(db, scope, failed);
  return { found, checked, complete: failed.length === 0 };
});

/**
 * The Proofreader's check of a draft: the text people wrote in the subjects requested since its
 * last check.
 */
export const checkSpelling: Checker = (db, draft) => {
  const scope = { projectId: draft.projectId, draftId: draft.id };
  return Effect.gen(function* () {
    return yield* proofreadRequested(db, scope, yield* startRequests(db, scope));
  }).pipe(attributedToCamox(db, { ...scope, patroller: "proofreader" }), Effect.orDie);
};

/** Whether the Proofreader has proofread a project's Live: it does once it arrives. */
const hasProofreadLive = Effect.fn("proofreader.hasProofreadLive")(function* (
  db: Database,
  projectId: number,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ checkedAt: patrolChecks.checkedAt })
      .from(patrolChecks)
      .where(
        and(
          eq(patrolChecks.projectId, projectId),
          isNull(patrolChecks.draftId),
          eq(patrolChecks.patroller, "proofreader"),
        ),
      )
      .get(),
  );
  return row !== undefined;
});

/** Every subject Live reads, in each of its locales. */
const everySubjectOnLive = Effect.fn("proofreader.everySubjectOnLive")(function* (
  db: Database,
  projectId: number,
) {
  const ctx = camoxContext(db);
  const subjects: CheckedSubject[] = [];
  for (const tag of yield* liveLocaleTags(ctx, projectId)) {
    for (const { entity, id, locale } of yield* liveHoldersOf(ctx, projectId, tag)) {
      subjects.push({ entity, id, locale });
    }
  }
  return subjects;
});

/**
 * Resolves the Proofreader's findings on Live that Live no longer holds, as after a publish that
 * fixed them: no proofreading needed, only their sentence with the flagged text, gone.
 */
const closeFixedOnLive = Effect.fn("proofreader.closeFixedOnLive")(function* (
  db: Database,
  projectId: number,
) {
  const open = yield* Effect.promise(() =>
    db
      .select()
      .from(findings)
      .where(
        and(
          eq(findings.projectId, projectId),
          isNull(findings.draftId),
          eq(findings.patroller, "proofreader"),
        ),
      ),
  );
  const ctx = camoxContext(db);
  for (const locale of new Set(open.map((finding) => finding.locale))) {
    const holders = yield* liveHoldersOf(ctx, projectId, locale);
    for (const finding of open.filter((candidate) => candidate.locale === locale)) {
      const holder = holders.find(
        (candidate) => candidate.entity === finding.entity && candidate.id === finding.entityId,
      );
      if (!holder || !holds(holder, finding)) yield* resolveFinding(db, finding);
    }
  }
});

/**
 * The Proofreader's patrol of Live (ADR 0034): it's asleep there, except to read what releases no
 * draft published wrote since, and all of Live once, when it first arrives in the project. Nothing
 * to read, it stays asleep: `null`. Its findings there that a publish fixed close either way.
 */
export const proofreadLive: LivePatrol = (db, projectId) => {
  const scope = { projectId, draftId: null };
  return Effect.gen(function* () {
    yield* closeFixedOnLive(db, projectId);
    const arriving = !(yield* hasProofreadLive(db, projectId));
    if (arriving) yield* recordRequests(db, scope, yield* everySubjectOnLive(db, projectId));
    const requested = yield* startRequests(db, scope);
    if (requested.length === 0 && !arriving) return null;
    const { found, checked } = yield* proofreadRequested(db, scope, requested);
    return { found, checked };
  }).pipe(
    Effect.ensuring(settleRequests(db, scope)),
    attributedToCamox(db, { ...scope, patroller: "proofreader" }),
    Effect.orDie,
  );
};

/** How long Live stays unchanged after a release's write before the Proofreader reads it. */
export const RELEASE_IDLE_MS = 60_000;

/**
 * Requests the Proofreader's reading of what a release no draft published wrote on Live, in each
 * project: it reads it once the release is done writing. Runs once the work succeeded, with its
 * journal. A draft's publish writes Live without it: its own check read what it changed.
 */
export const proofreadReleaseWrites = Effect.fn("proofreader.proofreadReleaseWrites")(function* () {
  const { db, changes } = yield* Journal;
  if (!db) return;
  const byProject = new Map<number, CheckedSubject[]>();
  for (const change of changes) {
    if (change.kind !== "localizedWrite" || change.draftId !== null) continue;
    if (!isCheckedEntity(change.entity)) continue;
    const { entity, id, locale } = change;
    byProject.set(change.projectId, [
      ...(byProject.get(change.projectId) ?? []),
      { entity, id, locale },
    ]);
  }
  for (const [projectId, subjects] of byProject) {
    yield* recordRequests(db, { projectId, draftId: null }, subjects);
    const job: PatrolJob = { kind: "patrol", patrollers: ["proofreader"], projectId };
    // One that can't be scheduled stays requested: the next patrol of Live reads it.
    yield* scheduleInBackground(job, RELEASE_IDLE_MS);
  }
});

/** Leaves subjects requested, not started, for the next check: its model call failed. */
const requestAgain = Effect.fn("proofreader.requestAgain")(function* (
  db: Database,
  scope: WorkScope,
  subjects: readonly CheckedSubject[],
) {
  for (const { entity, id, locale } of subjects) {
    yield* Effect.promise(() =>
      db
        .update(proofreadingRequests)
        .set({ startedAt: null })
        .where(
          and(
            inWorkScope(proofreadingRequests, scope),
            eq(proofreadingRequests.entity, entity),
            eq(proofreadingRequests.entityId, id),
            eq(proofreadingRequests.locale, locale),
          ),
        ),
    );
  }
});

/**
 * A field's value with the flagged text replaced in its sentence, keeping the formatting around
 * it, or undefined when no text of the field holds that sentence any more.
 */
export function withReplacement(
  holder: Pick<Holder, "schema" | "content">,
  field: string,
  about: TextAbout,
  replacement: string,
): unknown {
  const values = { content: { ...(holder.content as Content) } };
  for (const unit of mergeUnitsOf({ contentSchema: holder.schema }, [values])) {
    const value = unit.get(values);
    const texts = textsOf(unit, value);
    const hit = texts && findSentence(texts, field, about);
    if (!texts || !hit) continue;
    const fixed = about.sentence.replace(about.text, replacement);
    unit.set(values, texts.rebuild({ [hit.key]: hit.text.replace(about.sentence, fixed) }));
    return values.content[field];
  }
  return undefined;
}
