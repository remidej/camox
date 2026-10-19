import { Effect } from "effect";

import type { MergeText, Merges, TranslationText, Translations } from "../../lib/ai-model";
import type { Bookkeeping, Values } from "./bookkeeping";
import { type MergeUnit, mergeUnitsOf, type Shape, textsOf, type UnitTexts } from "./texts";

// How a translation job brings a localization up to date with its source: a three-way merge,
// unit by unit, from the localization's bookkeeping, in code wherever possible. Bookkeeping holds
// the previous source, the source the localization was last translated from, and the previous
// output, what Camox wrote from it. The current value is what the localization holds now.
//
// - A unit whose source equals the previous source keeps its current value.
// - A unit whose source changed, and whose current value is still the previous output, follows
//   the source: text is translated again, any other value copied. Only these go to the model.
// - A unit both changed keeps the localization's intent: text goes to the model's merge, with
//   its previous source, previous output, source and current value; any other value keeps the
//   current one.
//
// A localization without bookkeeping follows its source in every unit.

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
  // The last sync, when there's a localization to merge with it.
  const previous = current && bookkeeping;
  const values = structuredClone(current ?? source);
  // What Camox wrote, where it differs from what the localization holds.
  const outputs: [MergeUnit, unknown][] = [];
  const toTranslate: TranslationText[] = [];
  const toMerge: MergeText[] = [];
  const finishes: ((translations: Translations, merges: Merges) => void)[] = [];

  const rows = [
    source,
    ...(current ? [current] : []),
    ...(previous ? [previous.source, previous.output] : []),
  ];
  for (const unit of mergeUnitsOf(shape, rows)) {
    const sourceValue = unit.get(source);
    if (previous && sameValue(sourceValue, unit.get(previous.source))) {
      outputs.push([unit, unit.get(previous.output)]);
      continue;
    }
    const currentValue = current && unit.get(current);
    // Whether the localization still holds what Camox wrote, so it follows the source.
    const followsSource = !previous || sameValue(currentValue, unit.get(previous.output));
    const sourceTexts = textsOf(unit, sourceValue);
    if (!sourceTexts) {
      if (followsSource) unit.set(values, sourceValue);
      else outputs.push([unit, sourceValue]);
      continue;
    }
    toTranslate.push(...sourceTexts.texts);
    if (followsSource) {
      finishes.push((translations) => unit.set(values, sourceTexts.rebuild(translations)));
      continue;
    }
    // Both changed: the localization keeps what the merge makes of the two, and Camox's own
    // translation of the source is kept for the next merge.
    finishes.push((translations) => outputs.push([unit, sourceTexts.rebuild(translations)]));
    const conflict = conflictOf(unit, sourceTexts, previous!, currentValue);
    if (!conflict) continue;
    toMerge.push(...conflict.texts);
    finishes.push((translations, merges) =>
      unit.set(values, conflict.merged(translations, merges)),
    );
  }

  const translations = toTranslate.length === 0 ? {} : yield* model.translate(toTranslate);
  const merges = toMerge.length === 0 ? {} : yield* model.merge(toMerge);
  for (const finish of finishes) finish(translations, merges);
  const output = structuredClone(values);
  for (const [unit, value] of outputs) unit.set(output, value);
  return { values, output } satisfies Merged;
});

/**
 * Gives a merged localization the units someone changed by hand in `edited`, another copy of it:
 * those whose value differs from what Camox wrote there (`written`). What Camox wrote stays the
 * merge's, so they keep counting as hand edits.
 */
export function keepEdits(shape: Shape, merged: Merged, edited: Values, written: Values) {
  for (const unit of mergeUnitsOf(shape, [merged.values, edited, written])) {
    const value = unit.get(edited);
    if (!sameValue(value, unit.get(written))) unit.set(merged.values, structuredClone(value));
  }
}

/**
 * The bookkeeping to merge `edited`, a localization with none of its own, from: what Camox wrote
 * in another copy of it (`written`), with no previous source wherever `edited` holds something
 * else. Those units count as edited by hand, so the merge keeps them, with the model where the
 * source holds text, instead of translating over them.
 */
export function asEditedByHand(shape: Shape, edited: Values, written: Bookkeeping): Bookkeeping {
  const source = structuredClone(written.source);
  for (const unit of mergeUnitsOf(shape, [edited, written.source, written.output])) {
    if (!sameValue(unit.get(edited), unit.get(written.output))) unit.set(source, undefined);
  }
  return { source, output: written.output };
}

/**
 * What a unit both the source and the localization changed asks the merge, and how its answers
 * make the unit's value; undefined when the current value holds no text, or doesn't line up with
 * the source and isn't rich text, which keeps the current value.
 *
 * Texts that line up key by key, such as each text node of rich text whose trees match, are
 * merged one by one, each by the three-way rule. Rich text whose trees no longer line up is
 * merged whole, as Markdown.
 */
function conflictOf(
  unit: MergeUnit,
  source: UnitTexts,
  previous: Bookkeeping,
  currentValue: unknown,
) {
  const current = textsOf(unit, currentValue);
  if (!current) return undefined;
  const previousSource = textsOf(unit, unit.get(previous.source));
  const previousOutput = textsOf(unit, unit.get(previous.output));
  const linedUp = [previousSource, previousOutput, current].every(
    (texts) => !texts || texts.structure === source.structure,
  );
  if (!linedUp) {
    return wholeConflictOf(unit, source, previousSource, previousOutput, current, currentValue);
  }

  const byKey = (texts: UnitTexts | undefined) =>
    new Map(texts?.texts.map(({ key, text }) => [key, text]));
  const previousSources = byKey(previousSource);
  const previousOutputs = byKey(previousOutput);
  const currents = byKey(current);
  const texts: MergeText[] = [];
  const following: string[] = [];
  for (const { key, text, format } of source.texts) {
    if (text === previousSources.get(key)) continue;
    const currentText = currents.get(key);
    if (currentText === undefined || currentText === previousOutputs.get(key)) {
      following.push(key);
      continue;
    }
    texts.push({
      key,
      format,
      previousSource: previousSources.get(key) ?? "",
      previousTranslation: previousOutputs.get(key) ?? "",
      source: text,
      current: currentText,
    });
  }
  return {
    texts,
    merged: (translations: Translations, merges: Merges) =>
      current.rebuild({
        ...Object.fromEntries(
          following.flatMap((key) => (key in translations ? [[key, translations[key]]] : [])),
        ),
        ...merges,
      }),
  };
}

/** A rich text unit merged as one Markdown text, for trees that no longer line up. */
function wholeConflictOf(
  unit: MergeUnit,
  source: UnitTexts,
  previousSource: UnitTexts | undefined,
  previousOutput: UnitTexts | undefined,
  current: UnitTexts,
  currentValue: unknown,
) {
  const sourceWhole = source.whole;
  const currentWhole = current.whole;
  if (!sourceWhole || !currentWhole) return undefined;
  const text: MergeText = {
    key: unit.key,
    format: "markdown",
    previousSource: previousSource?.whole?.text ?? "",
    previousTranslation: previousOutput?.whole?.text ?? "",
    source: sourceWhole.text,
    current: currentWhole.text,
  };
  return {
    texts: [text],
    // A missing answer keeps the current value.
    merged: (_translations: Translations, merges: Merges) =>
      unit.key in merges ? currentWhole.rebuild(merges[unit.key]) : currentValue,
  };
}
