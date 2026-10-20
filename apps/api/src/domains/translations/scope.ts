import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslationJob } from "../../lib/ai-job-queue";
import {
  AiModel,
  type TranslationContext,
  type TranslationText,
  type Translations,
} from "../../lib/ai-model";
import { type Draft, type DraftInLocale, inLocale } from "../drafts/scope";
import { translationContext } from "./context";
import { draftLocales } from "./service";

/**
 * Where a job reads and writes: its draft in the default locale, and in the job's locale. With
 * what the model is told about the website it translates for.
 */
export type TranslationScope = {
  draft: Draft;
  target: DraftInLocale;
  from: string;
  to: string;
  context: TranslationContext;
};

/**
 * Where a job reads and writes, unless the draft has no default locale or doesn't read the job's
 * locale (anymore).
 */
export const translationScope = Effect.fn("translation.scope")(function* (
  db: Database,
  draft: Draft,
  job: TranslationJob,
) {
  const { locale } = job;
  const { defaultTag, others } = yield* draftLocales(db, draft);
  if (defaultTag === undefined || !others.includes(locale)) return undefined;
  const target = inLocale(draft, locale);
  // A job translating defaults has no source: its entity is only in the job's locale.
  const entityIn = job.source === "defaults" ? target : draft;
  const scope: TranslationScope = {
    draft,
    target,
    from: defaultTag,
    to: locale,
    context: yield* translationContext(db, draft, entityIn, job.entity, job.entityId),
  };
  return scope;
});

/** Asks the model for texts' translations, unless there are none to translate. */
export const translateTexts = Effect.fn("translation.texts")(function* (
  scope: TranslationScope,
  texts: TranslationText[],
) {
  if (texts.length === 0) return {} as Translations;
  const model = yield* AiModel;
  return yield* model.translate({ from: scope.from, to: scope.to, context: scope.context, texts });
});
