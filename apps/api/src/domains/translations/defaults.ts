import { isDeepStrictEqual } from "node:util";

import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslationJob } from "../../lib/ai-job-queue";
import { AiModel, type TranslationText } from "../../lib/ai-model";
import { blocks, repeatableItems } from "../../schema";
import { defaultOf, fieldsOf, itemSchemas } from "../_shared/fields";
import { loadDefinitionSchemas } from "../blocks/content-schema";
import * as overlay from "../drafts/overlay";
import { inLocale, type Draft } from "../drafts/scope";
import { requestGeneration } from "../generated-values/generation";
import { homeOf } from "../generated-values/service";
import { itemsUnder } from "../repeatable-items/roots";
import { draftLocales } from "./service";
import { contentTexts } from "./texts";

// A block placed in a locale other than the default one has no default-locale source: it holds
// its definition's code-owned defaults, in the language the code wrote them in. Its translation
// job translates those defaults into the block's locale (ADR 0015), in the block and its
// repeatable items, wherever a field still holds its default. A field someone edited since
// placement keeps the edit, even one made while the model translated.

type Content = Record<string, unknown>;

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

/** Translates the defaults of a block placed in the job's locale of a draft. */
export const translateDefaults = Effect.fn("translation.defaults")(function* (
  db: Database,
  draft: Draft,
  job: TranslationJob,
) {
  const { defaultTag, others } = yield* draftLocales(db, draft);
  if (defaultTag === undefined || !others.includes(job.locale)) return;
  const target = inLocale(draft, job.locale);
  const block = yield* overlay.get(db, target, blocks, job.entityId);
  if (!block) return;
  const schema = (yield* loadDefinitionSchemas(
    db,
    { projectId: block.projectId, type: block.type },
    draft,
  ))?.contentSchema;
  const items = yield* overlay.select(
    db,
    target,
    repeatableItems,
    itemsUnder({ blockId: block.id }),
  );
  const itemSchemaOf = itemSchemas(schema, items);

  // The block and each of its items, by id: their texts go to the model at once, keyed by id.
  const schemas = new Map<string, unknown>([[block.id, schema]]);
  for (const item of items) schemas.set(item.id, itemSchemaOf.get(item.id)?.content);
  const contents = new Map<string, Content>([[block.id, block.content as Content]]);
  for (const item of items) contents.set(item.id, item.content as Content);

  const texts: TranslationText[] = [];
  const pending = new Map<string, ReturnType<typeof contentTexts>>();
  for (const [id, content] of contents) {
    const found = contentTexts(schemas.get(id), untouched(schemas.get(id), content));
    if (found.texts.length === 0) continue;
    pending.set(id, found);
    for (const text of found.texts) texts.push({ ...text, key: `${id}:${text.key}` });
  }
  if (texts.length === 0) return;
  const model = yield* AiModel;
  const translations = yield* model.translate({ from: defaultTag, to: job.locale, texts });

  const now = Date.now();
  for (const [id, found] of pending) {
    const prefix = `${id}:`;
    const own = Object.fromEntries(
      Object.entries(translations).flatMap(([key, text]) =>
        key.startsWith(prefix) ? [[key.slice(prefix.length), text]] : [],
      ),
    );
    const translated = found.translated(own);
    // Read again: what was edited while the model translated keeps the edit.
    const table = id === block.id ? blocks : repeatableItems;
    const current = yield* overlay.get(db, target, table, id);
    if (!current) continue;
    const content = current.content as Content;
    const still = untouched(schemas.get(id), content);
    const patch = Object.fromEntries(
      Object.keys(still).flatMap((name) =>
        isDeepStrictEqual(translated[name], content[name]) ? [] : [[name, translated[name]]],
      ),
    );
    if (Object.keys(patch).length === 0) continue;
    yield* overlay.update(db, target, table, id, {
      content: { ...content, ...patch },
      updatedAt: now,
    });
  }
  // The locale's page SEO is generated from what was just written (ADR 0012).
  yield* requestGeneration(db, homeOf(target, block.projectId), {
    entity: "block",
    row: { id: block.id },
  });
});
