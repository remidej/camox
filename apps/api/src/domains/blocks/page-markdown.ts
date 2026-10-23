import { Effect } from "effect";

import type { BlockMarkdown, ContentReader } from "../content/reader";

/** Joins the Markdown of a layout's before and after slots, skipping blocks without Markdown. */
export function layoutSlotsMarkdown(rendered: readonly BlockMarkdown[]) {
  const slot = (name: "before" | "after") =>
    rendered
      .filter((block) => block.pageId === null && block.slot === name && block.markdown)
      .map((block) => block.markdown)
      .join("\n\n");
  return { before: slot("before"), after: slot("after") };
}

/**
 * A page's Markdown Representation: its layout's before blocks, its own blocks, then its
 * layout's after blocks, read together. A block whose definition declares no Markdown stands as
 * its JSON.
 */
export const pageMarkdownOf = Effect.fn("blocks.pageMarkdownOf")(function* (
  reader: ContentReader,
  page: { id: string; layoutId: string },
) {
  const rendered = yield* reader.markdown([{ pageId: page.id }, { layoutId: page.layoutId }]);
  const { before, after } = layoutSlotsMarkdown(rendered);
  const blockMarkdowns = rendered
    .filter((block) => block.pageId === page.id)
    .map((block) => ({
      id: block.id,
      position: block.position,
      markdown: block.markdown ?? block.json,
    }));
  const parts = [before, ...blockMarkdowns.map((b) => b.markdown), after].filter(Boolean);
  return { markdown: parts.join("\n\n"), blocks: blockMarkdowns };
});
