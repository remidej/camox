import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { int, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";

import { getAuthorizedProject, getAuthorizedProjectBySlug } from "../authorization";
import type { AppEnv } from "../types";

// --- Schema ---

export const projects = sqliteTable(
  "projects",
  {
    id: int().primaryKey({ autoIncrement: true }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    domain: text().notNull(),
    organizationSlug: text("organization_slug").notNull(),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("projects_slug_idx").on(table.slug),
    index("projects_domain_idx").on(table.domain),
    index("projects_organization_idx").on(table.organizationSlug),
  ],
);

// --- Routes ---

const createProjectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  domain: z.string(),
  organizationSlug: z.string(),
});

const updateProjectSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  domain: z.string(),
});

export const projectRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await c.var.db
      .select()
      .from(projects)
      .where(eq(projects.organizationSlug, orgSlug));
    return c.json(result);
  })
  .get("/first", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await c.var.db
      .select()
      .from(projects)
      .where(eq(projects.organizationSlug, orgSlug))
      .limit(1)
      .get();
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  })
  .get("/by-slug/:slug", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await getAuthorizedProjectBySlug(c.var.db, c.req.param("slug"), orgSlug);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  })
  .get("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await getAuthorizedProject(c.var.db, Number(c.req.param("id")), orgSlug);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  })
  .post("/", zValidator("json", createProjectSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const body = c.req.valid("json");
    if (body.organizationSlug !== orgSlug) {
      return c.json({ error: "Not found" }, 404);
    }
    const now = Date.now();
    const result = await c.var.db
      .insert(projects)
      .values({ ...body, createdAt: now, updatedAt: now })
      .returning()
      .get();
    return c.json(result, 201);
  })
  .patch("/:id{[0-9]+}", zValidator("json", updateProjectSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    const project = await getAuthorizedProject(c.var.db, id, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const body = c.req.valid("json");
    const result = await c.var.db
      .update(projects)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(projects.id, id))
      .returning()
      .get();
    return c.json(result);
  })
  .delete("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    const project = await getAuthorizedProject(c.var.db, id, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const result = await c.var.db.delete(projects).where(eq(projects.id, id)).returning().get();
    return c.json(result);
  });
