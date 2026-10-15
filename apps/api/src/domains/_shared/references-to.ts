import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";

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
 * The content that references `target`, in one project and environment, as stored right now.
 * Content is matched on whole JSON values, so an id never matches another id it is a prefix of.
 * Record references are the record's id as a string anywhere in content; file references are
 * `_fileId` markers. Run on demand: nothing indexes references ahead of time.
 */
export const referencesTo = Effect.fn("references.referencesTo")(function* (
  db: Database,
  scope: { projectId: number; environmentId: number },
  target: ReferenceTarget,
) {
  const matches = (content: ReturnType<typeof sql.raw>) =>
    target.kind === "file"
      ? sql`exists (select 1 from json_tree(${content}) t
          where t.key = '_fileId' and t.atom = ${target.id})`
      : sql`exists (select 1 from json_tree(${content}) t
          where t.type = 'text' and t.atom = ${target.id})`;
  // An environment belongs to one project, so its id alone scopes content.
  const rows = yield* Effect.promise(() =>
    db.all<{ kind: ReferencingContent["kind"]; id: string }>(sql`
      select 'block' as kind, b.id as id from blocks b
      where b.environment_id = ${scope.environmentId} and ${matches(sql.raw("b.content"))}
      union all
      select 'sharedContent', s.type from shared_contents s
      where s.environment_id = ${scope.environmentId} and ${matches(sql.raw("s.content"))}
      union all
      select 'repeatableItem', i.id from repeatable_items i
      left join blocks b on b.id = i.block_id
      where coalesce(b.environment_id, i.environment_id) = ${scope.environmentId}
        and ${matches(sql.raw("i.content"))}
      union all
      select 'record', r.id from collection_records r
      join collection_definitions d
        on d.environment_id = r.environment_id and d.collection_id = r.collection_id
      where r.environment_id = ${scope.environmentId}
        and r.id != ${target.id} and ${matches(sql.raw("r.content"))}
    `),
  );
  return rows as ReferencingContent[];
});
