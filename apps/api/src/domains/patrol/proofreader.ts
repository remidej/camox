import type { FindingAbout } from "@camox/api-contract/patrol";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { AiModel, type ProofreadText } from "../../lib/ai-model";
import { attributedToCamox } from "../../lib/ai-usage";
import { camoxContext } from "../drafts/camox-context";
import { type Holder, holdersOf } from "../drafts/content-checks";
import * as overlay from "../drafts/overlay";
import { type Draft, inLocale } from "../drafts/scope";
import { defaultLocaleTag } from "../locales/default-locale";
import { readBookkeeping, valuesOf } from "../translations/bookkeeping";
import { sameValue } from "../translations/merge";
import { listedChanges } from "../translations/review";
import { type MergeUnit, mergeUnitsOf, textsOf, type UnitTexts } from "../translations/texts";
import { type CheckedSubject, isCheckedEntity, type RaisedFinding } from "./findings";
import type { CheckRequest, Checker } from "./patrollers";
import { writeInScope } from "./reports";
import { patrolChecks, proofreadingRequests } from "./schema";
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
  // A unit of work writing a subject twice requests it once.
  const subjects = [
    ...new Map(asked.map((subject) => [JSON.stringify(subject), subject])).values(),
  ];
  if (subjects.length === 0) return;
  const requestedAt = Date.now();
  const rows = subjects.map(({ entity, id, locale }) => ({
    projectId: draft.projectId,
    draftId: draft.id,
    entity,
    entityId: id,
    locale,
    requestedAt,
    startedAt: null,
  }));
  // Requests show nowhere until a check starts on them: writing one refreshes nothing. A draft
  // that ended meanwhile takes none.
  const write = async () => {
    for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
      await db
        .insert(proofreadingRequests)
        .values(rows.slice(start, start + ROWS_PER_INSERT))
        .onConflictDoUpdate({
          target: [
            proofreadingRequests.draftId,
            proofreadingRequests.entity,
            proofreadingRequests.entityId,
            proofreadingRequests.locale,
          ],
          set: { requestedAt, startedAt: null },
        });
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
export const settleProofreading = Effect.fn("proofreader.settle")(function* (
  db: Database,
  draft: Draft,
) {
  yield* writeInScope(db, { projectId: draft.projectId, draftId: draft.id }, () =>
    db.delete(proofreadingRequests).where(
      and(
        eq(proofreadingRequests.draftId, draft.id),
        // A request since its start reset it: it stays for the next check.
        isNotNull(proofreadingRequests.startedAt),
        lte(proofreadingRequests.requestedAt, proofreadingRequests.startedAt),
      ),
    ),
  );
});

/** What the Proofreader is reading: the requests a check started on. */
export const pendingProofreading: PendingWorkOf = (db, projectId, scopes) => {
  const drafts = scopes.filter((scope) => scope !== null);
  if (drafts.length === 0) return Effect.succeed([]);
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
          inArray(proofreadingRequests.draftId, drafts),
          isNotNull(proofreadingRequests.startedAt),
        ),
      ),
  );
};

/** Starts reading a draft's requests: the subjects its check reads. */
const startRequests = Effect.fn("proofreader.startRequests")(function* (
  db: Database,
  draft: Draft,
) {
  const startedAt = Date.now();
  let started: CheckedSubject[] = [];
  yield* writeInScope(db, { projectId: draft.projectId, draftId: draft.id }, async () => {
    const rows = await db
      .update(proofreadingRequests)
      .set({ startedAt })
      .where(eq(proofreadingRequests.draftId, draft.id))
      .returning({
        entity: proofreadingRequests.entity,
        id: proofreadingRequests.entityId,
        locale: proofreadingRequests.locale,
      });
    started = rows.flatMap(({ entity, ...rest }) =>
      isCheckedEntity(entity) ? [{ entity, ...rest }] : [],
    );
  });
  return started;
});

/** One text of a holder people wrote, keyed as the model is asked it. */
type WrittenText = { key: string; field: string; text: string };

/**
 * The texts people wrote in a holder the draft changed, by key: in the fields it changed from
 * Live's. In a locale other than the default one, only those edited by hand: what its bookkeeping
 * says Camox wrote is the Translator's.
 */
const writtenTexts = Effect.fn("proofreader.writtenTexts")(function* (
  db: Database,
  draft: Draft,
  holder: Holder,
  defaultTag: string | undefined,
) {
  if (!holder.changed) return [];
  const table = overlay.contentTableOf(holder.entity);
  const live = yield* overlay.get(db, inLocale(null, holder.locale), table, holder.id);
  const output =
    holder.locale === defaultTag
      ? undefined
      : (yield* readBookkeeping(db, inLocale(draft, holder.locale), holder.entity, holder.id))
          ?.output;
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

/** A text key's field: keys are the field's name, then its part, such as a text node's place. */
const fieldOfKey = (key: string) => key.split("/")[0]!;

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
 * The Proofreader's check of a draft: the text people wrote in the subjects requested since its
 * last check. A subject the model failed on stays requested, and the check isn't complete.
 */
export const checkSpelling: Checker = (db, draft) =>
  Effect.gen(function* () {
    const requested = yield* startRequests(db, draft);
    const ctx = camoxContext(db);
    const defaultTag = yield* defaultLocaleTag(db, draft.projectId);
    const found: RaisedFinding[] = [];
    const checked: CheckedSubject[] = [];
    const failed: CheckedSubject[] = [];
    for (const locale of new Set(requested.map((subject) => subject.locale))) {
      const holders = yield* holdersOf(ctx, draft, locale);
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
    if (failed.length > 0) yield* requestAgain(db, draft, failed);
    return { found, checked, complete: failed.length === 0 };
  }).pipe(
    attributedToCamox(db, {
      projectId: draft.projectId,
      draftId: draft.id,
      patroller: "proofreader",
    }),
    Effect.orDie,
  );

/** Leaves subjects requested, not started, for the next check: its model call failed. */
const requestAgain = Effect.fn("proofreader.requestAgain")(function* (
  db: Database,
  draft: Draft,
  subjects: readonly CheckedSubject[],
) {
  for (const { entity, id, locale } of subjects) {
    yield* Effect.promise(() =>
      db
        .update(proofreadingRequests)
        .set({ startedAt: null })
        .where(
          and(
            eq(proofreadingRequests.draftId, draft.id),
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
  about: { text: string; sentence: string },
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

/** The text of a unit in `field` holding the sentence, with the flagged text still in it. */
const findSentence = (
  texts: UnitTexts,
  field: string,
  about: { text: string; sentence: string },
) =>
  about.sentence.includes(about.text)
    ? texts.texts.find(
        (text) =>
          text.format === "plain" &&
          fieldOfKey(text.key) === field &&
          text.text.includes(about.sentence),
      )
    : undefined;
