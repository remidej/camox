import { sql, type SQL } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { blocks } from "../blocks/schema";
import { collectionDefinitions, collectionRecords } from "../collections/schema";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { itemsInEnvironment } from "../repeatable-items/roots";

/** What content can reference: a collection record by its id, or a file by its `_fileId`. */
export type ReferenceTarget = { kind: "record"; id: string } | { kind: "file"; id: string };

/**
 * Content that references a target: a block, a synced definition's shared content (by its
 * definition's name), a repeatable item, or another collection record.
 */
export type ReferencingContent =
  | { kind: "block"; id: string }
  | { kind: "sharedContent"; id: string }
  | { kind: "repeatableItem"; id: string }
  | { kind: "record"; id: string };

/**
 * The content that references `target`, in one project and environment, as Live or a draft
 * reads it right now. Content is matched on whole JSON values, so an id never matches another id
 * it is a prefix of. Record references are the record's id as a string anywhere in content; file
 * references are `_fileId` markers. Run on demand: nothing indexes references ahead of time.
 */
export const referencesTo = Effect.fn("references.referencesTo")(function* (
  db: Database,
  scope: { projectId: number; environmentId: number; draft: DraftScope },
  target: ReferenceTarget,
) {
  const matches = (content: SQL) =>
    target.kind === "file"
      ? sql`exists (select 1 from json_tree(${content}) t
          where t.key = '_fileId' and t.atom = ${target.id})`
      : sql`exists (select 1 from json_tree(${content}) t
          where t.type = 'text' and t.atom = ${target.id})`;
  // An environment belongs to one project, so its id alone scopes content.
  const rows = yield* Effect.promise(() =>
    db.all<{ kind: ReferencingContent["kind"]; id: string }>(sql`
      select 'block' as kind, ${blocks.id} as id from ${blocks}
      where ${blocks.environmentId} = ${scope.environmentId}
        and ${overlay.visibleIn(blocks, scope.draft)}
        and ${matches(sql`${blocks.content}`)}
      union all
      select 'sharedContent', s.type from shared_contents s
      where s.environment_id = ${scope.environmentId} and ${matches(sql.raw("s.content"))}
      union all
      select 'repeatableItem', repeatable_items.id from repeatable_items
      where ${itemsInEnvironment(scope.environmentId)}
        and ${matches(sql.raw("repeatable_items.content"))}
      union all
      select 'record', ${collectionRecords.id} from ${collectionRecords}
      join ${collectionDefinitions}
        on ${collectionDefinitions.environmentId} = ${collectionRecords.environmentId}
        and ${collectionDefinitions.collectionId} = ${collectionRecords.collectionId}
      where ${collectionRecords.environmentId} = ${scope.environmentId}
        and ${overlay.visibleIn(collectionRecords, scope.draft)}
        and ${collectionRecords.id} != ${target.id}
        and ${matches(sql`${collectionRecords.content}`)}
    `),
  );
  return rows as ReferencingContent[];
});
