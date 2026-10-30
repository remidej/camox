import {
  type FindingAbout,
  type FindingFix,
  type FindingView,
  findingSentence,
} from "@camox/api-contract/patrol";

import { localeName } from "./localeOptions";

// What a patroller's finding says, in the studio's language (ADR 0034). The sentence itself is
// the contract's, as the API words it too.

export { findingSentence };

/** Quoted as editors read it. */
const quoted = (text: string) => `“${text}”`;

/** What a dismissal dismissed, briefly: "Links to About", or the text it was about. */
export function dismissedSentence(about: FindingAbout): string {
  switch (about.kind) {
    case "missingPage":
      return `Links to ${about.page ?? "a missing page"}`;
    case "brokenLink":
      return `Links to ${about.url}`;
    default:
      return quoted(about.text);
  }
}

/** What dismissing a finding says, as its button says it: a broken link's is "This link is fine". */
export function dismissLabel(about: FindingAbout): string {
  return about.kind === "brokenLink" ? "This link is fine" : "Dismiss";
}

/** What applying a fix does, as its button says it. */
export function fixLabel(fix: FindingFix): string {
  switch (fix.kind) {
    case "removeLink":
      return "Remove the link";
    case "replaceText":
      return `Replace with ${quoted(fix.replacement)}`;
  }
}

/**
 * What "Ask the agent" fills the draft's chat with: who found what, where, and the fix it
 * suggests, for the agent to find among the draft's findings and fix.
 */
export function askAgentMessage(
  finding: Pick<FindingView, "about" | "subject" | "locale" | "field" | "fix">,
  role: string,
): string {
  const where = `(in ${localeName(finding.locale)}, field ${quoted(finding.field)})`;
  const fix = finding.fix ? ` Suggested fix: ${fixLabel(finding.fix)}.` : "";
  return `${role} finding: ${findingSentence(finding)} ${where}.${fix}`;
}
