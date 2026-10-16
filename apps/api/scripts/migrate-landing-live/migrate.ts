import { generateUuidv7 } from "@camox/api-contract/ids";
import { generateNKeysBetween } from "fractional-indexing";

import {
  blockSchemaHash,
  collectionSchemaHash,
  layoutSchemaHash,
} from "../../src/domains/_shared/schema-hash";
import { checkMigration } from "./checks";
import { rewriteContentIds, type IdKind, type IdMaps } from "./content-ids";

/**
 * Copies one project's Live from the old database into the new one (ADR 0013). One-off: it
 * lives only on the drafts branch and is deleted at cutover.
 *
 * Live is what a logged-out visitor saw: blocks and items from each page's and layout's
 * published checkpoint, synced content from its definition's published data, and a page's path,
 * layout and SEO from its current row. Content gets fresh UUIDv7s and every id inside it is
 * rewritten; an id that points at nothing is stored empty and listed.
 */

export type Row = Record<string, unknown>;

/** The old database's rows, by table, as `select *` returns them. */
export type OldExport = Record<
  | "user"
  | "account"
  | "session"
  | "verification"
  | "organization"
  | "member"
  | "invitation"
  | "projects"
  | "environments"
  | "layouts"
  | "layout_checkpoints"
  | "pages"
  | "page_checkpoints"
  | "blocks"
  | "repeatable_items"
  | "block_definitions"
  | "collection_definitions"
  | "collection_records"
  | "files"
  | "comments",
  Row[]
>;

export type MigrateOptions = { projectSlug: string; now: number };

/** An id inside content that pointed at nothing, and the entity whose content held it. */
export type Dangling = {
  kind: IdKind;
  id: number;
  in: { entity: "block" | "sharedContent" | "repeatableItem"; id: string };
};

export type Migration = {
  tables: Record<string, Row[]>;
  dangling: Dangling[];
  /** Projects left out: their organization no longer exists. */
  orphanedProjects: number[];
};

type SnapshotBlock = {
  id: number;
  type: string;
  content: unknown;
  settings: unknown;
  summary?: string;
  position: string;
  slot?: string | null;
  createdAt: number;
  updatedAt: number;
};
type SnapshotItem = {
  id: number;
  blockId: number;
  parentItemId: number | null;
  fieldName: string;
  content: unknown;
  settings?: unknown;
  summary?: string;
  position: string;
  createdAt: number;
  updatedAt: number;
};
type Snapshot = { blocks: SnapshotBlock[]; repeatableItems: SnapshotItem[] };
type SyncedData = { block: SnapshotBlock; items: SnapshotItem[] };

/** Live publication columns: content rows start at version 1, published. */
type Published = {
  version: number;
  first_published_at: unknown;
  published_at: unknown;
  published_by: unknown;
};

export { checkMigration };

/** Migrates a project's Live, failing before anything is written when a check doesn't pass. */
export async function migrateLive(old: OldExport, options: MigrateOptions): Promise<Migration> {
  const migration = await buildMigration(old, options);
  const failures = checkMigration(old, migration, options);
  if (failures.length > 0) {
    throw new Error(`Invariant checks failed:\n${failures.join("\n")}`);
  }
  return migration;
}

async function buildMigration(old: OldExport, options: MigrateOptions): Promise<Migration> {
  const project = old.projects.find((row) => row.slug === options.projectSlug);
  if (!project) throw new Error(`No project "${options.projectSlug}" in the export`);
  const environment = old.environments.find(
    (row) => row.project_id === project.id && row.type === "production",
  );
  if (!environment) throw new Error(`Project "${options.projectSlug}" has no production`);
  const inLive = (row: Row) => row.environment_id === environment.id;
  // Nothing in the old database has collection records, so the script doesn't migrate them.
  const collections = new Set(old.collection_definitions.filter(inLive).map((row) => row.id));
  if (old.collection_records.some((record) => collections.has(record.definition_id))) {
    throw new Error("Collection records aren't migrated by this script");
  }

  const generatedValues: Row[] = [];
  const generated = (entity: string, entityId: string, type: string, value: unknown) =>
    generatedValues.push({
      project_id: project.id,
      draft_id: null,
      entity,
      entity_id: entityId,
      type,
      value: JSON.stringify(value),
      requested_at: null,
      generated_at: options.now,
    });
  // An empty summary was never generated.
  const summarize = (entity: string, entityId: string, summary: string | undefined) => {
    if (summary) generated(entity, entityId, "summary", { summary });
  };

  const publication = publicationReader(old);
  const liveLayouts = old.layouts.filter(inLive);
  const layoutNames = new Map(liveLayouts.map((layout) => [layout.id, layout.layout_id as string]));
  const livePages = old.pages.filter(
    (page) => inLive(page) && page.live_published_checkpoint_id != null,
  );
  const pageIds = new Map(livePages.map((page) => [page.id as number, generateUuidv7()]));

  const pages = livePages.map((page) => {
    const id = pageIds.get(page.id as number)!;
    // An AI flag on or unset makes the SEO generated; off makes it manual (ADR 0012).
    const manualSeo = page.ai_seo_enabled === 0;
    if (!manualSeo && (page.meta_title != null || page.meta_description != null)) {
      generated("page", id, "seo", {
        metaTitle: page.meta_title ?? "",
        metaDescription: page.meta_description ?? "",
      });
    }
    return {
      id,
      draft_id: null,
      ...publication("page", page).published,
      project_id: project.id,
      path_segment: page.path_segment,
      full_path: page.full_path,
      parent_page_id:
        page.parent_page_id == null ? null : (pageIds.get(page.parent_page_id as number) ?? null),
      layout_id: layoutNames.get(page.layout_id as number),
      nickname: page.nickname ?? page.full_path,
      meta_title: manualSeo ? page.meta_title : null,
      meta_description: manualSeo ? page.meta_description : null,
      custom_og_image_blob_id: page.custom_og_image_blob_id,
      custom_og_image_url: page.custom_og_image_url,
      content_updated_at: page.content_updated_at ?? page.updated_at,
      created_by_id: page.created_by_id,
      created_at: page.created_at,
      updated_at: page.updated_at,
    };
  });

  const owners = [
    ...livePages.map((page) => ({
      owner: { page_id: pageIds.get(page.id as number)!, layout_id: null },
      ...publication("page", page),
    })),
    ...liveLayouts
      .filter((layout) => layout.live_published_checkpoint_id != null)
      .map((layout) => ({
        owner: { page_id: null, layout_id: layout.layout_id as string },
        ...publication("layout", layout),
      })),
  ];

  // Live shows a synced definition's published data in every placement.
  const synced = new Map<string, SyncedData>();
  for (const definition of old.block_definitions.filter((row) => inLive(row) && row.synced)) {
    if (definition.synced_published_data == null) {
      throw new Error(`Synced definition "${String(definition.block_id)}" was never published`);
    }
    synced.set(
      definition.block_id as string,
      JSON.parse(definition.synced_published_data as string) as SyncedData,
    );
  }

  const blockIds = new Map<number, string>();
  const itemIds = new Map<number, string>();
  const blocks: Row[] = [];
  const items: Row[] = [];
  const addItems = (snapshotItems: SnapshotItem[], root: Row, published: Published) => {
    for (const item of snapshotItems) itemIds.set(item.id, generateUuidv7());
    const positions = positionsInRenderedOrder(snapshotItems);
    for (const item of snapshotItems) {
      const id = itemIds.get(item.id)!;
      summarize("repeatableItem", id, item.summary);
      items.push({
        id,
        draft_id: null,
        ...published,
        ...root,
        parent_item_id: item.parentItemId == null ? null : itemIds.get(item.parentItemId),
        field_name: item.fieldName,
        content: item.content,
        settings: item.settings ?? null,
        position: positions.get(item.id),
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      });
    }
  };
  for (const { owner, snapshot, published } of owners) {
    for (const block of snapshot.blocks) {
      const id = generateUuidv7();
      blockIds.set(block.id, id);
      // A placement of a synced definition holds nothing of its own.
      const placement = synced.has(block.type);
      if (!placement) summarize("block", id, block.summary);
      blocks.push({
        id,
        draft_id: null,
        ...published,
        project_id: project.id,
        ...owner,
        type: block.type,
        content: placement ? {} : block.content,
        settings: placement ? null : (block.settings ?? null),
        slot: block.slot ?? null,
        position: block.position,
        created_at: block.createdAt,
        updated_at: block.updatedAt,
      });
      if (placement) continue;
      addItems(
        snapshot.repeatableItems.filter((item) => item.blockId === block.id),
        { block_id: id, project_id: null, shared_content_type: null },
        published,
      );
    }
  }

  // Published data carries no publication time: it reads as released at migration.
  const released: Published = {
    version: 1,
    first_published_at: options.now,
    published_at: options.now,
    published_by: null,
  };
  const sharedContents: Row[] = [];
  for (const [type, data] of synced) {
    const id = `${String(project.id)}:${String(type)}`;
    summarize("sharedContent", id, data.block.summary);
    sharedContents.push({
      id,
      draft_id: null,
      ...released,
      project_id: project.id,
      type,
      content: data.block.content,
      settings: data.block.settings ?? null,
      created_at: data.block.createdAt,
      updated_at: data.block.updatedAt,
    });
    addItems(
      data.items,
      { block_id: null, project_id: project.id, shared_content_type: type },
      released,
    );
  }

  const fileIds = new Map<number, string>();
  const files = old.files.filter(inLive).map((file) => {
    const id = generateUuidv7();
    fileIds.set(file.id as number, id);
    // An AI flag on or unset makes the metadata generated; off makes it manual (ADR 0012).
    const manual = file.ai_metadata_enabled === 0;
    if (!manual) generated("file", id, "fileMetadata", { alt: file.alt, filename: file.filename });
    return {
      id,
      draft_id: null,
      version: 1,
      first_published_at: file.created_at,
      published_at: file.updated_at,
      published_by: null,
      project_id: project.id,
      url: file.url,
      alt: manual ? file.alt : null,
      filename: manual ? file.filename : null,
      mime_type: file.mime_type,
      size: file.size,
      optimized_size: file.optimized_size,
      blob_id: file.blob_id,
      path: file.path,
      created_at: file.created_at,
      updated_at: file.updated_at,
    };
  });

  const maps: IdMaps = { file: fileIds, page: pageIds, item: itemIds };
  const dangling: Dangling[] = [];
  const rewrite = (entity: Dangling["in"]["entity"], rows: Row[]) => {
    for (const row of rows) {
      const at = { entity, id: row.id as string };
      for (const key of ["content", "settings"]) {
        if (row[key] == null) continue;
        const rewritten = rewriteContentIds(row[key], maps, (kind, id) =>
          dangling.push({ kind, id, in: at }),
        );
        row[key] = JSON.stringify(rewritten);
      }
    }
  };
  rewrite("block", blocks);
  rewrite("sharedContent", sharedContents);
  rewrite("repeatableItem", items);

  const comments = old.comments.filter(inLive).flatMap((comment) => {
    const target = parsed(comment.target) as Row | null;
    const anchor = {
      page: pageIds.get(comment.page_id as number),
      blockColumn: comment.block_id == null ? null : blockIds.get(comment.block_id as number),
      itemColumn: comment.item_id == null ? null : itemIds.get(comment.item_id as number),
      targetBlock: target?.blockId == null ? null : blockIds.get(target.blockId as number),
      targetItem: target?.itemId == null ? null : itemIds.get(target.itemId as number),
    };
    // Its page, block or item didn't make it to Live.
    if (Object.values(anchor).includes(undefined)) return [];
    return [
      {
        id: generateUuidv7(),
        project_id: project.id,
        draft_id: null,
        addressed_in_draft_id: null,
        page_id: anchor.page,
        block_id: anchor.blockColumn,
        item_id: anchor.itemColumn,
        target:
          target &&
          JSON.stringify({
            ...target,
            ...(anchor.targetBlock && { blockId: anchor.targetBlock }),
            ...(anchor.targetItem && { itemId: anchor.targetItem }),
          }),
        message: comment.message,
        resolved: comment.resolved,
        author_id: comment.author_id,
        created_at: comment.created_at,
      },
    ];
  });

  // The new `projects` has a foreign key to its organization, which the old one lacked.
  const organizations = new Set(old.organization.map((organization) => organization.id));
  const orphanedProjects = old.projects
    .filter((row) => !organizations.has(row.organization_id))
    .map((row) => row.id as number);
  if (orphanedProjects.includes(project.id as number)) {
    throw new Error(`Project "${options.projectSlug}" has no organization`);
  }

  return {
    orphanedProjects,
    tables: {
      user: old.user,
      organization: old.organization,
      account: old.account,
      session: old.session,
      verification: old.verification,
      member: old.member,
      invitation: old.invitation,
      projects: old.projects.filter((row) => !orphanedProjects.includes(row.id as number)),
      ...(await definitions(old, inLive)),
      pages,
      comments,
      blocks,
      shared_contents: sharedContents,
      repeatable_items: items,
      files,
      generated_values: generatedValues,
    },
    dangling,
  };
}

/**
 * Old Live rendered sibling items in the order its data listed them, while the new database
 * orders them by position. Keeps a group's positions when they already follow that order, and
 * otherwise gives the group fresh positions in it.
 */
function positionsInRenderedOrder(items: SnapshotItem[]) {
  const groups = new Map<string, SnapshotItem[]>();
  for (const item of items) {
    const key = `${String(item.blockId)}/${String(item.parentItemId)}/${item.fieldName}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const positions = new Map<number, string>();
  for (const group of groups.values()) {
    const ordered = group.every(
      (item, index) => index === 0 || group[index - 1]!.position < item.position,
    );
    const fresh = ordered ? null : generateNKeysBetween(null, null, group.length);
    group.forEach((item, index) => positions.set(item.id, fresh?.[index] ?? item.position));
  }
  return positions;
}

const parsed = (value: unknown) => (value == null ? null : JSON.parse(value as string));

/** The production environment's definitions, as Live's (ADR 0006). */
async function definitions(old: OldExport, inLive: (row: Row) => boolean) {
  const blockDefinitions = await Promise.all(
    old.block_definitions.filter(inLive).map(async (row) => ({
      draft_id: null,
      project_id: row.project_id,
      block_id: row.block_id,
      title: row.title,
      description: row.description,
      content_schema: row.content_schema,
      settings_schema: row.settings_schema,
      default_content: row.default_content,
      default_settings: row.default_settings,
      layout_only: row.layout_only,
      synced: row.synced,
      schema_hash: await blockSchemaHash({
        contentSchema: parsed(row.content_schema),
        settingsSchema: parsed(row.settings_schema),
        synced: !!row.synced,
        layoutOnly: !!row.layout_only,
      }),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  );
  const layouts = await Promise.all(
    old.layouts.filter(inLive).map(async (row) => ({
      draft_id: null,
      project_id: row.project_id,
      layout_id: row.layout_id,
      description: row.description,
      kind: row.kind,
      // Declared by code: the next release sets it.
      record_pages: null,
      schema_hash: await layoutSchemaHash({ kind: row.kind as string }),
      content_updated_at: row.content_updated_at ?? row.updated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  );
  // A retired collection has no place in Live.
  const collectionDefinitions = await Promise.all(
    old.collection_definitions
      .filter((row) => inLive(row) && row.active)
      .map(async (row) => ({
        draft_id: null,
        project_id: row.project_id,
        collection_id: row.collection_id,
        title: row.title,
        description: row.description,
        label: row.label,
        content_schema: row.content_schema,
        schema_hash: await collectionSchemaHash({ contentSchema: parsed(row.content_schema) }),
      })),
  );
  return {
    block_definitions: blockDefinitions,
    layouts,
    collection_definitions: collectionDefinitions,
  };
}

/**
 * Reads a page's or layout's published checkpoint: its snapshot, and the Live publication
 * columns of everything in it (first published at its first checkpoint).
 */
function publicationReader(old: OldExport) {
  const tables = { page: old.page_checkpoints, layout: old.layout_checkpoints };
  const column = { page: "page_id", layout: "layout_id" } as const;
  return (kind: "page" | "layout", owner: Row) => {
    const own = tables[kind].filter((checkpoint) => checkpoint[column[kind]] === owner.id);
    const live = own.find((checkpoint) => checkpoint.id === owner.live_published_checkpoint_id);
    if (!live)
      throw new Error(`Checkpoint ${String(owner.live_published_checkpoint_id)} is missing`);
    const published: Published = {
      version: 1,
      first_published_at: Math.min(...own.map((checkpoint) => checkpoint.created_at as number)),
      published_at: live.created_at,
      published_by: live.created_by ?? null,
    };
    return { snapshot: JSON.parse(live.snapshot as string) as Snapshot, published };
  };
}
