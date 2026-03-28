import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";

import { getAuthorizedProject } from "../authorization";
import type { AppEnv } from "../types";
import { projects } from "./projects";

// --- Schema ---

export const blockDefinitions = sqliteTable(
  "block_definitions",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    blockId: text("block_id").notNull(),
    title: text().notNull(),
    description: text().notNull(),
    contentSchema: text("content_schema", { mode: "json" }).notNull(),
    settingsSchema: text("settings_schema", { mode: "json" }),
    layoutOnly: int("layout_only", { mode: "boolean" }),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("block_definitions_project_idx").on(table.projectId),
    index("block_definitions_project_block_idx").on(table.projectId, table.blockId),
  ],
);

// --- Routes ---

const definitionSchema = z.object({
  projectId: z.number(),
  blockId: z.string(),
  title: z.string(),
  description: z.string(),
  contentSchema: z.unknown(),
  settingsSchema: z.unknown().optional(),
  layoutOnly: z.boolean().optional(),
});

const syncSchema = z.object({
  projectId: z.number(),
  definitions: z.array(
    z.object({
      blockId: z.string(),
      title: z.string(),
      description: z.string(),
      contentSchema: z.unknown(),
      settingsSchema: z.unknown().optional(),
      layoutOnly: z.boolean().optional(),
    }),
  ),
});

export const blockDefinitionRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const projectId = Number(c.req.query("projectId"));
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const result = await c.var.db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.projectId, projectId));
    return c.json(result);
  })
  .post("/sync", zValidator("json", syncSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const { projectId, definitions } = c.req.valid("json");
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const now = Date.now();
    const results = [];

    for (const def of definitions) {
      const existing = await c.var.db
        .select()
        .from(blockDefinitions)
        .where(
          and(eq(blockDefinitions.projectId, projectId), eq(blockDefinitions.blockId, def.blockId)),
        )
        .get();

      if (existing) {
        const updated = await c.var.db
          .update(blockDefinitions)
          .set({
            title: def.title,
            description: def.description,
            contentSchema: def.contentSchema,
            settingsSchema: def.settingsSchema ?? null,
            layoutOnly: def.layoutOnly ?? null,
            updatedAt: now,
          })
          .where(eq(blockDefinitions.id, existing.id))
          .returning()
          .get();
        results.push(updated);
      } else {
        const created = await c.var.db
          .insert(blockDefinitions)
          .values({
            projectId,
            blockId: def.blockId,
            title: def.title,
            description: def.description,
            contentSchema: def.contentSchema,
            settingsSchema: def.settingsSchema ?? null,
            layoutOnly: def.layoutOnly ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        results.push(created);
      }
    }

    return c.json(results);
  })
  .put("/", zValidator("json", definitionSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const body = c.req.valid("json");
    const project = await getAuthorizedProject(c.var.db, body.projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const now = Date.now();

    const existing = await c.var.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, body.projectId),
          eq(blockDefinitions.blockId, body.blockId),
        ),
      )
      .get();

    if (existing) {
      const result = await c.var.db
        .update(blockDefinitions)
        .set({
          title: body.title,
          description: body.description,
          contentSchema: body.contentSchema,
          settingsSchema: body.settingsSchema ?? null,
          layoutOnly: body.layoutOnly ?? null,
          updatedAt: now,
        })
        .where(eq(blockDefinitions.id, existing.id))
        .returning()
        .get();
      return c.json(result);
    }

    const result = await c.var.db
      .insert(blockDefinitions)
      .values({
        ...body,
        settingsSchema: body.settingsSchema ?? null,
        layoutOnly: body.layoutOnly ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(result, 201);
  })
  .delete("/:projectId{[0-9]+}/:blockId", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const projectId = Number(c.req.param("projectId"));
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const blockId = c.req.param("blockId");
    const result = await c.var.db
      .delete(blockDefinitions)
      .where(and(eq(blockDefinitions.projectId, projectId), eq(blockDefinitions.blockId, blockId)))
      .returning()
      .get();
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  });
