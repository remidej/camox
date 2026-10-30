import { generateUuidv7 } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { contentFieldBuilder as field } from "../../../../../packages/sdk/src/core/lib/contentType";
import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  startDraft,
  syncDefinitionSet,
  inScope,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { pages, repeatableItems } from "../../schema";
import { createBlock, getBlock } from "../blocks/service";
import { draftOf } from "../drafts/scope";
import { type ArtifactField, readArtifactField, writeArtifactField } from "./field";

const ORBIT = `<!doctype html><title>Orbit</title>`;
const MOON = `<!doctype html><title>Moon</title>`;

/** A Live block with an artifact of its own and a Repeatable Item with another, and a draft. */
async function fixture() {
  const base = await createProjectFixture(crypto.randomUUID());
  const ctx = createServiceContext(base.db, base.memberUser);
  await syncDefinitionSet(base.db, base.project, {
    blocks: [
      {
        blockId: "space",
        title: "Space",
        description: "Artifacts in a block and its items",
        contentSchema: {
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
        },
      },
    ],
  });
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "space",
      fullPath: "/space",
      nickname: "Space",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const block = await seedLiveThrough(ctx, base.project.id, (draft) =>
    createBlock(inScope(ctx, draft), {
      pageId: page.id,
      type: "space",
      content: { heading: "Space", visual: ORBIT, scenes: [{ caption: "Moon", scene: MOON }] },
    }),
  );
  const [item] = await base.db
    .select()
    .from(repeatableItems)
    .where(eq(repeatableItems.blockId, block.id));
  const draftId = await startDraft(base.db, base.project.id, base.memberUser.id);
  const inDraft = inScope(ctx, draftOf({ id: draftId, projectId: base.project.id }));
  return { ...base, inDraft, block, item: item!, draftId };
}

describe("an artifact field", () => {
  it("is read and written in a block's own content, and in its Repeatable Items'", async () => {
    const { inDraft, block, item } = await fixture();
    const visual: ArtifactField = { block: block.id, field: "visual" };
    const scene: ArtifactField = { block: block.id, item: item.id, field: "scene" };

    const before = [
      await runService(readArtifactField(inDraft, visual)),
      await runService(readArtifactField(inDraft, scene)),
    ];
    await runService(writeArtifactField(inDraft, { ...visual, source: `${ORBIT}<p>2</p>` }));
    await runService(writeArtifactField(inDraft, { ...scene, source: `${MOON}<p>2</p>` }));

    expect(before).toEqual([ORBIT, MOON]);
    const { block: shown, repeatableItems: items } = await runService(
      getBlock(inDraft, { id: block.id }),
    );
    expect(shown.content).toMatchObject({ heading: "Space", visual: `${ORBIT}<p>2</p>` });
    expect(items[0]!.content).toMatchObject({ caption: "Moon", scene: `${MOON}<p>2</p>` });
  });

  it("warns about a source without a title, which it writes", async () => {
    const { inDraft, block } = await fixture();

    const { warnings } = await runService(
      writeArtifactField(inDraft, { block: block.id, field: "visual", source: "<p>Hi</p>" }),
    );

    expect(warnings).toEqual([expect.stringContaining("no non-empty <title>")]);
    expect(await runService(readArtifactField(inDraft, { block: block.id, field: "visual" }))).toBe(
      "<p>Hi</p>",
    );
  });

  it("is refused for a field that isn't an artifact, or an item of another block", async () => {
    const { inDraft, block, item } = await fixture();

    const targets: ArtifactField[] = [
      { block: block.id, field: "heading" },
      { block: block.id, item: item.id, field: "caption" },
      { block: block.id, field: "scene" },
      { block: block.id, item: generateUuidv7(), field: "scene" },
    ];

    for (const target of targets) {
      await expect(runService(readArtifactField(inDraft, target))).rejects.toThrow();
    }
  });
});
