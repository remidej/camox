import type { PatrollerId, PatrollerWorking } from "@camox/api-contract/patrol";

import { localeName } from "./localeOptions";

// What a working patroller is on, as its subtitle says it (ADR 0024).

type Phrase = { verb: string; locale: "into" | "in" };

const PHRASES: Record<PatrollerId, Phrase> = {
  translator: { verb: "Translating", locale: "into" },
  seoManager: { verb: "Writing SEO for", locale: "in" },
};

/**
 * What a patroller is working on: "Translating hero into Spanish" for one subject, "Translating
 * 38 items into German" for a burst.
 */
export function workingSentence(id: PatrollerId, working: PatrollerWorking): string {
  const phrase = PHRASES[id];
  // A file's SEO is its description: its alt text and filename.
  const verb = working.subject?.entity === "file" ? "Describing" : phrase.verb;
  const items = `${working.count} ${working.count === 1 ? "item" : "items"}`;
  const parts = [verb, working.subject?.name ?? items];
  if (working.locale) parts.push(phrase.locale, localeName(working.locale));
  return parts.join(" ");
}
