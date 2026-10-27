import type { ReportOutcome, ReportSummary, ReportVerb } from "@camox/api-contract/patrol";

import { localeName } from "./localeOptions";

// What a patroller's report says, as one sentence in the studio's language (ADR 0024).

type Phrase = { done: string; failed: string; locale?: "to" | "in" };

const PHRASES: Record<ReportVerb, Phrase> = {
  translated: { done: "Translated", failed: "Couldn't translate", locale: "to" },
  // A merge with Live's localization is a translation, as far as editors are concerned.
  mergedWithLive: { done: "Translated", failed: "Couldn't translate", locale: "to" },
  wroteSeo: { done: "Wrote SEO for", failed: "Couldn't write SEO for", locale: "in" },
  describedFile: { done: "Described", failed: "Couldn't describe", locale: "in" },
  publishedCatchUp: {
    done: "Published the caught-up translations",
    failed: "Couldn't publish the caught-up translations",
  },
};

/** A report as a sentence: "Wrote SEO for Pricing in German", or the text an AI wrote. */
export function reportSentence(summary: ReportSummary, outcome: ReportOutcome): string {
  if (summary.kind === "text") return summary.text;
  const phrase = PHRASES[summary.verb];
  const parts = [phrase[outcome]];
  if (summary.subject) parts.push(summary.subject.name);
  if (summary.locale && phrase.locale) parts.push(phrase.locale, localeName(summary.locale));
  return parts.join(" ");
}

/** The reports not shown, by locale: "…and 212 more in German, 3 in French". */
export function moreSentence(more: readonly { locale: string | null; count: number }[]): string {
  const counts = more.map(({ locale, count }, index) => {
    const where = locale === null ? "" : ` in ${localeName(locale)}`;
    return `${count}${index === 0 ? " more" : ""}${where}`;
  });
  return `…and ${counts.join(", ")}`;
}

const SHORT_UNITS: [string, number][] = [
  ["y", 365 * 24 * 60 * 60 * 1000],
  ["w", 7 * 24 * 60 * 60 * 1000],
  ["d", 24 * 60 * 60 * 1000],
  ["h", 60 * 60 * 1000],
  ["m", 60 * 1000],
];

/** How long ago a moment was, briefly: "now", "2m", "1h". */
export function shortTimeAgo(at: number, now = Date.now()): string {
  const elapsed = now - at;
  for (const [unit, size] of SHORT_UNITS) {
    if (elapsed >= size) return `${Math.floor(elapsed / size)}${unit}`;
  }
  return "now";
}
