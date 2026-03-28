import { zValidator } from "@hono/zod-validator";
import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { eq } from "drizzle-orm";
import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { generateKeyBetween } from "fractional-indexing";
import { Hono } from "hono";
import { outdent } from "outdent";
import { z } from "zod";

import { assertBlockAccess, assertRepeatableItemAccess } from "../authorization";
import type { Database } from "../db";
import { scheduleAiJob } from "../lib/schedule-ai-job";
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

/**
 * Generates and stores a summary for a repeatable item.
 * Returns `{ blockId }` so the caller can cascade to block summary regeneration.
 */
export async function executeRepeatableItemSummary(
  db: Database,
  apiKey: string,
  itemId: number,
): Promise<{ blockId: number } | null> {
  const item = await db.select().from(repeatableItems).where(eq(repeatableItems.id, itemId)).get();
  if (!item) return null;

  const block = await db.select().from(blocks).where(eq(blocks.id, item.blockId)).get();
  if (!block) return null;

  const summary = await generateObjectSummary(apiKey, {
    type: block.type,
    markdown: JSON.stringify(item.content),
    previousSummary: item.summary,
  });

  await db
    .update(repeatableItems)
    .set({ summary, updatedAt: Date.now() })
    .where(eq(repeatableItems.id, itemId));

  if (summary !== item.summary) {
    return { blockId: item.blockId };
  }

  return null;
}

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

    scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
      entityTable: "repeatableItems",
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

      scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
        entityTable: "repeatableItems",
        entityId: id,
        type: "summary",
        delayMs: 5000,
      });

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
  .post("/:id{[0-9]+}/generate-summary", async (c) => {
    const orgSlug = c.var.orgSlug!;
    const id = Number(c.req.param("id"));
    if (!(await assertRepeatableItemAccess(c.var.db, id, orgSlug))) {
      return c.json({ error: "Not found" }, 404);
    }
    const cascade = await executeRepeatableItemSummary(c.var.db, c.env.OPEN_ROUTER_API_KEY, id);
    if (cascade) {
      scheduleAiJob(c.env.AI_JOB_SCHEDULER, {
        entityTable: "blocks",
        entityId: cascade.blockId,
        type: "summary",
        delayMs: 5000,
      });
    }
    const updated = await c.var.db
      .select()
      .from(repeatableItems)
      .where(eq(repeatableItems.id, id))
      .get();
    return c.json(updated);
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
