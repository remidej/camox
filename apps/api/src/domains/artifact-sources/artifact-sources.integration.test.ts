import { artifactSourceHash } from "@camox/api-contract";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";

import {
  ARTIFACT_MAX_LENGTH,
  contentFieldBuilder as field,
} from "../../../../../packages/sdk/src/core/lib/contentType";
import {
  createProjectFixture,
  createServiceContext,
  inScope,
  startDraft,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { pages } from "../../schema";
import { createBlock, getBlock, updateBlockContent } from "../blocks/service";
import { draftOf } from "../drafts/scope";
import {
  createRepeatableItem,
  getRepeatableItem,
  updateRepeatableItemContent,
} from "../repeatable-items/service";

const scenesField = {
  type: "array",
  fieldType: "Repeater",
  items: {
    type: "object",
    properties: {
      scene: field.artifact({ size: "content" }),
      layers: {
        type: "array",
        fieldType: "Repeater",
        items: { type: "object", properties: { layer: field.artifact({ size: "content" }) } },
      },
    },
  },
};

async function fixture(suffix: string) {
  const base = await createProjectFixture(`artifact-sources-${suffix}-${crypto.randomUUID()}`);
  const ctx = createServiceContext(base.db, base.memberUser);
  const contentSchema = {
    type: "object",
    properties: {
      title: { type: "string", fieldType: "String" },
      visual: field.artifact({ size: "fill" }),
      scenes: scenesField,
    },
  };
  await syncDefinitionSet(base.db, base.project, {
    blocks: [
      { blockId: "visual", title: "Visual", description: "Artifacts", contentSchema },
      {
        blockId: "sharedVisual",
        title: "Shared visual",
        description: "Synced artifacts",
        synced: true,
        contentSchema,
      },
    ],
  });
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
  // Content is written in drafts (ADR 0003).
  const draftId = await startDraft(base.db, base.project.id, base.memberUser.id);
  const draft = draftOf({ id: draftId, kind: "regular", projectId: base.project.id });
  return { ...base, ctx: inScope(ctx, draft), page };
}

/** An artifact source as the store serves it, by project and hash. */
function storedSource(project: { uuid: string }, hash: string) {
  return SELF.fetch(`https://api.camox.ai/artifact-sources/${project.uuid}/${hash}`);
}

async function expectStored(project: { uuid: string }, source: string) {
  const response = await storedSource(project, await artifactSourceHash(source));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(source);
}

async function expectNotStored(project: { uuid: string }, source: string) {
  const response = await storedSource(project, await artifactSourceHash(source));
  expect(response.status).toBe(404);
}

const unique = (name: string) => `<title>${name}</title><p>${crypto.randomUUID()}</p>`;

describe("an artifact source's hash", () => {
  it("is the URL-safe base64 SHA-256 of the source, without padding", async () => {
    // Worked examples, from `openssl dgst -sha256 -binary | base64`, made URL-safe.
    expect(await artifactSourceHash("<title>Hello</title>")).toBe(
      "8EvV18nHEVSDFbUfQOOq0MSbb0Pead-Bg2htuIePZhk",
    );
    expect(await artifactSourceHash("<title>Scène</title>")).toBe(
      "70X9jazcxNAp4w0eqVCYVZwLscmJc0Si0grg6JbNvbI",
    );
  });
});

describe("the artifact source store", () => {
  it("serves a block's source by its hash once the block is created, cached for good", async () => {
    const { ctx, page, project } = await fixture("create");
    await runService(
      createBlock(ctx, {
        pageId: page.id,
        type: "visual",
        content: { visual: "<title>Hello</title>" },
      }),
    );

    const response = await storedSource(project, "8EvV18nHEVSDFbUfQOOq0MSbb0Pead-Bg2htuIePZhk");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<title>Hello</title>");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
  });

  it("stores the sources a block content write sets, in its own content and in shared content", async () => {
    const { ctx, page, project } = await fixture("update");
    const own = await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: {} }),
    );
    const shared = await runService(
      createBlock(ctx, { pageId: page.id, type: "sharedVisual", content: {} }),
    );
    const ownSource = unique("Own");
    const sharedSource = unique("Shared");

    await runService(updateBlockContent(ctx, { id: own.id, content: { visual: ownSource } }));
    await runService(updateBlockContent(ctx, { id: shared.id, content: { visual: sharedSource } }));

    await expectStored(project, ownSource);
    await expectStored(project, sharedSource);
  });

  it("stores the sources of repeatable items at any depth, created with their block", async () => {
    const { ctx, page, project } = await fixture("seeded-items");
    const scene = unique("Scene");
    const layer = unique("Layer");

    await runService(
      createBlock(ctx, {
        pageId: page.id,
        type: "visual",
        content: { scenes: [{ scene, layers: [{ layer }] }] },
      }),
    );

    await expectStored(project, scene);
    await expectStored(project, layer);
  });

  it("stores the sources of repeatable items a block content write inserts or changes, at any depth", async () => {
    const { ctx, page, project } = await fixture("patched-items");
    const block = await runService(
      createBlock(ctx, {
        pageId: page.id,
        type: "visual",
        content: { scenes: [{ scene: unique("First") }] },
      }),
    );
    const [first] = (await runService(getBlock(ctx, { id: block.id }))).repeatableItems;
    const changedScene = unique("Changed scene");
    const insertedScene = unique("Inserted scene");
    const insertedLayer = unique("Inserted layer");

    await runService(
      updateBlockContent(ctx, {
        id: block.id,
        content: {
          scenes: [
            { _itemId: first!.id, scene: changedScene },
            { scene: insertedScene, layers: [{ layer: insertedLayer }] },
          ],
        },
      }),
    );

    await expectStored(project, changedScene);
    await expectStored(project, insertedScene);
    await expectStored(project, insertedLayer);
  });

  it("stores the sources of repeatable items created or changed on their own, nested ones included", async () => {
    const { ctx, page, project } = await fixture("items");
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: {} }),
    );
    const scene = unique("Scene");
    const seededLayer = unique("Seeded layer");
    const nestedLayer = unique("Nested layer");
    const changedLayer = unique("Changed layer");

    const item = await runService(
      createRepeatableItem(ctx, {
        blockId: block.id,
        fieldName: "scenes",
        content: { scene },
        nestedItems: [
          {
            tempId: "a",
            parentTempId: null,
            fieldName: "layers",
            content: { layer: seededLayer },
            position: "a0",
          },
        ],
      }),
    );
    const nested = await runService(
      createRepeatableItem(ctx, {
        blockId: block.id,
        parentItemId: item.id,
        fieldName: "layers",
        content: { layer: nestedLayer },
      }),
    );
    await runService(
      updateRepeatableItemContent(ctx, { id: nested.id, content: { layer: changedLayer } }),
    );

    await expectStored(project, scene);
    await expectStored(project, seededLayer);
    await expectStored(project, nestedLayer);
    await expectStored(project, changedLayer);
  });

  it("stores nothing when the content write is rejected", async () => {
    const { ctx, page, project } = await fixture("rejected");
    const block = await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: {} }),
    );
    const fits = unique("Fits");
    const tooLarge = `<title>Too large</title>${"x".repeat(ARTIFACT_MAX_LENGTH)}`;

    await expect(
      runService(
        updateBlockContent(ctx, {
          id: block.id,
          content: { visual: fits, scenes: [{ scene: tooLarge }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      runService(
        createBlock(ctx, {
          pageId: page.id,
          type: "visual",
          content: { visual: fits, scenes: [{ scene: tooLarge }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expectNotStored(project, fits);
  });

  it("takes the same source written twice, and still serves it", async () => {
    const { ctx, page, project } = await fixture("twice");
    const source = unique("Twice");

    for (const _ of [1, 2]) {
      await runService(
        createBlock(ctx, { pageId: page.id, type: "visual", content: { visual: source } }),
      );
    }

    await expectStored(project, source);
  });

  it("doesn't serve a project's source through another project", async () => {
    const { ctx, page } = await fixture("owner");
    const other = await fixture("other");
    const source = unique("Owned");
    await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: { visual: source } }),
    );

    const response = await storedSource(other.project, await artifactSourceHash(source));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("a content read", () => {
  it("returns the hash of each artifact source, by field, beside the block's and items' content", async () => {
    const { ctx, page } = await fixture("read");
    const visual = unique("Visual");
    const scene = unique("Scene");
    const layer = unique("Layer");
    const created = await runService(
      createBlock(ctx, {
        pageId: page.id,
        type: "visual",
        content: { title: "Not an artifact", visual, scenes: [{ scene, layers: [{ layer }] }] },
      }),
    );

    const { block, repeatableItems } = await runService(getBlock(ctx, { id: created.id }));

    expect(block.artifactHashes).toEqual({ visual: await artifactSourceHash(visual) });
    const sceneItem = repeatableItems.find((item) => item.fieldName === "scenes")!;
    const layerItem = repeatableItems.find((item) => item.fieldName === "layers")!;
    expect(sceneItem.artifactHashes).toEqual({ scene: await artifactSourceHash(scene) });
    expect(layerItem.artifactHashes).toEqual({ layer: await artifactSourceHash(layer) });
    const read = await runService(getRepeatableItem(ctx, { id: layerItem.id }));
    expect(read.item.artifactHashes).toEqual({ layer: await artifactSourceHash(layer) });
  });

  it("hashes a schema default standing in for content that holds no source", async () => {
    const { db, project, ctx, page } = await fixture("read-default");
    const fallback = "<title>Default</title>";
    await syncDefinitionSet(db, project, {
      blocks: [
        {
          blockId: "defaulted",
          title: "Defaulted",
          description: "An artifact with a default source",
          contentSchema: {
            type: "object",
            properties: {
              visual: field.artifact({ size: "fill", default: fallback }),
            },
          },
        },
      ],
    });
    const created = await runService(
      createBlock(ctx, { pageId: page.id, type: "defaulted", content: {} }),
    );

    const { block } = await runService(getBlock(ctx, { id: created.id }));

    expect(block.content).toMatchObject({ visual: fallback });
    expect(block.artifactHashes).toEqual({ visual: await artifactSourceHash(fallback) });
  });

  it("names no hash for an empty artifact", async () => {
    const { ctx, page } = await fixture("read-empty");
    const created = await runService(
      createBlock(ctx, { pageId: page.id, type: "visual", content: { visual: " " } }),
    );

    const { block } = await runService(getBlock(ctx, { id: created.id }));

    expect(block.artifactHashes).toEqual({});
  });
});
