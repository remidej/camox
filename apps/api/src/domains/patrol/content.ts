import { PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
import { Effect } from "effect";

import { collectionRecords, locales, pages } from "../../schema";
import type { Field } from "../_shared/fields";
import { type ContentLink, linksIn } from "../_shared/links";
import type { ServiceContext } from "../_shared/service-context";
import { type Holder, holdersIn, rowsIn } from "../drafts/content-checks";
import { type DraftScope, draftOf, inLocale } from "../drafts/scope";

// What patrollers read of content (ADR 0034): every holder a draft or Live reads in a locale, and
// the links in them, by what a check of a draft or a patrol of Live looks at. Holders are read
// as publishing's content checks read them.

type Scope = NonNullable<DraftScope>;

/** A link, in content a draft reads, to a page missing from the draft. */
export type MissingPageLink = {
  holder: Holder;
  /** The tag of the locale the content is in. */
  locale: string;
  field: Field;
  link: ContentLink;
  /** The missing page's name on Live, if Live has it. */
  page: string | null;
};

/**
 * Links to pages missing from the draft, in each locale it reads: in content the draft changed,
 * and in untouched Live content linking to a page the draft deletes, since deleting it is the
 * draft's change. Links Live already left leading nowhere aren't the draft's. A link to a page
 * missing from its locale leads to the default locale's page, so it isn't missing.
 */
export const missingPageLinks = Effect.fn("patrol.missingPageLinks")(function* (
  ctx: ServiceContext,
  draft: Scope,
) {
  const scope = draftOf(draft);
  const { projectId } = scope;
  const tags = new Set((yield* rowsIn(ctx, scope, projectId, locales)).map((locale) => locale.tag));
  const defaults = {
    draft: yield* rowsIn(ctx, scope, projectId, pages),
    live: yield* rowsIn(ctx, null, projectId, pages),
  };
  const missing: MissingPageLink[] = [];
  for (const tag of tags) {
    const inTag = inLocale(scope, tag);
    const draftPages = yield* rowsIn(ctx, inTag, projectId, pages);
    const livePages = yield* rowsIn(ctx, inLocale(null, tag), projectId, pages);
    const inDraft = new Set([...draftPages, ...defaults.draft].map((page) => page.id));
    const onLive = new Map([...defaults.live, ...livePages].map((page) => [page.id, page]));
    const records = yield* rowsIn(ctx, inTag, projectId, collectionRecords);
    const holders = yield* holdersIn(
      ctx,
      inTag,
      projectId,
      new Set(draftPages.map((page) => page.id)),
      records,
    );
    for (const holder of holders) {
      for (const { field, link } of linksIn(holder.schema, holder.content)) {
        if (!link.url.startsWith(PAGE_TEXT_LINK_PREFIX)) continue;
        const pageId = link.url.slice(PAGE_TEXT_LINK_PREFIX.length);
        if (inDraft.has(pageId)) continue;
        const live = onLive.get(pageId);
        if (!holder.changed && !live) continue;
        missing.push({ holder, locale: tag, field, link, page: live?.nickname ?? null });
      }
    }
  }
  return missing;
});

/** A link in content a draft reads, in a locale. */
export type LinkInContent = { holder: Holder; locale: string; field: Field; link: ContentLink };

/** The links in content the draft changed, in each locale it reads. */
export const changedLinks = Effect.fn("patrol.changedLinks")(function* (
  ctx: ServiceContext,
  draft: Scope,
) {
  const scope = draftOf(draft);
  const { projectId } = scope;
  const tags = new Set((yield* rowsIn(ctx, scope, projectId, locales)).map((locale) => locale.tag));
  const found: LinkInContent[] = [];
  for (const tag of tags) {
    const inTag = inLocale(scope, tag);
    const draftPages = yield* rowsIn(ctx, inTag, projectId, pages);
    const records = yield* rowsIn(ctx, inTag, projectId, collectionRecords);
    const holders = yield* holdersIn(
      ctx,
      inTag,
      projectId,
      new Set(draftPages.map((page) => page.id)),
      records,
    );
    for (const holder of holders.filter((candidate) => candidate.changed)) {
      for (const { field, link } of linksIn(holder.schema, holder.content)) {
        found.push({ holder, locale: tag, field, link });
      }
    }
  }
  return found;
});

/** A link in Live's content, in a locale, and whether it links to a page Live doesn't have. */
export type LiveLink = LinkInContent & { pageMissing: boolean };

/**
 * Every link in Live's content, in each of its locales: what the Link checker patrols (ADR 0034).
 * A link to a page missing from its locale leads to the default locale's page, so it isn't missing.
 */
export const liveLinks = Effect.fn("patrol.liveLinks")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const defaults = yield* rowsIn(ctx, null, projectId, pages);
  const found: LiveLink[] = [];
  for (const tag of yield* liveLocaleTags(ctx, projectId)) {
    const livePages = yield* rowsIn(ctx, inLocale(null, tag), projectId, pages);
    const onLive = new Set([...defaults, ...livePages].map((page) => page.id));
    for (const holder of yield* liveHoldersOf(ctx, projectId, tag)) {
      for (const { field, link } of linksIn(holder.schema, holder.content)) {
        const pageMissing =
          link.url.startsWith(PAGE_TEXT_LINK_PREFIX) &&
          !onLive.has(link.url.slice(PAGE_TEXT_LINK_PREFIX.length));
        found.push({ holder, locale: tag, field, link, pageMissing });
      }
    }
  }
  return found;
});

/** The tags of Live's locales. */
export const liveLocaleTags = Effect.fn("patrol.liveLocaleTags")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  return new Set((yield* rowsIn(ctx, null, projectId, locales)).map((locale) => locale.tag));
});

/**
 * Every block, shared content, repeatable item and record Live reads in a locale, with the
 * definition it's read by: what a patroller's patrol of Live reads.
 */
export const liveHoldersOf = Effect.fn("patrol.liveHoldersOf")(function* (
  ctx: ServiceContext,
  projectId: number,
  tag: string,
) {
  const inTag = inLocale(null, tag);
  const livePages = yield* rowsIn(ctx, inTag, projectId, pages);
  const records = yield* rowsIn(ctx, inTag, projectId, collectionRecords);
  return yield* holdersIn(
    ctx,
    inTag,
    projectId,
    new Set(livePages.map((page) => page.id)),
    records,
  );
});

/**
 * The content of one block, shared content, repeatable item or record as a draft reads it in a
 * locale, with the definition it's read by: what a patroller's fix edits. Undefined once it's
 * gone, or read as nothing.
 */
export const holderOf = Effect.fn("patrol.holderOf")(function* (
  ctx: ServiceContext,
  draft: Scope,
  tag: string,
  subject: { entity: string; id: string },
) {
  const holders = yield* holdersOf(ctx, draft, tag);
  return holders.find((holder) => holder.entity === subject.entity && holder.id === subject.id);
});

/**
 * Every block, shared content, repeatable item and record a draft reads in a locale, with the
 * definition it's read by: what a patroller's check reads.
 */
export const holdersOf = Effect.fn("patrol.holdersOf")(function* (
  ctx: ServiceContext,
  draft: Scope,
  tag: string,
) {
  const scope = inLocale(draftOf(draft), tag);
  const { projectId } = scope;
  const visible = (yield* rowsIn(ctx, scope, projectId, pages)).map((page) => page.id);
  const records = yield* rowsIn(ctx, scope, projectId, collectionRecords);
  return yield* holdersIn(ctx, scope, projectId, new Set(visible), records);
});
