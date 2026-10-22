import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { contentToMarkdown } from "../../lib/content-markdown";
import { blocks, repeatableItems } from "../../schema";
import { itemSchemas, propertiesOf, titleTemplateOf } from "../_shared/fields";
import { sharedContentShown } from "../blocks/shared-content";
import type { ContentScope } from "../collections/identity";
import { inDefaultLocale, type ReadScope } from "../drafts/scope";
import { selectInChunks } from "./chunks";
import type { BlockDefinition } from "./definitions";

// Blocks and repeatable items are named by their `toTitle` template until they have a Summary.
// Like Summaries, titles come from default-locale content (ADR 0012), so the studio and agents
// name a block the same way whatever locale is open.

type Values = { content: unknown; settings: unknown };
type TitledBlock = Values & { id: string; type: string };
type TitledItem = Values & {
  id: string;
  blockId: string;
  parentItemId: string | null;
  fieldName: string;
};

/** Whether a scope reads a locale it names, which may not be the default one. */
function namesLocale(scope: ReadScope) {
  return scope !== null && "locale" in scope && scope.locale !== undefined;
}

// A Markdown link or image, which a title reads by its text or alt text.
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

/** A title template evaluated on content as plain text, the way Markdown templates are. */
function evaluate(
  template: string | undefined,
  schema: unknown,
  { content, settings }: Values,
  itemSettings?: unknown,
) {
  if (template === undefined) return "";
  const markdown = contentToMarkdown([template], propertiesOf(schema), (content ?? {}) as never, {
    settings: settings as Record<string, unknown> | null,
    itemSettings: itemSettings as Record<string, unknown> | null,
  });
  return markdown.replace(MARKDOWN_LINK, "$1");
}

/**
 * The default-locale content and settings of blocks and items the scope shows, by id: those
 * given when the scope reads the default locale, else read again in it. Synced placements show
 * their shared content. Content only another locale holds has none.
 */
const defaultLocaleValues = Effect.fn("content.defaultLocaleValues")(function* (
  db: Database,
  at: ContentScope,
  shownBlocks: readonly TitledBlock[],
  shownItems: readonly TitledItem[],
) {
  if (!namesLocale(at.draft)) {
    return {
      blocks: new Map<string, Values>(shownBlocks.map((block) => [block.id, block])),
      items: new Map<string, Values>(shownItems.map((item) => [item.id, item])),
    };
  }
  const scope = inDefaultLocale(at.draft);
  const blockRows = yield* selectInChunks(
    db,
    scope,
    blocks,
    shownBlocks.map((block) => block.id),
    (chunk) => and(eq(blocks.projectId, at.projectId), inArray(blocks.id, chunk)),
  );
  const shown = yield* sharedContentShown(db, scope, blockRows, []);
  const itemRows = yield* selectInChunks(
    db,
    scope,
    repeatableItems,
    shownItems.map((item) => item.id),
    (chunk) => inArray(repeatableItems.id, chunk),
  );
  return {
    blocks: new Map<string, Values>(shown.blocks.map((block) => [block.id, block])),
    items: new Map<string, Values>(itemRows.map((item) => [item.id, item])),
  };
});

/**
 * The titles of shown blocks and of the items in `titled`, by id: "" without a template or
 * default-locale content. `items` holds the whole trees the titled items sit in, under the blocks
 * that shape them; only blocks in `titled` get titles.
 */
export const titlesOf = Effect.fn("content.titlesOf")(function* (
  db: Database,
  at: ContentScope,
  definitions: ReadonlyMap<string, BlockDefinition>,
  shown: { blocks: readonly TitledBlock[]; items: readonly TitledItem[] },
  titled: { blocks: readonly TitledBlock[]; items: readonly TitledItem[] },
) {
  const values = yield* defaultLocaleValues(db, at, titled.blocks, titled.items);
  const blockTitles = new Map<string, string>();
  for (const block of titled.blocks) {
    const schema = definitions.get(block.type)?.contentSchema;
    const found = values.blocks.get(block.id);
    blockTitles.set(block.id, found ? evaluate(titleTemplateOf(schema), schema, found) : "");
  }
  const wanted = new Set(titled.items.map((item) => item.id));
  const byBlock = Map.groupBy(shown.items, (item) => item.blockId);
  const itemTitles = new Map<string, string>();
  for (const block of shown.blocks) {
    const root = definitions.get(block.type)?.contentSchema;
    for (const [id, schemas] of itemSchemas(root, byBlock.get(block.id) ?? [])) {
      if (!wanted.has(id)) continue;
      const found = values.items.get(id);
      const title = found
        ? evaluate(schemas.title, schemas.content, { ...found, settings: null }, found.settings)
        : "";
      itemTitles.set(id, title);
    }
  }
  return {
    block: (id: string) => blockTitles.get(id) ?? "",
    item: (id: string) => itemTitles.get(id) ?? "",
  };
});
