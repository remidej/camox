import type { GoogleFontFamily } from "takumi-js/helpers";

import type { CamoxDocument } from "../../core/defineDocument";

const GOOGLE_FONTS_CSS2 = "https://fonts.googleapis.com/css2";

/**
 * The Google Fonts families the document's stylesheet links load, in link order, so page images
 * render in the site's fonts. Other stylesheets are ignored.
 */
export function documentGoogleFonts(document: CamoxDocument): GoogleFontFamily[] {
  const links = Array.isArray(document.link) ? document.link : [];
  return links.flatMap((link) => {
    if (typeof link !== "object" || link === null) return [];
    const { rel, href } = link as { rel?: unknown; href?: unknown };
    if (rel !== "stylesheet" || typeof href !== "string") return [];
    const url = URL.parse(href);
    if (!url || `${url.origin}${url.pathname}` !== GOOGLE_FONTS_CSS2) return [];
    return url.searchParams.getAll("family").map(parseFamily);
  });
}

/**
 * One css2 `family` parameter: `Inter`, or a name with its axes and their values, such as
 * `Archivo:ital,wght@0,100..900;1,100..900` (one `;`-separated tuple per face).
 */
function parseFamily(param: string): GoogleFontFamily {
  const [name = "", spec] = param.split(":");
  if (!spec) return { name };
  const [axisList = "", tupleList = ""] = spec.split("@");
  const axes = axisList.split(",");
  const tuples = tupleList.split(";").map((tuple) => tuple.split(","));
  const valuesOf = (axis: string) => {
    const index = axes.indexOf(axis);
    return index < 0 ? [] : [...new Set(tuples.map((tuple) => tuple[index] ?? ""))];
  };

  const weights = valuesOf("wght");
  const weightRange = weights.find(isRange);
  const otherAxes = Object.fromEntries(
    axes
      .filter((axis) => axis !== "wght" && axis !== "ital")
      .map((axis) => {
        const [value = ""] = valuesOf(axis);
        return [axis, isRange(value) ? value : Number(value)];
      }),
  );
  return {
    name,
    ...(weights.length > 0 && { weight: weightRange ?? weights.map(Number) }),
    ...(axes.includes("ital") && {
      style: valuesOf("ital").map((ital) => (ital === "1" ? "italic" : "normal")),
    }),
    ...(Object.keys(otherAxes).length > 0 && { axes: otherAxes }),
  };
}

function isRange(value: string): value is `${number}..${number}` {
  return value.includes("..");
}
