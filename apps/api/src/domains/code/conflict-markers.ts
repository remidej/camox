// Merge conflict markers, as a merge of `main` that conflicts leaves them in the files (spec #560,
// section 11): `build` never commits a file that still has them, whatever its language.

const OPENING = /^<{7}(?: |$)/m;
const SEPARATOR = /^={7}$/m;
const CLOSING = /^>{7}(?: |$)/m;

/** Whether `text` still has a conflict's markers: its opening, separator and closing lines. */
export const hasConflictMarkers = (text: string) =>
  OPENING.test(text) && SEPARATOR.test(text) && CLOSING.test(text);
