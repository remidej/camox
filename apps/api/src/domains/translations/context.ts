import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslatedEntity } from "../../lib/ai-job-queue";
import type { TranslationContext } from "../../lib/ai-model";
import { blocks, pages, projects, repeatableItems } from "../../schema";
import * as overlay from "../drafts/overlay";
import type { Draft } from "../drafts/scope";
import { withSeo } from "../pages/generated-seo";

/**
 * What the model is told about the website an entity is translated for, so it writes the way
 * the website's audience does: the project's name, and the title and description of the page the
 * entity is on, in the default locale. The entity is read where `entityIn` reads. An entity on no
 * page, such as shared content or a record, gets the home page's.
 */
export const translationContext = Effect.fn("translation.context")(function* (
  db: Database,
  draft: Draft,
  entityIn: Draft,
  entity: TranslatedEntity,
  entityId: string,
) {
  const project = yield* Effect.promise(() =>
    db.select({ name: projects.name }).from(projects).where(eq(projects.id, draft.projectId)).get(),
  );
  const pageId = yield* pageIdOf(db, entityIn, entity, entityId);
  const page =
    (pageId === null ? undefined : yield* overlay.get(db, draft, pages, pageId)) ??
    (yield* overlay.select(
      db,
      draft,
      pages,
      and(eq(pages.projectId, draft.projectId), eq(pages.fullPath, "/")),
    ))[0];
  const [shown] = page ? yield* withSeo(db, draft, [page]) : [];
  const context: TranslationContext = {
    website: project?.name,
    pageTitle: shown?.metaTitle || undefined,
    pageDescription: shown?.metaDescription || undefined,
  };
  return context;
});

/** The id of the page an entity is on, or null when it's on none. */
const pageIdOf = Effect.fn("translation.pageIdOf")(function* (
  db: Database,
  scope: Draft,
  entity: TranslatedEntity,
  entityId: string,
) {
  switch (entity) {
    case "page":
      return entityId;
    case "block":
      return (yield* overlay.get(db, scope, blocks, entityId))?.pageId ?? null;
    case "repeatableItem": {
      const item = yield* overlay.get(db, scope, repeatableItems, entityId);
      if (!item?.blockId) return null;
      return (yield* overlay.get(db, scope, blocks, item.blockId))?.pageId ?? null;
    }
    case "sharedContent":
    case "record":
      return null;
  }
});
