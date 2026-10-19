import { sql, type SQL } from "drizzle-orm";

import { blocks } from "../domains/blocks/schema";
import { layouts } from "../domains/layouts/schema";
import { pages } from "../domains/pages/schema";

// A Live page or layout's `content_updated_at` tells readers when its blocks last changed: the
// SDK keeps a layout's cached blocks across navigations while it stays the same. Live's writers,
// publishing and releases, bump it through the drafts overlay whenever Live changes a block, a
// repeatable item, or a synced block's shared content. Drafts never bump it.
//
// Each builder takes `changed`, a select of the changed rows of one content table (any rows:
// Live's or a draft's, before or after the change) and returns statements bumping the owners
// of the Live blocks they concern.

/**
 * Bumps the Live pages, and the layouts, owning the Live blocks `where` matches on the alias
 * "b". A layout is bumped in Live and in development drafts, which show Live's blocks too.
 */
function bumpOwnersOfBlocks(where: SQL, now: number): SQL[] {
  const liveBlocks = sql`from ${blocks} as "b" where "b"."draft_id" is null and ${where}`;
  return [
    sql`update ${pages} set "content_updated_at" = ${now}
      where ${pages.draftId} is null
        and (${pages.id}, ${pages.locale}) in (select "b"."page_id", "b"."locale" ${liveBlocks})`,
    sql`update ${layouts} set "content_updated_at" = ${now}
      where exists (select 1 ${liveBlocks}
        and "b"."layout_id" = ${layouts.layoutId} and "b"."project_id" = ${layouts.projectId})`,
  ];
}

/** Bumps the owners of the changed blocks themselves. */
export const bumpsForBlocks = (changed: SQL, now: number) =>
  bumpOwnersOfBlocks(
    sql`("b"."id", "b"."locale") in (select "c"."id", "c"."locale" from (${changed}) as "c")`,
    now,
  );

/** Bumps the owners of the placements of the changed shared contents' definitions. */
export const bumpsForSharedContents = (changed: SQL, now: number) =>
  bumpOwnersOfBlocks(
    sql`exists (select 1 from (${changed}) as "c"
      where "c"."project_id" = "b"."project_id" and "c"."type" = "b"."type"
        and "c"."locale" = "b"."locale")`,
    now,
  );

/**
 * Bumps the owners of the changed items' root: their block, or every placement of the synced
 * definition whose shared content holds them.
 */
export const bumpsForRepeatableItems = (changed: SQL, now: number) =>
  bumpOwnersOfBlocks(
    sql`(("b"."id", "b"."locale") in (select "c"."block_id", "c"."locale" from (${changed}) as "c")
      or exists (select 1 from (${changed}) as "c"
        where "c"."project_id" = "b"."project_id" and "c"."shared_content_type" = "b"."type"
          and "c"."locale" = "b"."locale"))`,
    now,
  );
