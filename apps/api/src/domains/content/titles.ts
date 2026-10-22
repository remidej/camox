import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { contentToPlainText } from "../../lib/content-markdown";
import { isObject } from "../../lib/is-object";
import { blocks, repeatableItems } from "../../schema";
import { itemSchemas, propertiesOf, titleTemplateOf } from "../_shared/fields";
import { sharedContentShown } from "../blocks/shared-content";
import type { ContentScope } from "../collections/identity";
import { inDefaultLocale, localeOf } from "../drafts/scope";
import { selectInChunks } from "./chunks";
import type { BlockDefinition } from "./definitions";

// Blocks and repeatable items are named by their `toTitle` template until they have a Summary.
// Like Summaries, titles come from default-locale content (ADR 0012), so the studio and agents
// name a block the same way whatever locale is open.

/** What a title template reads: a block's or item's content and settings, as stored. */
type TitleSource = { content: unknown; settings: unknown };
type TitledBlock = TitleSource & { id: string; type: string };
type TitledItem = TitleSource & {
  id: string;
  blockId: string;
  parentItemId: string | null;
  fieldName: string;
};

/** Stored settings as templates read them: none unless they're an object. */
const settingsOf = (settings: unknown) => (isObject(settings) ? settings : null);

/** A title template filled with content as plain text, the way Markdown templates are. */
function fillTitle(
  template: string | undefined,
  schema: unknown,
  { content, settings }: TitleSource,
  itemSettings?: unknown,
) {
  if (template === undefined) return "";
  return contentToPlainText(template, propertiesOf(schema), isObject(content) ? content : {}, {
    settings: settingsOf(settings),
    itemSettings: settingsOf(itemSettings),
  });
}

/**
 * The default-locale content and settings of blocks and items the scope shows, by id: those
 * given when the scope reads the default locale, else read again in it. Synced placements show
 * their shared content. Content only another locale holds has none.
 */
const defaultLocaleSources = Effect.fn("content.defaultLocaleSources")(function* (
  db: Database,
  at: ContentScope,
  shownBlocks: readonly TitledBlock[],
  shownItems: readonly TitledItem[],
) {
  if (localeOf(at.draft) === undefined) {
    return {
      blocks: new Map<string, TitleSource>(shownBlocks.map((block) => [block.id, block])),
      items: new Map<string, TitleSource>(shownItems.map((item) => [item.id, item])),
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
    blocks: new Map<string, TitleSource>(shown.blocks.map((block) => [block.id, block])),
    items: new Map<string, TitleSource>(itemRows.map((item) => [item.id, item])),
  };
});

/**
 * The titles of the blocks and items in `titled`, by id: "" without a template or default-locale
 * content. `trees` holds the whole item trees the titled items sit in, under the blocks whose
 * definitions shape them, since an item's schema comes from its repeater path.
 */
export const titlesOf = Effect.fn("content.titlesOf")(function* (
  db: Database,
  at: ContentScope,
  definitions: ReadonlyMap<string, BlockDefinition>,
  trees: { blocks: readonly TitledBlock[]; items: readonly TitledItem[] },
  titled: { blocks: readonly TitledBlock[]; items: readonly TitledItem[] },
) {
  const sources = yield* defaultLocaleSources(db, at, titled.blocks, titled.items);
  const blockTitles = new Map<string, string>();
  for (const block of titled.blocks) {
    const schema = definitions.get(block.type)?.contentSchema;
    const found = sources.blocks.get(block.id);
    blockTitles.set(block.id, found ? fillTitle(titleTemplateOf(schema), schema, found) : "");
  }
  const wanted = new Set(titled.items.map((item) => item.id));
  const byBlock = Map.groupBy(trees.items, (item) => item.blockId);
  const itemTitles = new Map<string, string>();
  for (const block of trees.blocks) {
    const root = definitions.get(block.type)?.contentSchema;
    for (const [id, schemas] of itemSchemas(root, byBlock.get(block.id) ?? [])) {
      if (!wanted.has(id)) continue;
      const found = sources.items.get(id);
      const title = found
        ? fillTitle(schemas.title, schemas.content, { ...found, settings: null }, found.settings)
        : "";
      itemTitles.set(id, title);
    }
  }
  return {
    block: (id: string) => blockTitles.get(id) ?? "",
    item: (id: string) => itemTitles.get(id) ?? "",
  };
});
