// A draft's name, which Camox owns: whoever starts a draft names it from what it's for, and its
// overview renames it once that name no longer fits (`overview-job.ts`). Members never type one.

/**
 * What a draft's name looks like, for every model that writes one: a label the studio's draft
 * picker shows whole, never a sentence.
 */
export const DRAFT_NAME_RULES =
  "A label for a list of drafts, not a sentence: 1 to 4 words and at most 24 characters, in " +
  "sentence case, without articles or ending punctuation, abbreviated where it helps " +
  '("SEO", "FAQ", "Q4", "&"), such as "New hero subtitle", "Cheaper Pro plan" or "Blog SEO".';

/** The longest name a tool takes: past the rules' length, still short enough for the picker. */
export const DRAFT_NAME_MAX_LENGTH = 32;

/** How much of the request a draft was started for its overview reads. */
export const OPENING_REQUEST_MAX_LENGTH = 2_000;
