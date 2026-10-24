import type { Bindings } from "../../types";

// The Google Fonts families the agent picks fonts from: a daily snapshot of the Google Fonts
// Developer API, taken with Camox's key by the API's scheduled job and kept in R2, so a search
// never waits on Google. Hosted pages link a family's `css2` stylesheet, which Cloudflare Fonts
// rewrites to serve from the website's own origin (ADR 0021).

export const FONT_CATEGORIES = [
  "sans-serif",
  "serif",
  "display",
  "handwriting",
  "monospace",
] as const;
export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** How many families one search returns, most popular first; `total` counts every match. */
export const FONTS_SHOWN = 20;

/** Where the snapshot is kept, beside the revisions' builds, which hosted projects also use. */
export const FONTS_SNAPSHOT_KEY = "google-fonts/families.json";

const DEVELOPER_API = "https://www.googleapis.com/webfonts/v1/webfonts";
const CSS2 = "https://fonts.googleapis.com/css2";

/** A variable font's axis, such as `wght` from 100 to 900. */
type Axis = { tag: string; start: number; end: number };

/** A family as the snapshot keeps it: what a search returns and its link needs. */
type SnapshotFamily = { family: string; category: string; variants: string[]; axes?: Axis[] };

/** A family a search found, with the exact link to its stylesheet. */
export type FoundFamily = {
  family: string;
  category: string;
  italic: boolean;
  link: string;
} & ({ axes: Axis[] } | { weights: number[] });

export type FontSearch = { families: FoundFamily[]; total: number };

/**
 * Takes a new snapshot of the Google Fonts Developer API's families, most popular first, with
 * their variable axes, and replaces the stored one. Throws, keeping the last snapshot, when
 * Google doesn't answer with a list.
 */
export async function refreshFontsSnapshot(env: Bindings): Promise<void> {
  const url = new URL(DEVELOPER_API);
  url.searchParams.set("key", env.GOOGLE_FONTS_API_KEY);
  url.searchParams.set("sort", "popularity");
  url.searchParams.set("capability", "VF");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The Google Fonts Developer API answered ${response.status}`);
  }
  const { items } = (await response.json()) as { items: SnapshotFamily[] };
  const families = items.map(({ family, category, variants, axes }): SnapshotFamily => ({
    family,
    category,
    variants,
    ...(axes ? { axes } : {}),
  }));
  await env.REVISION_BUILDS.put(FONTS_SNAPSHOT_KEY, JSON.stringify(families), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** The stored snapshot, taken first when there is none yet. */
async function snapshot(env: Bindings): Promise<SnapshotFamily[]> {
  let stored = await env.REVISION_BUILDS.get(FONTS_SNAPSHOT_KEY);
  if (!stored) {
    await refreshFontsSnapshot(env);
    stored = await env.REVISION_BUILDS.get(FONTS_SNAPSHOT_KEY);
  }
  return stored!.json<SnapshotFamily[]>();
}

/**
 * The families whose name holds `query`, ignoring case, in `category` when given, most popular
 * first: at most `FONTS_SHOWN` of them, with how many matched.
 */
export async function searchFonts(
  env: Bindings,
  { query, category }: { query?: string; category?: FontCategory },
): Promise<FontSearch> {
  const needle = query?.trim().toLowerCase() ?? "";
  const matches = (await snapshot(env)).filter(
    (family) =>
      family.family.toLowerCase().includes(needle) && (!category || family.category === category),
  );
  return { families: matches.slice(0, FONTS_SHOWN).map(found), total: matches.length };
}

/** A variant's weight and style: `regular` is 400 upright, `700italic` is 700 italic. */
const styleOf = (variant: string) => {
  const italic = variant.endsWith("italic");
  const weight = variant.replace(/italic$/, "").replace(/^regular$/, "");
  return { italic, weight: weight ? Number(weight) : 400 };
};

function found({ family, category, variants, axes }: SnapshotFamily): FoundFamily {
  const styles = variants.map(styleOf);
  const italic = styles.some((style) => style.italic);
  const wght = axes?.find((axis) => axis.tag === "wght");
  const weights = [...new Set(styles.map((style) => style.weight))].sort((a, b) => a - b);
  // Google Fonts' own embed code: a range for a variable weight, each style a static family has,
  // italics after uprights, and no axis list for a family with one upright weight. Asking for a
  // style the family lacks fails the whole stylesheet.
  const tuples = wght
    ? [...new Set(styles.map((style) => style.italic))].map((ital) => ({
        ital,
        weight: `${wght.start}..${wght.end}`,
      }))
    : styles.map(({ italic: ital, weight }) => ({ ital, weight: String(weight) }));
  const order = (a: (typeof tuples)[number], b: (typeof tuples)[number]) =>
    Number(a.ital) - Number(b.ital) ||
    Number(a.weight.split("..")[0]) - Number(b.weight.split("..")[0]);
  tuples.sort(order);
  const name = family.replaceAll(" ", "+");
  const spec = italic
    ? `${name}:ital,wght@${tuples.map(({ ital, weight }) => `${Number(ital)},${weight}`).join(";")}`
    : wght || weights.length > 1 || weights[0] !== 400
      ? `${name}:wght@${tuples.map(({ weight }) => weight).join(";")}`
      : name;
  return {
    family,
    category,
    ...(axes ? { axes } : { weights }),
    italic,
    link: `${CSS2}?family=${spec}&display=swap`,
  };
}
