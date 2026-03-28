import { zValidator } from "@hono/zod-validator";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { eq, sql } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { outdent } from "outdent";
import { z } from "zod";

import { assertFileAccess, getAuthorizedProject } from "../authorization";
import type { Database } from "../db";
import { scheduleAiJob } from "../lib/schedule-ai-job";
import type { AppEnv } from "../types";
import { blocks } from "./blocks";
import { projects } from "./projects";

// --- Schema ---

export const files = sqliteTable(
  "files",
  {
    id: int().primaryKey({ autoIncrement: true }),
    projectId: int("project_id").references(() => projects.id),
    url: text().notNull(),
    alt: text().notNull().default(""),
    filename: text().notNull(),
    mimeType: text("mime_type").notNull(),
    size: int().notNull(),
    blobId: text("blob_id").notNull(),
    path: text().notNull(),
    aiMetadataEnabled: int("ai_metadata_enabled", { mode: "boolean" }),
    createdAt: int("created_at").notNull(),
    updatedAt: int("updated_at").notNull(),
  },
  (table) => [
    index("files_blob_id_idx").on(table.blobId),
    index("files_project_idx").on(table.projectId),
  ],
);

// --- AI Executor ---

async function generateImageMetadata(apiKey: string, imageUrl: string, currentFilename: string) {
  return await chat({
    adapter: createOpenRouterText("google/gemini-2.5-flash-lite", apiKey),
    outputSchema: z.object({
      filename: z.string(),
      alt: z.string(),
    }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image" as const,
            source: { type: "url" as const, value: imageUrl },
          },
          {
            type: "text" as const,
            content: outdent`
              Analyze this image and generate metadata for it:
              - "filename": a clean, descriptive filename in kebab-case (no extension). The current filename is "${currentFilename}". If it's already human-readable and descriptive, keep it as-is (without the extension). Only rewrite it if it's gibberish, a random hash, or not meaningful (e.g. "IMG_2847", "DSC0042", "a7f3b2c9").
              - "alt": SEO-optimized alt text describing the image content. Be concise but descriptive (1 sentence max).
            `,
          },
        ],
      },
    ],
  });
}

export async function executeFileMetadata(db: Database, apiKey: string, fileId: number) {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file || file.aiMetadataEnabled === false) return;

  const metadata = await generateImageMetadata(apiKey, file.url, file.filename);

  await db
    .update(files)
    .set({ filename: metadata.filename, alt: metadata.alt, updatedAt: Date.now() })
    .where(eq(files.id, fileId));
}

// --- Routes ---

const commitFileSchema = z.object({
  projectId: z.number(),
  blobId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  siteUrl: z.string(),
});

export const fileRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const result = await c.var.db
      .select({ file: files })
      .from(files)
      .innerJoin(projects, eq(projects.id, files.projectId))
      .where(eq(projects.organizationSlug, orgSlug));
    return c.json(result.map((r) => r.file));
  })
  .get("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    const result = await assertFileAccess(c.var.db, id, orgSlug);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result.file);
  })
  .get("/:id{[0-9]+}/usage-count", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const fileId = Number(c.req.param("id"));
    const access = await assertFileAccess(c.var.db, fileId, orgSlug);
    if (!access) return c.json({ error: "Not found" }, 404);

    // Count blocks that reference this file's URL in their JSON content
    const result = await c.var.db
      .select({ count: sql<number>`count(*)` })
      .from(blocks)
      .where(sql`json_extract(${blocks.content}, '$') LIKE ${"%" + access.file.url + "%"}`)
      .get();
    return c.json({ count: result?.count ?? 0 });
  })
  .post("/", zValidator("json", commitFileSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const { projectId, blobId, filename, contentType, size, siteUrl } = c.req.valid("json");
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);
    const now = Date.now();
    const path = `/files/${blobId}/${filename}`;
    const url = `${siteUrl}${path}`;
    const result = await c.var.db
      .insert(files)
      .values({
        projectId,
        blobId,
        filename,
        mimeType: contentType,
        size,
        path,
        url,
        alt: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
      entityTable: "files",
      entityId: result.id,
      type: "fileMetadata",
      delayMs: 0,
    });

    return c.json(result, 201);
  })
  .patch("/:id{[0-9]+}/alt", zValidator("json", z.object({ alt: z.string() })), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertFileAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const { alt } = c.req.valid("json");
    const result = await c.var.db
      .update(files)
      .set({ alt, updatedAt: Date.now() })
      .where(eq(files.id, id))
      .returning()
      .get();
    return c.json(result);
  })
  .patch(
    "/:id{[0-9]+}/filename",
    zValidator("json", z.object({ filename: z.string() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertFileAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { filename } = c.req.valid("json");
      const result = await c.var.db
        .update(files)
        .set({ filename, updatedAt: Date.now() })
        .where(eq(files.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .delete("/:id{[0-9]+}", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertFileAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const result = await c.var.db.delete(files).where(eq(files.id, id)).returning().get();
    return c.json(result);
  })
  .post(
    "/:id{[0-9]+}/replace",
    zValidator("json", z.object({ newFileId: z.number() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const oldId = Number(c.req.param("id"));
      const { newFileId } = c.req.valid("json");

      const oldAccess = await assertFileAccess(c.var.db, oldId, orgSlug);
      const newAccess = await assertFileAccess(c.var.db, newFileId, orgSlug);
      if (!oldAccess || !newAccess) return c.json({ error: "Not found" }, 404);

      // Update all blocks that reference the old file URL
      await c.var.db.run(
        sql`UPDATE ${blocks} SET ${blocks.content} = REPLACE(CAST(${blocks.content} AS TEXT), ${oldAccess.file.url}, ${newAccess.file.url}), ${blocks.updatedAt} = ${Date.now()} WHERE CAST(${blocks.content} AS TEXT) LIKE ${"%" + oldAccess.file.url + "%"}`,
      );

      return c.json({ replaced: true });
    },
  )
  .patch(
    "/:id{[0-9]+}/ai-metadata",
    zValidator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      const orgSlug = c.var.orgSlug!;
      const id = Number(c.req.param("id"));
      if (!(await assertFileAccess(c.var.db, id, orgSlug))) {
        return c.json({ error: "Not found" }, 404);
      }
      const { enabled } = c.req.valid("json");
      const result = await c.var.db
        .update(files)
        .set({ aiMetadataEnabled: enabled, updatedAt: Date.now() })
        .where(eq(files.id, id))
        .returning()
        .get();
      return c.json(result);
    },
  )
  .post("/:id{[0-9]+}/generate-metadata", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertFileAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    await executeFileMetadata(c.var.db, c.env.OPEN_ROUTER_API_KEY, id);
    const updated = await c.var.db.select().from(files).where(eq(files.id, id)).get();
    return c.json(updated);
  });
