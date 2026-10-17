import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  seedLiveThrough,
  inScope,
} from "../../test/fixtures";
import { runService } from "../lib/run-service";
import { listBlockDefinitions, syncBlockDefinitions } from "./block-definitions/service";
import {
  createRecord,
  getCollectionRecord,
  listCollectionDefinitions,
  syncCollectionDefinitions,
} from "./collections/service";
import { listLayouts, syncLayouts } from "./layouts/service";
import { createPage, getPage, listPages, setPageLayout } from "./pages/service";

const contentSchema = {
  type: "object",
  properties: { title: { type: "string", fieldType: "String", default: "Hello" } },
  required: ["title"],
};

function blockDefinition(blockId: string) {
  return { blockId, title: blockId, description: "", contentSchema };
}

function layoutDefinition(layoutId: string) {
  return { layoutId, kind: "curated" as const, description: "", blocks: [] };
}

function collectionDefinition(collectionId: string) {
  return {
    collectionId,
    title: collectionId,
    description: "",
    label: "name",
    contentSchema: {
      type: "object" as const,
      properties: { name: { type: "string", fieldType: "String" as const } },
      required: ["name"],
      additionalProperties: false as const,
    },
  };
}

async function setup(suffix: string) {
  const fixture = await createProjectFixture(`definition-names-${suffix}`);
  const ctx = createServiceContext(fixture.db, fixture.memberUser);
  const release = createServiceContext(fixture.db, null);
  const scope = {
    projectSlug: fixture.project.slug,
    deployToken: "test-deploy-token",
    autoCreate: false,
  };
  const sync = async (names: { blocks: string[]; layouts: string[]; collections: string[] }) => {
    await runService(
      syncBlockDefinitions(release, { ...scope, definitions: names.blocks.map(blockDefinition) }),
    );
    await runService(
      syncLayouts(release, { ...scope, layouts: names.layouts.map(layoutDefinition) }),
    );
    await runService(
      syncCollectionDefinitions(release, {
        ...scope,
        definitions: names.collections.map(collectionDefinition),
      }),
    );
  };
  const definitions = async () => ({
    blocks: await runService(listBlockDefinitions(ctx, { projectId: fixture.project.id })),
    layouts: await runService(listLayouts(ctx, { projectId: fixture.project.id })),
    collections: await runService(
      listCollectionDefinitions(ctx, { projectSlug: fixture.project.slug }),
    ),
  });
  return { ...fixture, ctx, sync, definitions };
}

describe("definitions are identified by their names", () => {
  it("a page stores and returns its layout's name, and setting its layout takes a name", async () => {
    const { ctx, project, sync } = await setup("page-layout");
    await sync({ blocks: [], layouts: ["default", "landing"], collections: [] });

    const { page } = await seedLiveThrough(ctx, project.id, (draft) =>
      createPage(inScope(ctx, draft), {
        projectId: project.id,
        pathSegment: "about",
        layoutId: "default",
      }),
    );
    expect(page.layoutId).toBe("default");

    const moved = await seedLiveThrough(ctx, project.id, (draft) =>
      setPageLayout(inScope(ctx, draft), { id: page.id, layoutId: "landing" }),
    );
    expect(moved.layoutId).toBe("landing");
    expect(await runService(getPage(inScope(ctx, null), { id: page.id }))).toMatchObject({
      layoutId: "landing",
    });
    expect(
      await runService(listPages(inScope(ctx, null), { projectId: project.id })),
    ).toMatchObject([{ id: page.id, layoutId: "landing" }]);

    await expect(
      seedLiveThrough(ctx, project.id, (draft) =>
        setPageLayout(inScope(ctx, draft), { id: page.id, layoutId: "missing" }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("a collection record stores its collection's name", async () => {
    const { ctx, project, sync } = await setup("record-collection");
    await sync({ blocks: [], layouts: ["default"], collections: ["authors"] });
    const scope = { projectSlug: project.slug, collectionId: "authors" };

    const created = await seedLiveThrough(ctx, project.id, (_draft, inDraft) =>
      createRecord(inDraft, { ...scope, content: { name: "Ada" } }),
    );
    expect(created).toMatchObject({ collectionId: "authors" });
    expect(created).not.toHaveProperty("definitionId");
    expect(await runService(getCollectionRecord(ctx, { ...scope, id: created.id }))).toMatchObject({
      collectionId: "authors",
    });
  });

  it("block definitions, layouts and collections are listed by name, without an integer id", async () => {
    const { sync, definitions } = await setup("no-integer-ids");
    await sync({ blocks: ["hero"], layouts: ["default"], collections: ["authors"] });

    const listed = await definitions();
    expect(listed.blocks.map((definition) => definition.blockId)).toEqual(["hero"]);
    expect(listed.layouts.map((layout) => layout.layoutId)).toEqual(["default"]);
    expect(listed.collections.map((collection) => collection.collectionId)).toEqual(["authors"]);
    for (const definition of [...listed.blocks, ...listed.layouts, ...listed.collections]) {
      expect(definition).not.toHaveProperty("id");
    }
  });

  it("syncing the same definitions twice changes nothing", async () => {
    const { sync, definitions } = await setup("idempotent-sync");
    const names = { blocks: ["hero", "footer"], layouts: ["default"], collections: ["authors"] };
    await sync(names);
    const first = await definitions();

    await sync(names);

    expect(await definitions()).toEqual(first);
  });

  it("syncing a renamed definition creates a definition under the new name", async () => {
    const { sync, definitions } = await setup("renamed-sync");
    await sync({ blocks: ["hero"], layouts: ["default"], collections: ["authors"] });

    await sync({ blocks: ["banner"], layouts: ["main"], collections: ["people"] });

    const listed = await definitions();
    expect(listed.blocks.map((definition) => definition.blockId)).toEqual(["banner"]);
    expect(listed.layouts.map((layout) => layout.layoutId)).toEqual(["main"]);
    expect(listed.collections.map((collection) => collection.collectionId)).toEqual(["people"]);
  });
});
