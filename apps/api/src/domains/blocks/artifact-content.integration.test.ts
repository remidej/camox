import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createRepeatableItem, updateRepeatableItemContent } from "../repeatable-items/service";
import { createBlock, updateBlockContent } from "./service";

// The schema an SDK `field.artifact()` syncs: 256 KB of source at most.
const limit = 256 * 1024;
const artifact = { type: "string", fieldType: "Artifact", maxLength: limit, size: "fill" };
const fits = `<title>Fits</title>${"x".repeat(limit - "<title>Fits</title>".length)}`;
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
          visual: artifact,
          scenes: {
            type: "array",
            fieldType: "Repeater",
            items: { type: "object", properties: { scene: artifact } },
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
  return { ctx, page };
}

const tooLargeError = {
  code: "BAD_REQUEST",
  message: expect.stringMatching(/256 KB[\s\S]*esm\.sh/),
};

describe("artifact content validation", () => {
  it("accepts sources up to 256 KB and rejects larger ones, pointing to esm.sh", async () => {
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
});
