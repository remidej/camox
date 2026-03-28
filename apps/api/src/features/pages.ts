import { zValidator } from "@hono/zod-validator";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { eq, inArray } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { generateKeyBetween } from "fractional-indexing";
import { Hono } from "hono";
import { outdent } from "outdent";
import { z } from "zod";

import { assertPageAccess, getAuthorizedProject } from "../authorization";
import type { Database } from "../db";
import { contentToMarkdown } from "../lib/content-markdown";
import { markdownToLexicalState, plainTextToLexicalState } from "../lib/lexical-state";
import { scheduleAiJob } from "../lib/schedule-ai-job";
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

// --- AI Executors ---

const SEO_STRIP_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "position",
  "settings",
  "pageId",
  "blockId",
  "fieldName",
  "summary",
  "_fileId",
]);

function stripNonSeoFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SEO_STRIP_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? stripNonSeoFields(item as Record<string, unknown>)
          : item,
      );
    } else if (value && typeof value === "object") {
      result[key] = stripNonSeoFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function generatePageSeoFromAi(
  apiKey: string,
  options: {
    fullPath: string;
    blocks: { type: string; markdown: string }[];
    previousMetaTitle?: string | null;
    previousMetaDescription?: string | null;
  },
) {
  const stabilityBlock =
    options.previousMetaTitle || options.previousMetaDescription
      ? outdent`

      <previous_metadata>
        <metaTitle>${options.previousMetaTitle ?? ""}</metaTitle>
        <metaDescription>${options.previousMetaDescription ?? ""}</metaDescription>
      </previous_metadata>
      <stability_instruction>
        Metadata was previously generated for this page.
        Return the SAME metadata unless it is no longer accurate.
        Only change it if the page content has meaningfully changed.
      </stability_instruction>
    `
      : "";

  return await chat({
    adapter: createOpenRouterText("google/gemini-3-flash-preview", apiKey),
    outputSchema: z.object({
      metaTitle: z.string(),
      metaDescription: z.string(),
    }),
    messages: [
      {
        role: "user",
        content: outdent`
          <instruction>
            Generate SEO metadata for a web page.
          </instruction>

          <constraints>
            - metaTitle: under 60 characters, concise and descriptive. Use sentence case (only capitalize the first word and proper nouns). Do NOT include the site/brand name — it will be appended automatically. Do NOT use separators like "-", "|", or ":" to split the title into parts.
            - metaDescription: under 160 characters, compelling summary of the page
            - Be specific to the actual content, not generic
            - Don't use markdown, just plain text
          </constraints>

          <page>
            <path>${options.fullPath}</path>
            <blocks>${JSON.stringify(options.blocks)}</blocks>
          </page>
          ${stabilityBlock}
        `,
      },
    ],
  });
}

async function generatePageDraftFromAi(
  apiKey: string,
  options: {
    contentDescription: string;
    blockDefs: {
      blockId: string;
      title: string;
      description: string;
      contentSchema: unknown;
      settingsSchema?: unknown;
    }[];
  },
) {
  const blockDefsForPrompt = options.blockDefs.map((def) => ({
    blockId: def.blockId,
    title: def.title,
    description: def.description,
    contentSchema: def.contentSchema,
    ...(def.settingsSchema ? { settingsSchema: def.settingsSchema } : {}),
  }));

  const text = await chat({
    adapter: createOpenRouterText("google/gemini-3-flash-preview", apiKey),
    stream: false,
    messages: [
      {
        role: "user",
        content: outdent`
          <instruction>
            Generate a page layout with blocks based on the user's description.
          </instruction>

          <available_blocks>
            ${JSON.stringify(blockDefsForPrompt)}
          </available_blocks>

          <page_description>
            ${options.contentDescription}
          </page_description>

          <output_format>
            Return a JSON array of blocks. Each block must have:
            - "type": the blockId from available_blocks
            - "content": an object matching the contentSchema for that block type
            - "settings" (optional): an object matching the settingsSchema for that block type, if it has one

            Only use blocks from available_blocks. Ensure content matches schema constraints (maxLength, etc.).
            For RepeatableObject fields (arrays), provide an array of objects matching the nested schema.
            For settings, pick values from the enum options or boolean values defined in the settingsSchema.
            For String fields, you may use markdown formatting: **bold** and *italic*.

            IMPORTANT: Return ONLY the raw JSON array. Do NOT wrap it in markdown code fences or any other formatting. The response must be valid JSON that can be parsed directly.
          </output_format>
        `,
      },
    ],
  });

  return JSON.parse(text) as {
    type: string;
    content: Record<string, unknown>;
    settings?: Record<string, unknown>;
  }[];
}

export async function executePageSeo(db: Database, apiKey: string, pageId: number) {
  const page = await db.select().from(pages).where(eq(pages.id, pageId)).get();
  if (!page || page.aiSeoEnabled === false) return;

  // Get all blocks for this page
  const pageBlocks = await db.select().from(blocks).where(eq(blocks.pageId, pageId));
  const sorted = pageBlocks.sort((a, b) => a.position.localeCompare(b.position));

  // Get block definitions for content schemas
  const defs = await db
    .select()
    .from(blockDefinitions)
    .where(eq(blockDefinitions.projectId, page.projectId));
  const contentSchemaByType = new Map<string, any>();
  const fieldOrderByType = new Map<string, string[]>();
  for (const def of defs) {
    const schema = def.contentSchema as Record<string, unknown> | null;
    if (schema?.properties) {
      contentSchemaByType.set(def.blockId, schema);
      fieldOrderByType.set(def.blockId, Object.keys(schema.properties as Record<string, unknown>));
    }
  }

  // Assemble content for each block (merge repeatable items)
  const blockIds = sorted.map((b) => b.id);
  const allItems =
    blockIds.length > 0
      ? await db.select().from(repeatableItems).where(inArray(repeatableItems.blockId, blockIds))
      : [];
  const itemsByBlock = new Map<number, typeof allItems>();
  for (const item of allItems) {
    const list = itemsByBlock.get(item.blockId) ?? [];
    list.push(item);
    itemsByBlock.set(item.blockId, list);
  }

  const markdownBlocks = sorted.map((block) => {
    const content = { ...(block.content as Record<string, unknown>) };
    const items = itemsByBlock.get(block.id) ?? [];
    const fieldNames = new Set(items.map((i) => i.fieldName));
    for (const fieldName of fieldNames) {
      content[fieldName] = items.filter((i) => i.fieldName === fieldName);
    }

    const stripped = stripNonSeoFields(content);
    const schema = contentSchemaByType.get(block.type);

    return {
      type: block.type,
      markdown:
        schema?.toMarkdown && schema?.properties
          ? contentToMarkdown(schema.toMarkdown, schema.properties, stripped)
          : JSON.stringify(stripped),
    };
  });

  const seo = await generatePageSeoFromAi(apiKey, {
    fullPath: page.fullPath,
    blocks: markdownBlocks,
    previousMetaTitle: page.metaTitle,
    previousMetaDescription: page.metaDescription,
  });

  await db
    .update(pages)
    .set({
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      updatedAt: Date.now(),
    })
    .where(eq(pages.id, pageId));
}

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

const DEFAULT_HERO_BLOCK = {
  type: "hero",
  content: {
    title: plainTextToLexicalState("A page title"),
    description: plainTextToLexicalState("An engaging block description"),
    cta: { type: "external", text: "Get started", href: "/", newTab: false },
  },
};

const createPageSchema = z.object({
  projectId: z.number(),
  pathSegment: z.string(),
  parentPageId: z.number().optional(),
  layoutId: z.number(),
  contentDescription: z.string().optional(),
});

export const pageRoutes = new Hono<AppEnv>()
  .post("/", zValidator("json", createPageSchema), async (c) => {
    const orgSlug = c.var.orgSlug!;
    const { projectId, pathSegment, parentPageId, layoutId, contentDescription } =
      c.req.valid("json");
    const project = await getAuthorizedProject(c.var.db, projectId, orgSlug);
    if (!project) return c.json({ error: "Not found" }, 404);

    let generatedBlocks: {
      type: string;
      content: Record<string, unknown>;
      settings?: Record<string, unknown>;
    }[] = [DEFAULT_HERO_BLOCK];

    if (contentDescription) {
      try {
        const allDefs = await c.var.db
          .select()
          .from(blockDefinitions)
          .where(eq(blockDefinitions.projectId, projectId));
        const defs = allDefs.filter((d) => !d.layoutOnly);

        if (defs.length > 0) {
          generatedBlocks = await generatePageDraftFromAi(c.env.OPEN_ROUTER_API_KEY, {
            contentDescription,
            blockDefs: defs.map((d) => ({
              blockId: d.blockId,
              title: d.title,
              description: d.description ?? "",
              contentSchema: d.contentSchema,
              settingsSchema: d.settingsSchema ?? undefined,
            })),
          });

          // Convert markdown string fields to Lexical JSON
          const defsByType = new Map(defs.map((d) => [d.blockId, d]));
          for (const block of generatedBlocks) {
            const def = defsByType.get(block.type);
            const props = (def?.contentSchema as any)?.properties;
            if (!props) continue;
            for (const [key, schemaProp] of Object.entries(props)) {
              if (
                (schemaProp as any)?.fieldType === "String" &&
                typeof block.content[key] === "string"
              ) {
                block.content[key] = markdownToLexicalState(block.content[key] as string);
              }
            }
          }
        }
      } catch (error) {
        console.error("AI generation failed, using default block:", error);
        generatedBlocks = [DEFAULT_HERO_BLOCK];
      }
    }

    // Compute full path
    let fullPath = `/${pathSegment}`;
    if (parentPageId) {
      const parent = await c.var.db.select().from(pages).where(eq(pages.id, parentPageId)).get();
      if (parent) {
        fullPath = `${parent.fullPath}/${pathSegment}`;
      }
    }

    const now = Date.now();
    const page = await c.var.db
      .insert(pages)
      .values({
        projectId,
        pathSegment,
        fullPath,
        parentPageId: parentPageId ?? null,
        layoutId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    // Create blocks
    let prevPosition: string | null = null;
    for (const genBlock of generatedBlocks) {
      const position = generateKeyBetween(prevPosition, null);
      prevPosition = position;

      // Separate scalar content from array fields (repeatable items)
      const scalarContent: Record<string, unknown> = {};
      const arrayFields: Record<string, unknown[]> = {};
      for (const [key, value] of Object.entries(genBlock.content)) {
        if (Array.isArray(value)) {
          arrayFields[key] = value;
        } else {
          scalarContent[key] = value;
        }
      }

      const block = await c.var.db
        .insert(blocks)
        .values({
          pageId: page.id,
          type: genBlock.type,
          content: scalarContent,
          settings: genBlock.settings ?? null,
          summary: "",
          position,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      // Create repeatable items for array fields
      for (const [fieldName, items] of Object.entries(arrayFields)) {
        let itemPrevPos: string | null = null;
        for (const itemContent of items) {
          const itemPos = generateKeyBetween(itemPrevPos, null);
          itemPrevPos = itemPos;
          await c.var.db.insert(repeatableItems).values({
            blockId: block.id,
            fieldName,
            content: itemContent,
            summary: "",
            position: itemPos,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
        entityTable: "blocks",
        entityId: block.id,
        type: "summary",
        delayMs: 0,
      });
    }

    return c.json({ page, fullPath: page.fullPath }, 201);
  })
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
  )
  .post("/:id{[0-9]+}/generate-seo", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertPageAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    await executePageSeo(c.var.db, c.env.OPEN_ROUTER_API_KEY, id);
    const updated = await c.var.db.select().from(pages).where(eq(pages.id, id)).get();
    return c.json(updated);
  });
