import { describe, expect, it } from "vite-plus/test";

import { blockTypesProvider } from "../../../../../packages/ai-tools/src/providers/block-types";
import { blocksProvider } from "../../../../../packages/ai-tools/src/providers/blocks";
import {
  ARTIFACT_MAX_LENGTH,
  contentFieldBuilder as field,
} from "../../../../../packages/sdk/src/core/lib/contentType";
import { createProjectFixture, createServiceContext, inScope } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { drafts, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createRepeatableItem, updateRepeatableItemContent } from "../repeatable-items/service";
import { createBlock, editBlock, updateBlockContent } from "./service";

// Validate against the schemas the SDK's `field.artifact()` syncs.
const fits = `<title>Fits</title>${"x".repeat(ARTIFACT_MAX_LENGTH - "<title>Fits</title>".length)}`;
const tooLarge = `${fits}x`;

async function fixture(suffix: string) {
  const base = await createProjectFixture(`artifact-${suffix}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "visual",
      title: "Visual",
      description: "Artifact validation fixture",
      contentSchema: {
        type: "object",
        properties: {
          visual: field.artifact({ size: "fill" }),
          scenes: {
            type: "array",
            fieldType: "Repeater",
            items: {
              type: "object",
              properties: { scene: field.artifact({ size: "content" }) },
            },
          },
        },
      },
    }),
  );
  const now = 1_700_000_000_000;
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  // Content is written in drafts (ADR 0003): these writes only need one.
  const openedDraft = await base.db
    .insert(drafts)
    .values({
      projectId: base.project.id,
      kind: "regular",
      createdBy: base.memberUser.id,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  const draft = { id: openedDraft.id, kind: openedDraft.kind, projectId: openedDraft.projectId };
  return { ctx, page, projectId: base.project.id, draft };
}

const tooLargeError = {
  code: "BAD_REQUEST",
  message: expect.stringMatching(new RegExp(`${ARTIFACT_MAX_LENGTH / 1024} KB[\\s\\S]*esm\\.sh`)),
};

describe("artifact content validation", () => {
  it("accepts sources up to the artifact limit and rejects larger ones, pointing to esm.sh", async () => {
    const { ctx, page, draft } = await fixture("block");
    await expect(
      runService(
        createBlock(inScope(ctx, draft), {
          pageId: page.id,
          type: "visual",
          content: { visual: tooLarge },
        }),
      ),
    ).rejects.toMatchObject({ ...tooLargeError, data: { field: "content.visual" } });
    const block = await runService(
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "visual",
        content: { visual: fits },
      }),
    );
    expect(block.content).toMatchObject({ visual: fits });
    await expect(
      runService(
        updateBlockContent(inScope(ctx, draft), { id: block.id, content: { visual: tooLarge } }),
      ),
    ).rejects.toMatchObject(tooLargeError);
    await expect(
      runService(
        updateBlockContent(inScope(ctx, draft), {
          id: block.id,
          content: { scenes: [{ scene: tooLarge }] },
        }),
      ),
    ).rejects.toMatchObject(tooLargeError);
  });

  it("applies the same limit to artifacts in repeatable items", async () => {
    const { ctx, page, draft } = await fixture("item");
    const block = await runService(
      createBlock(inScope(ctx, draft), { pageId: page.id, type: "visual", content: {} }),
    );
    await expect(
      runService(
        createRepeatableItem(inScope(ctx, draft), {
          blockId: block.id,
          fieldName: "scenes",
          content: { scene: tooLarge },
        }),
      ),
    ).rejects.toMatchObject(tooLargeError);
    const item = await runService(
      createRepeatableItem(inScope(ctx, draft), {
        blockId: block.id,
        fieldName: "scenes",
        content: { scene: fits },
      }),
    );
    await expect(
      runService(
        updateRepeatableItemContent(inScope(ctx, draft), {
          id: item.id,
          content: { scene: tooLarge },
        }),
      ),
    ).rejects.toMatchObject(tooLargeError);
  });

  it("accepts sources without a <title>, with a warning naming each untitled artifact", async () => {
    const { ctx, page, draft } = await fixture("warning");
    const untitled = "<p>No title</p>";
    const blank = "<title>  </title><p>Blank title</p>";
    const block = await runService(
      createBlock(inScope(ctx, draft), {
        pageId: page.id,
        type: "visual",
        content: { visual: untitled, scenes: [{ scene: "<title>Ok</title>" }, { scene: blank }] },
      }),
    );
    expect(block.content).toMatchObject({ visual: untitled });
    expect(block.warnings).toEqual([
      expect.stringMatching(/content\.visual[\s\S]*<title>[\s\S]*Untitled artifact/),
      expect.stringMatching(/content\.scenes\[1\]\.scene[\s\S]*<title>/),
    ]);

    const edited = await runService(
      editBlock(inScope(ctx, draft), {
        id: block.id,
        content: { visual: "<title>Titled</title>" },
      }),
    );
    expect(edited).not.toHaveProperty("warnings");
    const emptied = await runService(
      editBlock(inScope(ctx, draft), { id: block.id, content: { visual: "" } }),
    );
    expect(emptied).not.toHaveProperty("warnings");
    expect(
      await runService(
        editBlock(inScope(ctx, draft), { id: block.id, content: { visual: untitled } }),
      ),
    ).toMatchObject({ warnings: [expect.stringMatching(/content\.visual/)] });
  });

  it("surfaces the missing-title warning in the AI tools' responses", async () => {
    const { ctx, page, projectId, draft } = await fixture("warning-tools");
    const context = { ...ctx, projectId, draft: { id: draft.id, create: false } };
    const tools = await blocksProvider(context);
    const tool = (name: string) => tools.find((entry) => entry.name === name)!;
    const created = (await tool("createBlock").handler(
      { pageId: page.id, type: "visual", content: { visual: "<p>No title</p>" } },
      context,
    )) as { id: number; warnings?: string[] };
    expect(created.warnings).toEqual([expect.stringMatching(/content\.visual/)]);
    const edited = (await tool("editBlock").handler(
      { id: created.id, content: { scenes: [{ scene: "<p>No title</p>" }] } },
      context,
    )) as { warnings?: string[] };
    expect(edited.warnings).toEqual([expect.stringMatching(/content\.scenes\[0\]\.scene/)]);
  });

  it("tells agents which fields are artifacts and how each is sized", async () => {
    const { ctx, projectId } = await fixture("describe");
    const context = { ...ctx, projectId };
    const describeBlockTypes = (await blockTypesProvider(context)).find(
      (tool) => tool.name === "describeBlockTypes",
    );
    if (!describeBlockTypes) throw new Error("Missing tool: describeBlockTypes");
    const { blockTypes } = (await describeBlockTypes.handler({ types: ["visual"] }, context)) as {
      blockTypes: { contentSchema: { properties: Record<string, any> } }[];
    };
    const { visual, scenes } = blockTypes[0].contentSchema.properties;
    expect(visual).toMatchObject({ fieldType: "Artifact", size: "fill" });
    expect(scenes.items.properties.scene).toMatchObject({ fieldType: "Artifact", size: "content" });
  });
});
