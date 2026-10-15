/** What a draft shows as its name: computed for the viewer when unnamed, and never stored. */
type Labelled = {
  kind: "regular" | "development";
  name: string | null;
  createdBy: { name: string };
  createdAt: number;
};

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * A draft's name, or for an unnamed draft its creator and creation date formatted for the
 * viewer, e.g. "Rémi, Oct 13". A development draft is the development draft.
 */
export function draftLabel(draft: Labelled): string {
  if (draft.kind === "development") return "Development draft";
  if (draft.name) return draft.name;
  return `${draft.createdBy.name}, ${dayFormat.format(draft.createdAt)}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** How long ago a moment was, for the viewer: "3 days ago", "yesterday", "now". */
export function timeAgo(at: number, now = Date.now()): string {
  const elapsed = now - at;
  for (const [unit, size] of units) {
    if (elapsed >= size) return relative.format(-Math.round(elapsed / size), unit);
  }
  return relative.format(0, "minute");
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
