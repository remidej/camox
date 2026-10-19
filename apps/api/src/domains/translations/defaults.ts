import { isDeepStrictEqual } from "node:util";

import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslationJob } from "../../lib/ai-job-queue";
import type { TranslationText } from "../../lib/ai-model";
import { blocks, repeatableItems, sharedContents } from "../../schema";
import { defaultOf, fieldsOf, itemSchemas } from "../_shared/fields";
import { loadDefinitionSchemas } from "../blocks/content-schema";
import * as overlay from "../drafts/overlay";
import type { Draft } from "../drafts/scope";
import { requestGeneration } from "../generated-values/generation";
import { homeOf } from "../generated-values/service";
import { itemsUnder, type ItemRoot } from "../repeatable-items/roots";
import { translateTexts, translationScope } from "./scope";
import { contentTexts } from "./texts";

// A block placed in a locale other than the default one has no default-locale source: it holds
// its definition's code-owned defaults, in the language the code wrote them in. So does the
// shared content a synced block placed there creates. Its translation job translates those
// defaults into the locale (ADR 0015), in the block or shared content and its repeatable items,
// wherever a field still holds its default. A field someone edited since placement keeps the
// edit, even one made while the model translated.

type Content = Record<string, unknown>;

/** An entity whose defaults a job translates: its schema, its content, and where it lives. */
type Translated = {
  schema: unknown;
  content: Content;
  table: typeof blocks | typeof sharedContents | typeof repeatableItems;
};

/** The fields of content still holding their schema's default. */
function untouched(schema: unknown, content: Content): Content {
  const fields: Content = {};
  for (const field of fieldsOf(schema)) {
    const fallback = defaultOf(field, "block");
    if (fallback && isDeepStrictEqual(content[field.name], fallback.value)) {
      fields[field.name] = content[field.name];
    }
  }
  return fields;
}

/**
 * Translates the defaults of a block placed in the job's locale of a draft, or of the shared
 * content a synced block created there.
 */
export const translateDefaults = Effect.fn("translation.defaults")(function* (
  db: Database,
  draft: Draft,
  job: TranslationJob,
) {
  if (job.entity !== "block" && job.entity !== "sharedContent") return;
  const scope = yield* translationScope(db, draft, job.locale);
  if (!scope) return;
  const { target } = scope;
  const table = job.entity === "sharedContent" ? sharedContents : blocks;
  const root = yield* overlay.get(db, target, table, job.entityId);
  if (!root) return;
  const key = { projectId: root.projectId, type: root.type };
  const schema = (yield* loadDefinitionSchemas(db, key, draft))?.contentSchema;
  const itemRoot: ItemRoot =
    job.entity === "sharedContent" ? { sharedContent: key } : { blockId: root.id };
  const items = yield* overlay.select(db, target, repeatableItems, itemsUnder(itemRoot));
  const itemSchemaOf = itemSchemas(schema, items);

  // The root and each of its items, by id: their texts go to the model at once, keyed by id.
  const translated = new Map<string, Translated>([
    [root.id, { schema, content: root.content as Content, table }],
  ]);
  for (const item of items) {
    const content = item.content as Content;
    translated.set(item.id, {
      schema: itemSchemaOf.get(item.id)?.content,
      content,
      table: repeatableItems,
    });
  }

  const texts: TranslationText[] = [];
  const pending = new Map<string, ReturnType<typeof contentTexts>>();
  for (const [id, { schema, content }] of translated) {
    const found = contentTexts(schema, untouched(schema, content));
    if (found.texts.length === 0) continue;
    pending.set(id, found);
    for (const text of found.texts) texts.push({ ...text, key: `${id}:${text.key}` });
  }
  if (texts.length === 0) return;
  const translations = yield* translateTexts(scope, texts);

  const now = Date.now();
  let written = false;
  for (const [id, found] of pending) {
    const { schema, table } = translated.get(id)!;
    const prefix = `${id}:`;
    const own = Object.fromEntries(
      Object.entries(translations).flatMap(([key, text]) =>
        key.startsWith(prefix) ? [[key.slice(prefix.length), text]] : [],
      ),
    );
    const values = found.translated(own);
    // Read again: what was edited while the model translated keeps the edit.
    const current = yield* overlay.get(db, target, table, id);
    if (!current) continue;
    const content = current.content as Content;
    const patch = Object.fromEntries(
      Object.keys(untouched(schema, content)).flatMap((name) =>
        isDeepStrictEqual(values[name], content[name]) ? [] : [[name, values[name]]],
      ),
    );
    if (Object.keys(patch).length === 0) continue;
    const row = yield* overlay.update(db, target, table, id, {
      content: { ...content, ...patch },
      updatedAt: now,
    });
    written ||= row !== undefined;
  }
  // The locale's page SEO is generated from what was just written (ADR 0012). Shared content
  // isn't generated on its own, like when it's translated from the default locale.
  if (written && job.entity === "block") {
    yield* requestGeneration(db, homeOf(target, root.projectId), {
      entity: "block",
      row: { id: root.id },
    });
  }
});
