import type { FindingAbout } from "@camox/api-contract/patrol";

import { fieldOf } from "../_shared/fields";
import { linksOf } from "../_shared/links";
import type { Holder } from "../drafts/content-checks";

// What a finding is about, in its content (ADR 0034): a link, by its url. Whether content still
// holds it is what fixing it, and closing it, depend on.

/** What a finding about a link is about. */
export type LinkAbout = Extract<FindingAbout, { url: string }>;

export const isAboutLink = (about: FindingAbout): about is LinkAbout =>
  about.kind === "missingPage" || about.kind === "brokenLink";

/** Whether a holder's content still holds what a finding is about: a link to its url in its field. */
export function holds(
  holder: Pick<Holder, "schema" | "content">,
  finding: { field: string; about: FindingAbout },
): boolean {
  const { about } = finding;
  const field = fieldOf(holder.schema, finding.field);
  const value = (holder.content as Record<string, unknown> | null)?.[finding.field];
  return field !== undefined && linksOf(field, value).some((link) => link.url === about.url);
}
