import { describe, expect, it } from "vitest";

import { blockTypesProvider } from "../../../../../packages/ai-tools/src/providers/block-types";
import {
  ARTIFACT_MAX_LENGTH,
  contentFieldBuilder as field,
} from "../../../../../packages/sdk/src/core/lib/contentType";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createRepeatableItem, updateRepeatableItemContent } from "../repeatable-items/service";
import { createBlock, updateBlockContent } from "./service";

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
      environmentId: base.environment.id,
      layoutId: base.layout.id,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { ctx, page, projectId: base.project.id };
}

const tooLargeError = {
  code: "BAD_REQUEST",
  message: expect.stringMatching(new RegExp(`${ARTIFACT_MAX_LENGTH / 1024} KB[\\s\\S]*esm\\.sh`)),
};

describe("artifact content validation", () => {
  it("accepts sources up to the artifact limit and rejects larger ones, pointing to esm.sh", async () => {
    const { ctx, page } = await fixture("block");
    await expect(
      runService(
        createBlock(ctx, { pageId: page.id, type: "visual", content: { visual: tooLarge } }),
      ),
    ).rejects.toMatchObject({ ...tooLargeError, data: { field: "content.visual" } });
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: { visual: fits } }),
    );
    expect(block.content).toMatchObject({ visual: fits });
    await expect(
      runService(updateBlockContent(ctx, { id: block.id, content: { visual: tooLarge } })),
    ).rejects.toMatchObject(tooLargeError);
    await expect(
      runService(
        updateBlockContent(ctx, { id: block.id, content: { scenes: [{ scene: tooLarge }] } }),
      ),
    ).rejects.toMatchObject(tooLargeError);
  });

  it("applies the same limit to artifacts in repeatable items", async () => {
    const { ctx, page } = await fixture("item");
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: {} }),
    );
    await expect(
      runService(
        createRepeatableItem(ctx, {
          blockId: block.id,
          fieldName: "scenes",
          content: { scene: tooLarge },
        }),
      ),
    ).rejects.toMatchObject(tooLargeError);
    const item = await runService(
      createRepeatableItem(ctx, {
        blockId: block.id,
        fieldName: "scenes",
        content: { scene: fits },
      }),
    );
    await expect(
      runService(updateRepeatableItemContent(ctx, { id: item.id, content: { scene: tooLarge } })),
    ).rejects.toMatchObject(tooLargeError);
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
