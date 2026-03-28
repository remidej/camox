import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";

import { getAuthorizedProject } from "../authorization";
import type { AppEnv } from "../types";
import { projects } from "./projects";

// --- Schema ---

export const layouts = sqliteTable(
  "layouts",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    layoutId: text("layout_id").notNull(),
    description: text(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("layouts_project_idx").on(table.projectId),
    index("layouts_project_layout_idx").on(table.projectId, table.layoutId),
  ],
);

// --- Routes ---

const syncLayoutsSchema = z.object({
  projectId: z.number(),
  layouts: z.array(
    z.object({
      layoutId: z.string(),
      description: z.string(),
      blocks: z.array(
        z.object({
          type: z.string(),
          content: z.unknown(),
          settings: z.unknown().optional(),
          placement: z.enum(["before", "after"]).optional(),
        }),
      ),
    }),
  ),
});

export const layoutRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const projectId = Number(c.req.query("projectId"));
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const result = await c.var.db.select().from(layouts).where(eq(layouts.projectId, projectId));
    return c.json(result);
  })
  .post("/sync", zValidator("json", syncLayoutsSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const { projectId, layouts: layoutDefs } = c.req.valid("json");
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const now = Date.now();
    const results = [];

    for (const def of layoutDefs) {
      const existing = await c.var.db
        .select()
        .from(layouts)
        .where(and(eq(layouts.projectId, projectId), eq(layouts.layoutId, def.layoutId)))
        .get();

      if (existing) {
        const updated = await c.var.db
          .update(layouts)
          .set({ description: def.description, updatedAt: now })
          .where(eq(layouts.id, existing.id))
          .returning()
          .get();
        results.push(updated);
      } else {
        const created = await c.var.db
          .insert(layouts)
          .values({
            projectId,
            layoutId: def.layoutId,
            description: def.description,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        results.push(created);
      }
      // TODO: sync layout blocks when block creation is wired up
    }

    return c.json(results);
  });
