import { zValidator } from "@hono/zod-validator";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { and, eq, or, sql, inArray } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { generateKeyBetween } from "fractional-indexing";
import { Hono } from "hono";
import { outdent } from "outdent";
import { z } from "zod";

import { assertBlockAccess, assertPageAccess } from "../authorization";
import type { Database } from "../db";
import { contentToMarkdown } from "../lib/content-markdown";
import { scheduleAiJob } from "../lib/schedule-ai-job";
import type { AppEnv } from "../types";
import { blockDefinitions } from "./block-definitions";
import { layouts } from "./layouts";
import { pages } from "./pages";
import { projects } from "./projects";
import { repeatableItems } from "./repeatable-items";

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

// --- AI Executor ---

async function generateObjectSummary(
  apiKey: string,
  options: { type: string; markdown: string; previousSummary?: string },
) {
  const stabilityBlock = options.previousSummary
    ? outdent`

      <previous_summary>${options.previousSummary}</previous_summary>
      <stability_instruction>
        A summary was previously generated for this content.
        Return the SAME summary unless it is no longer accurate.
        Only change it if the content has meaningfully changed.
      </stability_instruction>
    `
    : "";

  return await chat({
    adapter: createOpenRouterText("openai/gpt-oss-20b", apiKey),
    stream: false,
    messages: [
      {
        role: "user",
        content: outdent`
            <instruction>
              Generate a concise summary for a piece of website content.
            </instruction>

            <constraints>
              - MAXIMUM 4 WORDS
              - Capture the main idea or purpose
              - Be descriptive and specific to the content type
              - Use sentence case (only capitalize the first word and proper nouns)
              - Don't use markdown, just plain text
              - Don't use punctuation
              - Use abbreviations or acronyms where appropriate
            </constraints>

            <context>
              <type>${options.type}</type>
              <content>${options.markdown}</content>
            </context>
            ${stabilityBlock}

            <examples>
              <example>
                <type>paragraph</type>
                <content>{"text": "This is a description of how our service works in detail."}</content>
                <output>Service explanation details</output>
              </example>

              <example>
                <type>button</type>
                <content>{"text": "Submit Form", "action": "submit"}</content>
                <output>Submit form button</output>
              </example>
            </examples>

            <format>
              Return only the summary text, nothing else.
            </format>
          `,
      },
    ],
  });
}

function sortByPosition<T extends { position: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.position.localeCompare(b.position));
}

async function assembleBlockContent(db: Database, blockId: number) {
  const block = await db.select().from(blocks).where(eq(blocks.id, blockId)).get();
  if (!block) return null;

  // Get block definition for content schema and field order
  let projectId: number | null = null;
  if (block.pageId) {
    const page = await db.select().from(pages).where(eq(pages.id, block.pageId)).get();
    projectId = page?.projectId ?? null;
  } else if (block.layoutId) {
    const layout = await db.select().from(layouts).where(eq(layouts.id, block.layoutId)).get();
    projectId = layout?.projectId ?? null;
  }

  const def = projectId
    ? await db
        .select()
        .from(blockDefinitions)
        .where(
          and(eq(blockDefinitions.projectId, projectId), eq(blockDefinitions.blockId, block.type)),
        )
        .get()
    : null;

  const contentSchema = (def?.contentSchema as Record<string, any>) ?? null;
  const fieldOrder = contentSchema?.properties
    ? Object.keys(contentSchema.properties as Record<string, unknown>)
    : undefined;

  // Merge repeatable items into content
  const items = sortByPosition(
    await db.select().from(repeatableItems).where(eq(repeatableItems.blockId, blockId)),
  );

  const content = { ...(block.content as Record<string, unknown>) };
  const fieldNames = new Set(items.map((item) => item.fieldName));
  for (const fieldName of fieldNames) {
    content[fieldName] = items.filter((i) => i.fieldName === fieldName);
  }

  // Reorder keys to match field order from block definition
  if (fieldOrder) {
    const ordered: Record<string, unknown> = {};
    for (const key of fieldOrder) {
      if (key in content) ordered[key] = content[key];
    }
    for (const key of Object.keys(content)) {
      if (!(key in ordered)) ordered[key] = content[key];
    }
    return { block, content: ordered, contentSchema };
  }

  return { block, content, contentSchema };
}

/**
 * Generates and stores a summary for a block.
 * Returns `{ pageId }` if the parent page has AI SEO enabled (caller should cascade).
 */
export async function executeBlockSummary(
  db: Database,
  apiKey: string,
  blockId: number,
): Promise<{ pageId: number } | null> {
  const assembled = await assembleBlockContent(db, blockId);
  if (!assembled) return null;

  const { block, content, contentSchema } = assembled;

  const markdown =
    contentSchema?.toMarkdown && contentSchema?.properties
      ? contentToMarkdown(contentSchema.toMarkdown, contentSchema.properties, content)
      : JSON.stringify(content);

  const summary = await generateObjectSummary(apiKey, {
    type: block.type,
    markdown,
    previousSummary: block.summary,
  });

  await db.update(blocks).set({ summary, updatedAt: Date.now() }).where(eq(blocks.id, blockId));

  // Check if we should cascade to page SEO
  if (summary !== block.summary && block.pageId) {
    const page = await db.select().from(pages).where(eq(pages.id, block.pageId)).get();
    if (page?.aiSeoEnabled !== false) {
      return { pageId: block.pageId };
    }
  }

  return null;
}

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

    scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
      entityTable: "blocks",
      entityId: result.id,
      type: "summary",
      delayMs: 0,
    });

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

      scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
        entityTable: "blocks",
        entityId: id,
        type: "summary",
        delayMs: 5000,
      });

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
  .post("/:id{[0-9]+}/generate-summary", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertBlockAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const seoStale = await executeBlockSummary(c.var.db, c.env.OPEN_ROUTER_API_KEY, id);
    if (seoStale) {
      scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
        entityTable: "pages",
        entityId: seoStale.pageId,
        type: "seo",
        delayMs: 15000,
      });
    }
    const updated = await c.var.db.select().from(blocks).where(eq(blocks.id, id)).get();
    return c.json(updated);
  })
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
