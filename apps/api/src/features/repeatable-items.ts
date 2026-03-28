import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { generateKeyBetween } from "fractional-indexing";
import { Hono } from "hono";
import { z } from "zod";

import { assertBlockAccess, assertRepeatableItemAccess } from "../authorization";
import type { AppEnv } from "../types";
import { blocks } from "./blocks";

// --- Schema ---

export const repeatableItems = sqliteTable(
  "repeatable_items",
  {
    id: int().primaryKey({ autoIncrement: true }),
    blockId: int("block_id")
      .notNull()
      .references(() => blocks.id),
    fieldName: text("field_name").notNull(),
    content: text({ mode: "json" }).notNull(),
    summary: text().notNull().default(""),
    position: text().notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("repeatable_items_block_field_idx").on(table.blockId, table.fieldName),
    index("repeatable_items_block_idx").on(table.blockId),
  ],
);

// --- Routes ---

const createItemSchema = z.object({
  blockId: z.number(),
  fieldName: z.string(),
  content: z.unknown(),
  afterPosition: z.string().nullable().optional(),
});

export const repeatableItemRoutes = new Hono<AppEnv>()
  .post("/", zValidator("json", createItemSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const { blockId, fieldName, content, afterPosition } = c.req.valid("json");
    if (!(await assertBlockAccess(c.var.db, blockId, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const now = Date.now();
    const position = generateKeyBetween(afterPosition ?? null, null);
    const result = await c.var.db
      .insert(repeatableItems)
      .values({
        blockId,
        fieldName,
        content,
        summary: "",
        position,
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
      if (!(await assertRepeatableItemAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { content } = c.req.valid("json");
      const result = await c.var.db
        .update(repeatableItems)
        .set({ content, updatedAt: Date.now() })
        .where(eq(repeatableItems.id, id))
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
      if (!(await assertRepeatableItemAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { afterPosition, beforePosition } = c.req.valid("json");
      const position = generateKeyBetween(afterPosition ?? null, beforePosition ?? null);
      const result = await c.var.db
        .update(repeatableItems)
        .set({ position, updatedAt: Date.now() })
        .where(eq(repeatableItems.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .post("/:id{[0-9]+}/duplicate", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    const access = await assertRepeatableItemAccess(c.var.db, id, orgSlug);
    if (!access) return c.json({ error: "Not found" }, 404);
    const original = access.item;

    const now = Date.now();
    const position = generateKeyBetween(original.position, null);
    const result = await c.var.db
      .insert(repeatableItems)
      .values({
        blockId: original.blockId,
        fieldName: original.fieldName,
        content: original.content,
        summary: original.summary,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(result, 201);
  })
  .delete("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertRepeatableItemAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const result = await c.var.db
      .delete(repeatableItems)
      .where(eq(repeatableItems.id, id))
      .returning()
      .get();
    return c.json(result);
  });
