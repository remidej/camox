import { zValidator } from "@hono/zod-validator";
import { eq, inArray } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";

import { assertPageAccess } from "../authorization";
import type { Database } from "../db";
import type { AppEnv } from "../types";
import { blockDefinitions } from "./block-definitions";
import { blocks } from "./blocks";
import { files } from "./files";
import { layouts } from "./layouts";
import { projects } from "./projects";
import { repeatableItems } from "./repeatable-items";

// --- Schema ---

export const pages = sqliteTable(
  "pages",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    pathSegment: text("path_segment").notNull(),
    fullPath: text("full_path").notNull(),
    parentPageId: int("parent_page_id"),
    layoutId: int("layout_id")
      .notNull()
      .references(() => layouts.id),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    aiSeoEnabled: int("ai_seo_enabled", { mode: "boolean" }),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("pages_full_path_idx").on(table.fullPath),
    index("pages_parent_idx").on(table.parentPageId),
    index("pages_project_idx").on(table.projectId),
  ],
);

// --- Content Assembly Helpers ---

type ContentRecord = Record<string, unknown>;

function sortByPosition<T extends { position: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.position.localeCompare(b.position));
}

function collectFileIds(content: Record<string, unknown>, fileIds: Set<number>) {
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && typeof obj._fileId === "number") {
        fileIds.add(obj._fileId);
      } else {
        collectFileIds(obj, fileIds);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "content" in item) {
          collectFileIds((item as { content: Record<string, unknown> }).content, fileIds);
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          collectFileIds(item as Record<string, unknown>, fileIds);
        }
      }
    }
  }
}

type FileDoc = { id: number; url: string; alt: string; filename: string; mimeType: string };

function resolveFileRefs(
  content: Record<string, unknown>,
  fileMap: Map<number, FileDoc>,
): ContentRecord {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ("_fileId" in obj && typeof obj._fileId === "number") {
        const file = fileMap.get(obj._fileId);
        resolved[key] = file
          ? {
              url: file.url,
              alt: file.alt,
              filename: file.filename,
              mimeType: file.mimeType,
              _fileId: obj._fileId,
            }
          : { url: "", alt: "", filename: "", mimeType: "" };
      } else {
        resolved[key] = resolveFileRefs(obj, fileMap);
      }
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((item) => {
        if (item && typeof item === "object" && "content" in item) {
          return {
            ...item,
            content: resolveFileRefs(
              (item as { content: Record<string, unknown> }).content,
              fileMap,
            ),
          };
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return resolveFileRefs(item as Record<string, unknown>, fileMap);
        }
        return item;
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function groupItemsByBlockAndField<T extends { blockId: number; fieldName: string }>(
  items: T[],
): Record<string, T[]> {
  const acc: Record<string, T[]> = {};
  for (const item of items) {
    const key = `${item.blockId}:${item.fieldName}`;
    (acc[key] ??= []).push(item);
  }
  return acc;
}

function reconstructBlockContent(
  blockContent: Record<string, unknown>,
  itemsByBlockAndField: Record<string, unknown[]>,
  blockId: number,
  allItems: { blockId: number; fieldName: string }[],
  fieldOrder?: string[],
): ContentRecord {
  const reconstructed: Record<string, unknown> = { ...blockContent };

  const fieldNames = new Set(
    allItems.filter((item) => item.blockId === blockId).map((item) => item.fieldName),
  );
  for (const fieldName of fieldNames) {
    reconstructed[fieldName] = itemsByBlockAndField[`${blockId}:${fieldName}`] || [];
  }

  if (!fieldOrder) return reconstructed;

  // Reorder keys to match field order from block definition
  const ordered: Record<string, unknown> = {};
  for (const key of fieldOrder) {
    if (key in reconstructed) ordered[key] = reconstructed[key];
  }
  for (const key of Object.keys(reconstructed)) {
    if (!(key in ordered)) ordered[key] = reconstructed[key];
  }
  return ordered;
}

async function buildFileMap(db: Database, fileIds: Set<number>): Promise<Map<number, FileDoc>> {
  if (fileIds.size === 0) return new Map();
  const rows = await db
    .select()
    .from(files)
    .where(inArray(files.id, [...fileIds]));
  return new Map(rows.map((f) => [f.id, f]));
}

async function assembleBlocks(
  db: Database,
  rawBlocks: (typeof blocks.$inferSelect)[],
  fieldOrderByType: Map<string, string[]>,
) {
  const sorted = sortByPosition(rawBlocks);
  const blockIds = sorted.map((b) => b.id);

  // Fetch all repeatable items for these blocks
  const allItems =
    blockIds.length > 0
      ? sortByPosition(
          await db.select().from(repeatableItems).where(inArray(repeatableItems.blockId, blockIds)),
        )
      : [];

  const itemsByBlockAndField = groupItemsByBlockAndField(allItems);

  // Reconstruct content with repeatable items merged in
  const blocksWithItems = sorted.map((block) => ({
    ...block,
    content: reconstructBlockContent(
      block.content as Record<string, unknown>,
      itemsByBlockAndField,
      block.id,
      allItems,
      fieldOrderByType.get(block.type),
    ),
  }));

  // Resolve file references
  const fileIds = new Set<number>();
  for (const block of blocksWithItems) {
    collectFileIds(block.content, fileIds);
  }

  if (fileIds.size === 0) return blocksWithItems;

  const fileMap = await buildFileMap(db, fileIds);
  return blocksWithItems.map((block) => ({
    ...block,
    content: resolveFileRefs(block.content, fileMap),
  }));
}

// --- Routes ---

const updatePageSchema = z.object({
  pathSegment: z.string(),
  parentPageId: z.number().nullable().optional(),
});

export const pageRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await c.var.db
      .select({ page: pages })
      .from(pages)
      .innerJoin(projects, eq(projects.id, pages.projectId))
      .where(eq(projects.organizationSlug, orgSlug));
    return c.json(result.map((r) => r.page));
  })
  .get("/by-path", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const fullPath = c.req.query("path");
    if (!fullPath) return c.json({ error: "path required" }, 400);

    const db = c.var.db;

    const page = await db.select().from(pages).where(eq(pages.fullPath, fullPath)).get();
    if (!page) return c.json({ error: "Not found" }, 404);

    const project = await db.select().from(projects).where(eq(projects.id, page.projectId)).get();
    if (!project || project.organizationSlug !== orgSlug) {
      return c.json({ error: "Not found" }, 404);
    }

    // Fetch block definitions for field ordering
    const defs = await db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.projectId, page.projectId));
    const fieldOrderByType = new Map<string, string[]>();
    for (const def of defs) {
      const schema = def.contentSchema as Record<string, unknown> | null;
      if (schema?.properties) {
        fieldOrderByType.set(
          def.blockId,
          Object.keys(schema.properties as Record<string, unknown>),
        );
      }
    }

    // Assemble page blocks
    const pageBlocks = await db.select().from(blocks).where(eq(blocks.pageId, page.id));
    const assembledBlocks = await assembleBlocks(db, pageBlocks, fieldOrderByType);

    // Assemble layout
    const layout = await db.select().from(layouts).where(eq(layouts.id, page.layoutId)).get();
    if (!layout) {
      return c.json({ page, projectName: project.name, blocks: assembledBlocks });
    }

    const layoutBlocks = await db.select().from(blocks).where(eq(blocks.layoutId, layout.id));
    const assembledLayoutBlocks = await assembleBlocks(db, layoutBlocks, fieldOrderByType);

    const beforeBlocks = assembledLayoutBlocks.filter((b) => b.placement === "before");
    const afterBlocks = assembledLayoutBlocks.filter((b) => b.placement === "after");

    return c.json({
      page,
      projectName: project.name,
      blocks: assembledBlocks,
      layout: {
        id: layout.id,
        layoutId: layout.layoutId,
        blocks: assembledLayoutBlocks,
        beforeBlocks,
        afterBlocks,
      },
    });
  })
  .get("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    const result = await assertPageAccess(c.var.db, id, orgSlug);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result.page);
  })
  .patch("/:id{[0-9]+}", zValidator("json", updatePageSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const body = c.req.valid("json");
    const result = await c.var.db
      .update(pages)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(pages.id, id))
      .returning()
      .get();
    return c.json(result);
  })
  .delete("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const result = await c.var.db.delete(pages).where(eq(pages.id, id)).returning().get();
    return c.json(result);
  })
  .patch(
    "/:id{[0-9]+}/ai-seo",
    zValidator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { enabled } = c.req.valid("json");
      const result = await c.var.db
        .update(pages)
        .set({ aiSeoEnabled: enabled, updatedAt: Date.now() })
        .where(eq(pages.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .patch(
    "/:id{[0-9]+}/meta-title",
    zValidator("json", z.object({ metaTitle: z.string() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { metaTitle } = c.req.valid("json");
      const result = await c.var.db
        .update(pages)
        .set({ metaTitle, updatedAt: Date.now() })
        .where(eq(pages.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .patch(
    "/:id{[0-9]+}/meta-description",
    zValidator("json", z.object({ metaDescription: z.string() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { metaDescription } = c.req.valid("json");
      const result = await c.var.db
        .update(pages)
        .set({ metaDescription, updatedAt: Date.now() })
        .where(eq(pages.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .patch(
    "/:id{[0-9]+}/layout",
    zValidator("json", z.object({ layoutId: z.number() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { layoutId } = c.req.valid("json");
      const result = await c.var.db
        .update(pages)
        .set({ layoutId, updatedAt: Date.now() })
        .where(eq(pages.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  );
