import { zValidator } from "@hono/zod-validator";
import { and, eq, or, sql, inArray } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { generateKeyBetween } from "fractional-indexing";
import { Hono } from "hono";
import { z } from "zod";

import { assertBlockAccess, assertPageAccess } from "../authorization";
import type { AppEnv } from "../types";
import { layouts } from "./layouts";
import { pages } from "./pages";
import { projects } from "./projects";

// --- Schema ---

export const blocks = sqliteTable(
  "blocks",
  {
    id: int().primaryKey({ autoIncrement: true }),
    pageId: int("page_id").references(() => pages.id),
    layoutId: int("layout_id").references(() => layouts.id),
    type: text().notNull(),
    content: text({ mode: "json" }).notNull(),
    settings: text({ mode: "json" }),
    placement: text().$type<"before" | "after">(),
    summary: text().notNull().default(""),
    position: text().notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("blocks_page_idx").on(table.pageId),
    index("blocks_layout_idx").on(table.layoutId),
    index("blocks_type_idx").on(table.type),
  ],
);

// --- Routes ---

const createBlockSchema = z.object({
  pageId: z.number(),
  type: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  afterPosition: z.string().nullable().optional(),
});

export const blockRoutes = new Hono<AppEnv>()
  .get("/usage-counts", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await c.var.db
      .select({
        type: blocks.type,
        count: sql<number>`count(*)`,
      })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .innerJoin(projects, or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)))
      .where(eq(projects.organizationSlug, orgSlug))
      .groupBy(blocks.type);
    return c.json(result);
  })
  .post("/", zValidator("json", createBlockSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const { pageId, type, content, settings, afterPosition } = c.req.valid("json");
    if (!(await assertPageAccess(c.var.db, pageId, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const now = Date.now();
    const position = generateKeyBetween(afterPosition ?? null, null);
    const result = await c.var.db
      .insert(blocks)
      .values({
        pageId,
        type,
        content,
        settings: settings ?? null,
        position,
        summary: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(result, 201);
  })
  .patch(
    "/:id{[0-9]+}/content",
    zValidator("json", z.object({ content: z.unknown() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertBlockAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { content } = c.req.valid("json");
      const result = await c.var.db
        .update(blocks)
        .set({ content, updatedAt: Date.now() })
        .where(eq(blocks.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .patch(
    "/:id{[0-9]+}/settings",
    zValidator("json", z.object({ settings: z.unknown() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertBlockAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { settings } = c.req.valid("json");
      const result = await c.var.db
        .update(blocks)
        .set({ settings, updatedAt: Date.now() })
        .where(eq(blocks.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .patch(
    "/:id{[0-9]+}/position",
    zValidator(
      "json",
      z.object({
        afterPosition: z.string().nullable().optional(),
        beforePosition: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertBlockAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { afterPosition, beforePosition } = c.req.valid("json");
      const position = generateKeyBetween(afterPosition ?? null, beforePosition ?? null);
      const result = await c.var.db
        .update(blocks)
        .set({ position, updatedAt: Date.now() })
        .where(eq(blocks.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .delete("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertBlockAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const result = await c.var.db.delete(blocks).where(eq(blocks.id, id)).returning().get();
    return c.json(result);
  })
  .post(
    "/delete-many",
    zValidator("json", z.object({ blockIds: z.array(z.number()) })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const { blockIds } = c.req.valid("json");
      if (blockIds.length === 0) return c.json([]);
      // Verify all blocks belong to the user's org
      const authorizedBlocks = await c.var.db
        .select({ id: blocks.id })
        .from(blocks)
        .leftJoin(pages, eq(blocks.pageId, pages.id))
        .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
        .innerJoin(
          projects,
          or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)),
        )
        .where(and(inArray(blocks.id, blockIds), eq(projects.organizationSlug, orgSlug)));
      if (authorizedBlocks.length !== blockIds.length) {
        return c.json({ error: "Not found" }, 404);
      }
      const result = await c.var.db.delete(blocks).where(inArray(blocks.id, blockIds)).returning();
      return c.json(result);
    },
  )
  .post("/:id{[0-9]+}/duplicate", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    const access = await assertBlockAccess(c.var.db, id, orgSlug);
    if (!access) return c.json({ error: "Not found" }, 404);
    const original = access.block;

    const now = Date.now();
    const position = generateKeyBetween(original.position, null);
    const result = await c.var.db
      .insert(blocks)
      .values({
        pageId: original.pageId,
        layoutId: original.layoutId,
        type: original.type,
        content: original.content,
        settings: original.settings,
        placement: original.placement,
        summary: original.summary,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(result, 201);
  });
