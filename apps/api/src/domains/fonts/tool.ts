import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { Bindings } from "../../types";
import { FONT_CATEGORIES, FONTS_SHOWN, searchFonts } from "./catalog";

/**
 * The agent's `searchFonts`, which finds Google Fonts families in Camox's daily snapshot, with
 * the exact link a Document needs, so the agent never misspells a family or asks for a weight
 * it lacks.
 */
export const searchFontsTool = (env: Bindings): ToolRegistration =>
  defineTool({
    name: "searchFonts",
    description:
      "Search Google Fonts families by name and category, most popular first. Returns JSON: " +
      `\`families\`, at most ${FONTS_SHOWN}, each with its \`category\`, its variable \`axes\` or ` +
      "static `weights`, whether it has `italic`s, and the exact `link` to its stylesheet; and " +
      "the `total` that matched. Leave `query` out to list a category's most popular families.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Part of the family's name." })),
      category: Type.Optional(
        Type.Union(FONT_CATEGORIES.map((category) => Type.Literal(category))),
      ),
    }),
    async execute(args) {
      const result = await searchFonts(env, args);
      return { output: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  });
