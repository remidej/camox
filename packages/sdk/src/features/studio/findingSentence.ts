import type { FindingAbout, FindingFix, FindingView } from "@camox/api-contract/patrol";

// What a patroller's finding says, in the studio's language (ADR 0034).

/** Quoted as editors read it. */
const quoted = (text: string) => `“${text}”`;

/** What a finding is about, after where it is: "links to About, a page that no longer exists". */
function aboutSentence(about: FindingAbout): string {
  switch (about.kind) {
    case "missingPage":
      return about.page === null
        ? "links to a page that no longer exists"
        : `links to ${about.page}, a page that no longer exists`;
    case "brokenLink": {
      const { failure } = about;
      const how =
        failure.kind === "status"
          ? `answers with an error (${failure.status})`
          : failure.kind === "timeout"
            ? "doesn't answer in time"
            : "can't be reached";
      return `links to ${about.url}, which ${how}`;
    }
    case "misspelling":
      return "may be misspelled";
    case "grammar":
      return "may be a grammar mistake";
  }
}

/** What a finding flags: a link by what it reads, or text as written. */
const flagged = (about: FindingAbout) => quoted(about.text);

/** A finding as one sentence: "“About us” in Footer links to About, a page that no longer exists". */
export function findingSentence(finding: Pick<FindingView, "about" | "subject">): string {
  return `${flagged(finding.about)} in ${finding.subject.name} ${aboutSentence(finding.about)}`;
}

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
