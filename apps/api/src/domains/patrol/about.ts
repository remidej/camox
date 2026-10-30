import type { FindingAbout } from "@camox/api-contract/patrol";

import { fieldOf } from "../_shared/fields";
import { linksOf } from "../_shared/links";
import type { Holder } from "../drafts/content-checks";
import { mergeUnitsOf, textsOf, type UnitTexts } from "../translations/texts";

// What a finding is about, in its content (ADR 0034): a link, by its url, or flagged text, in
// its sentence. Whether content still holds it is what fixing it, and closing it, depend on.

/** What a finding about a link is about. */
export type LinkAbout = Extract<FindingAbout, { url: string }>;

/** What a finding about text is about: the flagged text, in its sentence. */
export type TextAbout = Extract<FindingAbout, { sentence: string }>;

export const isAboutLink = (about: FindingAbout): about is LinkAbout =>
  about.kind === "missingPage" || about.kind === "brokenLink";

export const isAboutText = (about: FindingAbout): about is TextAbout =>
  about.kind === "misspelling" || about.kind === "grammar";

/** A text key's field: keys are the field's name, then its part, such as a text node's place. */
export const fieldOfKey = (key: string) => key.split("/")[0]!;

/** The text of a unit in `field` holding the sentence, with the flagged text still in it. */
export const findSentence = (texts: UnitTexts, field: string, about: TextAbout) =>
  about.sentence.includes(about.text)
    ? texts.texts.find(
        (text) =>
          text.format === "plain" &&
          fieldOfKey(text.key) === field &&
          text.text.includes(about.sentence),
      )
    : undefined;

/**
 * Whether a holder's content still holds what a finding is about: a link to its url in its
 * field, or its sentence with the flagged text in it.
 */
export function holds(
  holder: Pick<Holder, "schema" | "content">,
  finding: { field: string; about: FindingAbout },
): boolean {
  const { about } = finding;
  if (isAboutLink(about)) {
    const field = fieldOf(holder.schema, finding.field);
    const value = (holder.content as Record<string, unknown> | null)?.[finding.field];
    return field !== undefined && linksOf(field, value).some((link) => link.url === about.url);
  }
  const values = { content: holder.content };
  return mergeUnitsOf({ contentSchema: holder.schema }, [values]).some((unit) => {
    const texts = textsOf(unit, unit.get(values));
    return texts !== undefined && findSentence(texts, finding.field, about) !== undefined;
  });
}
