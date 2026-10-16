import { PAGE_TEXT_LINK_PREFIX, uuidv7Schema } from "@camox/api-contract/ids";

import type { MigrateOptions, Migration, OldExport, Row } from "./migrate";

const AUTH_TABLES = [
  "user",
  "organization",
  "account",
  "session",
  "verification",
  "member",
  "invitation",
] as const;

const TEXT_LINK = new RegExp(`${PAGE_TEXT_LINK_PREFIX}([0-9a-zA-Z-]*)`, "g");

/** The ids a piece of content names: files, items and pages. */
function* referencesIn(node: unknown): Generator<{ kind: "file" | "item" | "page"; id: unknown }> {
  if (typeof node === "string") {
    for (const match of node.matchAll(TEXT_LINK)) {
      if (match[1]) yield { kind: "page", id: match[1] };
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) yield* referencesIn(entry);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const object = node as Row;
  if ("_fileId" in object) yield { kind: "file", id: object._fileId };
  if ("_itemId" in object) yield { kind: "item", id: object._itemId };
  if (object.type === "page" && object.pageId !== "" && object.pageId != null) {
    yield { kind: "page", id: object.pageId };
  }
  for (const entry of Object.values(object)) yield* referencesIn(entry);
}

const parse = (value: unknown) => (value == null ? null : JSON.parse(value as string));

/**
 * Checks a migration before it is written: every id resolves, and the counts match what the
 * export says Live holds. Returns one line per failure.
 */
export function checkMigration(
  old: OldExport,
  migration: Migration,
  options: MigrateOptions,
): string[] {
  const { tables } = migration;
  const failures: string[] = [];
  const ids = (rows: Row[] | undefined, column = "id") =>
    new Set((rows ?? []).map((row) => row[column]));
  const known = {
    user: ids(tables.user),
    organization: ids(tables.organization),
    page: ids(tables.pages),
    block: ids(tables.blocks),
    item: ids(tables.repeatable_items),
    file: ids(tables.files),
    sharedContent: ids(tables.shared_contents),
    layout: ids(tables.layouts, "layout_id"),
    comment: ids(tables.comments),
  };
  const resolves = (
    at: string,
    kind: keyof typeof known,
    value: unknown,
    { nullable = false } = {},
  ) => {
    if (nullable && value == null) return;
    if (!known[kind].has(value))
      failures.push(`${at}: ${kind} ${String(value)} resolves to nothing`);
  };
  const isUuidv7 = (at: string, value: unknown) => {
    if (!uuidv7Schema.safeParse(value).success) failures.push(`${at}: id isn't a UUIDv7`);
  };

  for (const row of tables.account ?? []) resolves(`account ${String(row.id)}`, "user", row.userId);
  for (const row of tables.session ?? []) resolves(`session ${String(row.id)}`, "user", row.userId);
  for (const row of tables.member ?? []) {
    resolves(`member ${String(row.id)}`, "user", row.userId);
    resolves(`member ${String(row.id)}`, "organization", row.organizationId);
  }
  for (const row of tables.invitation ?? []) {
    resolves(`invitation ${String(row.id)}`, "user", row.inviterId);
    resolves(`invitation ${String(row.id)}`, "organization", row.organizationId);
  }
  for (const row of tables.projects ?? []) {
    resolves(`project ${String(row.id)}`, "organization", row.organization_id);
  }

  for (const page of tables.pages ?? []) {
    const at = `page ${String(page.id)}`;
    isUuidv7(at, page.id);
    resolves(at, "page", page.parent_page_id, { nullable: true });
    resolves(at, "layout", page.layout_id);
    resolves(at, "user", page.created_by_id, { nullable: true });
  }
  for (const block of tables.blocks ?? []) {
    const at = `block ${String(block.id)}`;
    isUuidv7(at, block.id);
    if ((block.page_id == null) === (block.layout_id == null)) {
      failures.push(`${at}: needs exactly one of a page and a layout`);
    }
    resolves(at, "page", block.page_id, { nullable: true });
    resolves(at, "layout", block.layout_id, { nullable: true });
  }
  const syncedTypes = new Set(
    (tables.block_definitions ?? []).filter((row) => row.synced).map((row) => row.block_id),
  );
  for (const shared of tables.shared_contents ?? []) {
    if (!syncedTypes.has(shared.type)) {
      failures.push(`sharedContent ${String(shared.id)}: its definition isn't synced`);
    }
  }
  for (const type of syncedTypes) {
    resolves(
      `definition ${String(type)}`,
      "sharedContent",
      `${String(projectIdOf(old, options))}:${String(type)}`,
    );
  }
  for (const item of tables.repeatable_items ?? []) {
    const at = `repeatableItem ${String(item.id)}`;
    isUuidv7(at, item.id);
    if (item.block_id != null) resolves(at, "block", item.block_id);
    else
      resolves(
        at,
        "sharedContent",
        `${String(item.project_id)}:${String(item.shared_content_type)}`,
      );
    resolves(at, "item", item.parent_item_id, { nullable: true });
  }
  for (const file of tables.files ?? []) isUuidv7(`file ${String(file.id)}`, file.id);

  for (const [entity, table] of [
    ["block", "blocks"],
    ["sharedContent", "shared_contents"],
    ["repeatableItem", "repeatable_items"],
  ] as const) {
    for (const row of tables[table] ?? []) {
      for (const column of ["content", "settings"]) {
        for (const reference of referencesIn(parse(row[column]))) {
          resolves(`${entity} ${String(row.id)}`, reference.kind, reference.id);
        }
      }
    }
  }

  for (const comment of tables.comments ?? []) {
    const at = `comment ${String(comment.id)}`;
    isUuidv7(at, comment.id);
    resolves(at, "page", comment.page_id);
    resolves(at, "block", comment.block_id, { nullable: true });
    resolves(at, "item", comment.item_id, { nullable: true });
    resolves(at, "user", comment.author_id);
    const target = parse(comment.target) as Row | null;
    resolves(at, "block", target?.blockId, { nullable: true });
    resolves(at, "item", target?.itemId, { nullable: true });
  }

  const valueOwners = {
    block: "block",
    sharedContent: "sharedContent",
    repeatableItem: "item",
    page: "page",
    file: "file",
  } as const;
  for (const value of tables.generated_values ?? []) {
    const owner = valueOwners[value.entity as keyof typeof valueOwners];
    resolves(`generated ${String(value.entity)} ${String(value.type)}`, owner, value.entity_id);
  }

  for (const [table, expected] of Object.entries(expectedCounts(old, migration, options))) {
    const actual = tables[table]?.length ?? 0;
    if (actual !== expected) failures.push(`${table}: ${actual} rows, expected ${expected}`);
  }
  return failures;
}

function projectIdOf(old: OldExport, options: MigrateOptions) {
  return old.projects.find((row) => row.slug === options.projectSlug)?.id;
}

/** What Live holds according to the export, counted without the migration's own logic. */
function expectedCounts(old: OldExport, migration: Migration, options: MigrateOptions) {
  const projectId = projectIdOf(old, options);
  const production = old.environments.find(
    (row) => row.project_id === projectId && row.type === "production",
  )?.id;
  const inLive = (row: Row) => row.environment_id === production;
  const published = (rows: Row[]) =>
    rows.filter((row) => inLive(row) && row.live_published_checkpoint_id != null);
  // Checkpoint ids repeat across the two tables: each owner reads its own.
  const liveCheckpoints = (owners: Row[], checkpoints: Row[]) => {
    const ids = new Set(published(owners).map((row) => row.live_published_checkpoint_id));
    return checkpoints.filter((checkpoint) => ids.has(checkpoint.id));
  };
  const snapshots = [
    ...liveCheckpoints(old.pages, old.page_checkpoints),
    ...liveCheckpoints(old.layouts, old.layout_checkpoints),
  ].map((checkpoint) => parse(checkpoint.snapshot) as { blocks: Row[]; repeatableItems: Row[] });
  const synced = old.block_definitions.filter((row) => inLive(row) && row.synced);
  const syncedTypes = new Set(synced.map((row) => row.block_id));

  // A synced placement's own items aren't Live: its definition's published items are.
  const placementItems = snapshots.flatMap((snapshot) => {
    const placements = new Set(
      snapshot.blocks.filter((block) => syncedTypes.has(block.type)).map((block) => block.id),
    );
    return snapshot.repeatableItems.filter((item) => !placements.has(item.blockId));
  });
  const sharedItems = synced.flatMap(
    (row) => (parse(row.synced_published_data)?.items as Row[] | undefined) ?? [],
  );

  return {
    ...Object.fromEntries(AUTH_TABLES.map((table) => [table, old[table].length])),
    projects: old.projects.length - migration.orphanedProjects.length,
    block_definitions: old.block_definitions.filter(inLive).length,
    layouts: old.layouts.filter(inLive).length,
    collection_definitions: old.collection_definitions.filter((row) => inLive(row) && row.active)
      .length,
    pages: published(old.pages).length,
    blocks: snapshots.reduce((sum, snapshot) => sum + snapshot.blocks.length, 0),
    shared_contents: synced.length,
    repeatable_items: placementItems.length + sharedItems.length,
    files: old.files.filter(inLive).length,
  };
}
