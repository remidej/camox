import type { PatrollerDuty, PatrollerId } from "@camox/api-contract/patrol";

// How a patroller introduces itself on its profile card (ADR 0024): when it works where the editor
// is, as a tag, and what it does.

/** What each patroller does, wherever it works. */
const ABOUT: Record<PatrollerId, string> = {
  seoManager:
    "Writes what search engines read: each page's SEO, and each file's alt text and filename.",
  translator:
    "Translates your website from its default language into every other one, so that each stays complete.",
  proofreader:
    "Reads the text you write for spelling and grammar mistakes, and suggests a fix for each.",
  linkChecker:
    "Looks for links that lead nowhere, to your own pages or elsewhere, and suggests a fix when it can.",
};

/** What a patroller does, as its profile card introduces it. */
export function aboutSentence(id: PatrollerId): string {
  return ABOUT[id];
}

/**
 * When a patroller works where the editor is, by its duty there, in a draft or on Live, as its
 * card's tag says it, and whether it runs there at all. In a project with a single locale, the
 * Translator waits for a second one.
 */
export function whenTag(
  id: PatrollerId,
  duty: PatrollerDuty,
  inDraft: boolean,
  singleLocale: boolean,
): { label: string; runs: boolean } {
  const runs = (label: string) => ({ label, runs: true });
  if (id === "translator" && singleLocale)
    return { label: "Runs once you add a language", runs: false };
  if (duty === "atPublish") return runs("Runs when you publish");
  if (duty === "asYouGo") {
    if (inDraft) return runs("Runs as you edit");
    if (id === "linkChecker") return runs("Runs every 6 hours");
    // On Live while the catch-up draft translates what a release added there (ADR 0017).
    return runs("Runs while a release is translated");
  }
  // Off where the editor is: only on Live, which drafts change.
  return { label: "Doesn't run on Live", runs: false };
}
