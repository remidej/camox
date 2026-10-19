import { Effect } from "effect";

import type { MergeText, Merges, TranslationText, Translations } from "../../lib/ai-model";
import type { Bookkeeping, Values } from "./bookkeeping";
import { type Field, fieldsFor, type Shape, textsOf } from "./texts";

// How a translation job brings a localization up to date with its source (ADR 0015): a
// three-way merge, field by field, from the localization's bookkeeping, in code wherever
// possible.
//
// - A field the source didn't change keeps the localization's value.
// - A field the source changed, which the localization still holds as Camox wrote it, follows
//   the source: text is translated again, any other value copied. Only these go to the model.
// - A field both changed keeps the localization's intent: text goes to the model's merge, with
//   the field's source and translation when they were last in sync, its source now and the
//   localization now; any other value keeps the localization's.
//
// A localization without bookkeeping follows its source in every field.

/** What a job asks the model: translations of texts, and merges of hand-edited texts. */
export type MergeModel<E, R> = {
  translate: (texts: TranslationText[]) => Effect.Effect<Translations, E, R>;
  merge: (texts: MergeText[]) => Effect.Effect<Merges, E, R>;
};

/** A merged localization, and what Camox wrote from its source, for its bookkeeping. */
export type Merged = { values: Values; output: Values };

/** Whether two JSON values are the same, whatever the order of their keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!sameValue(left[key], right[key])) return false;
  return true;
}

/**
 * Merges a localization's `current` values with its changed `source`, from the bookkeeping of
 * their last sync. Without a localization or bookkeeping, the source is translated whole.
 */
export const mergeLocalization = Effect.fn("translation.merge")(function* <E, R>(
  shape: Shape,
  model: MergeModel<E, R>,
  source: Values,
  current: Values | undefined,
  bookkeeping: Bookkeeping | undefined,
) {
  const base = current && bookkeeping;
  const values = structuredClone(current ?? source);
  // What Camox wrote, where it differs from what the localization holds.
  const outputs: [Field, unknown][] = [];
  const toTranslate: TranslationText[] = [];
  const toMerge: MergeText[] = [];
  const finishes: ((translations: Translations, merges: Merges) => void)[] = [];

  const rows = [source, ...(current ? [current] : []), ...(base ? [base.source, base.output] : [])];
  for (const field of fieldsFor(shape, rows)) {
    const now = field.get(source);
    if (base && sameValue(now, field.get(base.source))) {
      outputs.push([field, field.get(base.output)]);
      continue;
    }
    const held = current && field.get(current);
    const follows = !base || sameValue(held, field.get(base.output));
    const texts = textsOf(field, now);
    if (!texts) {
      if (follows) field.set(values, now);
      else outputs.push([field, now]);
      continue;
    }
    toTranslate.push(...texts.texts);
    if (follows) {
      finishes.push((translations) => field.set(values, texts.rebuild(translations)));
      continue;
    }
    // Both changed: the localization keeps what the merge makes of the two, and Camox's own
    // translation of the source is kept for the next merge.
    finishes.push((translations) => outputs.push([field, texts.rebuild(translations)]));
    const merge = conflictOf(field, texts, base!, held);
    if (!merge) continue;
    toMerge.push(...merge.texts);
    finishes.push((translations, merges) => field.set(values, merge.merged(translations, merges)));
  }

  const translations = toTranslate.length === 0 ? {} : yield* model.translate(toTranslate);
  const merges = toMerge.length === 0 ? {} : yield* model.merge(toMerge);
  for (const finish of finishes) finish(translations, merges);
  const output = structuredClone(values);
  for (const [field, value] of outputs) field.set(output, value);
  return { values, output } satisfies Merged;
});

/**
 * What a field both the source and the localization changed asks the merge, and how its answers
 * make the field's value; undefined when the four values don't line up as texts, which keeps the
 * localization's value. Rich text is merged node by node, each node by the three-way rule, when
 * its trees line up.
 */
function conflictOf(
  field: Field,
  now: NonNullable<ReturnType<typeof textsOf>>,
  base: Bookkeeping,
  held: unknown,
) {
  const previousSource = textsOf(field, field.get(base.source));
  const previousTranslation = textsOf(field, field.get(base.output));
  const current = textsOf(field, held);
  if (!previousSource || !previousTranslation || !current) return undefined;
  const all = [now, previousSource, previousTranslation, current];
  if (all.some((texts) => texts.structure !== now.structure)) return undefined;

  const byKey = (texts: typeof now) => new Map(texts.texts.map((text) => [text.key, text.text]));
  const [before, written, mine] = [previousSource, previousTranslation, current].map(byKey);
  const texts: MergeText[] = [];
  const follows: string[] = [];
  for (const { key, text, format } of now.texts) {
    if (text === before.get(key)) continue;
    const currentText = mine.get(key);
    if (currentText === undefined || currentText === written.get(key)) follows.push(key);
    else
      texts.push({
        key,
        format,
        previousSource: before.get(key) ?? "",
        previousTranslation: written.get(key) ?? "",
        source: text,
        current: currentText,
      });
  }
  return {
    texts,
    merged: (translations: Translations, merges: Merges) =>
      current.rebuild({
        ...Object.fromEntries(
          follows.flatMap((key) => (key in translations ? [[key, translations[key]]] : [])),
        ),
        ...merges,
      }),
  };
}
