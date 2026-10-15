import { sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";

/** What content can reference: a collection record by its id, or a file by its `_fileId`. */
export type ReferenceTarget = { kind: "record"; id: string } | { kind: "file"; id: number };

/** Content that references a target: a block, a repeatable item, or another collection record. */
export type ReferencingContent =
  | { kind: "block"; id: number }
  | { kind: "repeatableItem"; id: number }
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
  const scopedBlocks = sql`select b.id from blocks b
    left join pages p on p.id = b.page_id
    left join layouts l on l.id = b.layout_id
    where coalesce(p.project_id, l.project_id) = ${scope.projectId}
      and coalesce(p.environment_id, l.environment_id) = ${scope.environmentId}`;
  const rows = yield* Effect.promise(() =>
    db.all<{ kind: ReferencingContent["kind"]; id: number | string }>(sql`
      select 'block' as kind, b.id as id from blocks b
      where b.id in (${scopedBlocks}) and ${matches(sql.raw("b.content"))}
      union all
      select 'repeatableItem', i.id from repeatable_items i
      where i.block_id in (${scopedBlocks}) and ${matches(sql.raw("i.content"))}
      union all
      select 'record', r.id from collection_records r
      join collection_definitions d on d.id = r.definition_id
      where d.project_id = ${scope.projectId} and d.environment_id = ${scope.environmentId}
        and r.id != ${String(target.id)} and ${matches(sql.raw("r.content"))}
    `),
  );
  return rows as ReferencingContent[];
});
