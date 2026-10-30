import type {
  LocaleCount,
  PatrollerId,
  PatrollerWorking,
  ReportEntity,
} from "@camox/api-contract/patrol";

import { localeName } from "./localeOptions";

// What a patroller says it's on, as its profile card says it (ADR 0024).

type Phrase = {
  verb: string;
  /** The verb for a subject of an entity it does other work on. */
  verbFor?: Partial<Record<ReportEntity, string>>;
  locale: "into" | "in";
};

const PHRASES: Record<PatrollerId, Phrase> = {
  translator: { verb: "Translating", locale: "into" },
  // A file's SEO is its description: its alt text and filename.
  seoManager: { verb: "Writing SEO for", verbFor: { file: "Describing" }, locale: "in" },
  linkChecker: { verb: "Checking links in", locale: "in" },
};

/** The most locales a burst names; past it, the first are named and the rest counted. */
const NAMED_LOCALES = 3;

/** Joins parts as a list: "a", "a and b", "a, b and c". */
const listed = (parts: readonly string[]) =>
  parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/**
 * Each locale of a burst with its count, the first counted by the caller: "into German and 12
 * into Spanish", or with the rest counted together, "…and 9 into 2 other languages".
 */
function inLocales(locales: readonly LocaleCount[], preposition: string) {
  const named = locales.length > NAMED_LOCALES ? locales.slice(0, NAMED_LOCALES - 1) : locales;
  const rest = locales.slice(named.length);
  const parts = named.map(
    ({ locale, count }, index) =>
      `${index === 0 ? "" : `${count} `}${preposition} ${localeName(locale)}`,
  );
  if (rest.length > 0) {
    const count = rest.reduce((sum, each) => sum + each.count, 0);
    parts.push(`${count} ${preposition} ${rest.length} other languages`);
  }
  return listed(parts);
}

/**
 * What a patroller is working on: "Translating hero into Spanish" for one subject, "Translating
 * 38 items into German and 12 into Spanish" for a burst, counted in each locale.
 */
export function workingSentence(id: PatrollerId, working: PatrollerWorking): string {
  const phrase = PHRASES[id];
  const { subject, locales } = working;
  const verb = (subject && phrase.verbFor?.[subject.entity]) ?? phrase.verb;
  const first = locales[0]?.count ?? 0;
  const what = subject?.name ?? `${first} ${first === 1 ? "item" : "items"}`;
  return [verb, what, inLocales(locales, phrase.locale)].filter(Boolean).join(" ");
}
