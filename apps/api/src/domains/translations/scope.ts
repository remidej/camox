import { Effect } from "effect";

import type { Database } from "../../db";
import { AiModel, type TranslationText, type Translations } from "../../lib/ai-model";
import { type Draft, type DraftInLocale, inLocale } from "../drafts/scope";
import { draftLocales } from "./service";

/** Where a job reads and writes: its draft in the default locale, and in the job's locale. */
export type TranslationScope = { draft: Draft; target: DraftInLocale; from: string; to: string };

/**
 * Where a job translating into `locale` reads and writes, unless the draft has no default locale
 * or doesn't read `locale` (anymore).
 */
export const translationScope = Effect.fn("translation.scope")(function* (
  db: Database,
  draft: Draft,
  locale: string,
) {
  const { defaultTag, others } = yield* draftLocales(db, draft);
  if (defaultTag === undefined || !others.includes(locale)) return undefined;
  const scope: TranslationScope = {
    draft,
    target: inLocale(draft, locale),
    from: defaultTag,
    to: locale,
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
  return yield* model.translate({ from: scope.from, to: scope.to, texts });
});
