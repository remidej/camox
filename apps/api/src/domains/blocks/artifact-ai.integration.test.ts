import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { contentFieldBuilder as field } from "../../../../../packages/sdk/src/core/lib/contentType";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { pages, repeatableItems } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { executePageSeo } from "../pages/ai";
import { executeRepeatableItemSummary } from "../repeatable-items/service";
import { createBlock, executeBlockSummary, getPageMarkdown } from "./service";

const { chat, scheduleAiJob } = vi.hoisted(() => {
  vi.resetModules();
  return { chat: vi.fn(), scheduleAiJob: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@tanstack/ai", () => ({ chat }));
vi.mock("../../lib/schedule-ai-job", () => ({ scheduleAiJob }));

afterEach(() => vi.clearAllMocks());

// Recognizable pieces of each source that must never reach an LLM.
const titled = `<!doctype html><title>Orbiting  moons</title><script>const orbitSecret = 1;</script>`;
const untitled = `<!doctype html><script>const sceneSecret = 2;</script>`;
const SOURCE_PIECES = /orbitSecret|sceneSecret|<script|doctype/;

/** Block content schemas as the SDK syncs them, with and without a Markdown template. */
function artifactSchema(toMarkdown?: string[]) {
  return {
    type: "object",
    properties: {
      heading: field.string({ default: "" }),
      visual: field.artifact({ size: "fill" }),
      scenes: {
        type: "array",
        fieldType: "Repeater",
        items: {
          type: "object",
          properties: {
            caption: field.string({ default: "" }),
            scene: field.artifact({ size: "content" }),
          },
        },
      },
    },
    ...(toMarkdown ? { toMarkdown } : {}),
  };
}

async function fixture(type: "templated" | "raw") {
  const base = await createProjectFixture(crypto.randomUUID());
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: type,
      title: "Visual",
      description: "Artifact AI fixture",
      contentSchema: artifactSchema(
        type === "templated" ? ["# {{heading}}", "{{visual}}", "{{scenes}}"] : undefined,
      ),
    }),
  );
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
      layoutId: base.layout.layoutId,
      pathSegment: "visuals",
      fullPath: "/visuals",
      nickname: "Visuals",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const block = await runService(
    createBlock(
      ctx,
      {
        pageId: page.id,
        type,
        content: {
          heading: "Space",
          visual: titled,
          scenes: [{ caption: "Moon", scene: untitled }],
        },
      },
      null,
    ),
  );
  const [item] = await base.db
    .select()
    .from(repeatableItems)
    .where(eq(repeatableItems.blockId, block.id));
  return { ...base, ctx, page, block, item };
}

/** Everything sent to the LLM in the mocked `chat` calls. */
const prompts = () => JSON.stringify(chat.mock.calls);

describe("artifact Markdown Representation", () => {
  it("is the artifact's title, or Untitled artifact", async () => {
    const { ctx, page } = await fixture("templated");
    const { markdown } = await runService(getPageMarkdown(ctx, { pageId: page.id }, null));
    expect(markdown).toContain("Orbiting moons");
    expect(markdown).toMatch(/Moon — Untitled artifact/);
    expect(markdown).not.toMatch(SOURCE_PIECES);
  });
});

describe("artifact sources are kept out of LLM-bound fallbacks", () => {
  it("page markdown of blocks without a Markdown template", async () => {
    const { ctx, page } = await fixture("raw");
    const { markdown } = await runService(getPageMarkdown(ctx, { pageId: page.id }, null));
    expect(markdown).toContain("Space");
    expect(markdown).toContain("Orbiting moons");
    expect(markdown).not.toMatch(SOURCE_PIECES);
  });

  it("block summaries", async () => {
    const { db, block } = await fixture("raw");
    chat.mockResolvedValueOnce("Space visual");
    await runService(executeBlockSummary(db, "key", block.id, null));
    expect(chat).toHaveBeenCalledOnce();
    expect(prompts()).toContain("Space");
    expect(prompts()).not.toMatch(SOURCE_PIECES);
  });

  it("repeatable item summaries", async () => {
    const { db, item } = await fixture("templated");
    chat.mockResolvedValueOnce("Moon scene");
    await runService(executeRepeatableItemSummary(db, "key", item.id, null));
    expect(chat).toHaveBeenCalledOnce();
    expect(prompts()).toContain("Moon");
    expect(prompts()).not.toMatch(SOURCE_PIECES);
  });

  it("AI SEO", async () => {
    const { db, page } = await fixture("raw");
    chat.mockResolvedValueOnce({ metaTitle: "Space", metaDescription: "Space visuals" });
    await runService(executePageSeo(db, "key", page.id, null));
    expect(chat).toHaveBeenCalledOnce();
    expect(prompts()).toContain("Space");
    expect(prompts()).not.toMatch(SOURCE_PIECES);
  });
});
