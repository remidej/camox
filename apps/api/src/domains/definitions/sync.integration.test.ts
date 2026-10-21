import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import {
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";

// `definitions.sync`: a website's whole Definition Set, applied to Live by a release or to the
// caller's development draft by dev mode, in one batch (ADR 0006).

const titled = {
  type: "object",
  properties: { title: { type: "string", fieldType: "String" } },
};
const block = (blockId: string, extra: Record<string, unknown> = {}) => ({
  blockId,
  title: blockId,
  description: blockId,
  contentSchema: titled,
  ...extra,
});
const authors = {
  collectionId: "authors",
  title: "Authors",
  description: "",
  label: "name",
  contentSchema: {
    type: "object" as const,
    properties: { name: { type: "string", fieldType: "String" as const } },
    required: ["name"],
    additionalProperties: false as const,
  },
};

/** A website's Definition Set: a hero, a navbar only its layout declares, and authors. */
const website: TestDefinitionSet = {
  blocks: [block("hero"), block("navbar", { layoutOnly: true })],
  layouts: [
    {
      layoutId: "default",
      description: "Default",
      blocks: [{ type: "navbar", slot: "before", content: { title: "Nav" } }],
    },
  ],
  collections: [authors],
  homepage: { layoutId: "default", blocks: [{ type: "hero", content: { title: "Welcome" } }] },
};

async function fixture() {
  const base = await createProjectFixture(`definitions-sync-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const development = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };

  /** What a target reads of its definitions and the content they declare. */
  const stateOf = async (headers: Record<string, string> = {}) => {
    const definitions = await call(
      router.blockDefinitions.list,
      { projectId: project.id },
      member(headers),
    );
    const layouts = await call(router.layouts.list, { projectId: project.id }, member(headers));
    const collections = await call(
      router.collectionDefinitions.list,
      { projectSlug: project.slug },
      member(headers),
    );
    const pages = await call(router.pages.list, { projectId: project.id }, member(headers));
    const layoutBlocks = await Promise.all(
      layouts.map(async ({ layoutId }) => {
        const layout = await call(
          router.layouts.get,
          { projectSlug: project.slug, layoutId },
          member(headers),
        );
        return { layoutId, blocks: layout.blocks.map((b) => ({ type: b.type, ...b.content })) };
      }),
    );
    const pageBlocks = await Promise.all(
      pages.map(async (page) => {
        const view = await call(
          router.pages.getByPath,
          { projectSlug: project.slug, path: page.fullPath },
          member(headers),
        );
        const blocks = view.blocks.filter((b) => view.page.blockIds.includes(b.id));
        return { path: page.fullPath, blocks: blocks.map((b) => ({ type: b.type, ...b.content })) };
      }),
    );
    return {
      definitions: definitions.map((d) => d.blockId).sort(),
      layouts: layoutBlocks.sort((a, b) => a.layoutId.localeCompare(b.layoutId)),
      collections: collections.map((c) => c.collectionId).sort(),
      pages: pageBlocks,
    };
  };

  return {
    ...base,
    member,
    development,
    stateOf,
    release: (set: TestDefinitionSet) => syncDefinitionSet(db, project, set),
    syncDevelopment: (set: TestDefinitionSet) =>
      syncDefinitionSet(db, project, set, { as: memberUser }),
  };
}

/**
 * Makes the batch of any sync writing a layout named `layoutId` fail, as a database would on a
 * statement it can't run, once every earlier statement of the batch ran.
 */
async function failingOnLayout(layoutId: string) {
  const name = `fail_layout_${crypto.randomUUID().replaceAll("-", "_")}`;
  await env.DB.exec(
    `CREATE TRIGGER ${name} BEFORE INSERT ON layouts WHEN NEW.layout_id = '${layoutId}' BEGIN SELECT RAISE(ABORT, 'failing sync'); END;`,
  );
  onTestFinished(async () => {
    await env.DB.exec(`DROP TRIGGER ${name};`);
  });
}

describe("definitions.sync", () => {
  it("applies a whole Definition Set to Live in a release: definitions, layouts with their blocks, collections and the homepage", async () => {
    const { release, stateOf } = await fixture();

    const result = await release(website);

    expect(await stateOf()).toEqual({
      definitions: ["hero", "navbar"],
      layouts: [{ layoutId: "default", blocks: [{ type: "navbar", title: "Nav" }] }],
      collections: ["authors"],
      pages: [{ path: "/", blocks: [{ type: "hero", title: "Welcome" }] }],
    });
    expect(result).toMatchObject({
      draftCreated: false,
      homepage: { created: true, blockCount: 1 },
      layouts: { layouts: [{ layoutId: "default", wasExisting: true }] },
    });
  });

  it("applies a whole Definition Set to the caller's development draft, which its first sync creates, leaving Live as it was", async () => {
    const { syncDevelopment, stateOf, development } = await fixture();
    const live = await stateOf();

    const result = await syncDevelopment(website);

    expect(result.draftCreated).toBe(true);
    expect(await stateOf(development)).toEqual({
      definitions: ["hero", "navbar"],
      layouts: [{ layoutId: "default", blocks: [{ type: "navbar", title: "Nav" }] }],
      collections: ["authors"],
      pages: [{ path: "/", blocks: [{ type: "hero", title: "Welcome" }] }],
    });
    expect(await stateOf()).toEqual(live);
    expect((await syncDevelopment(website)).draftCreated).toBe(false);
  });

  it("lands a new layout-only block together with the new layout declaring it", async () => {
    const { release, stateOf, project, member } = await fixture();
    await release(website);

    // The layout's block gets the items its definition, arriving alongside, requires.
    const footer = block("footer", {
      layoutOnly: true,
      contentSchema: {
        type: "object",
        properties: {
          ...titled.properties,
          links: {
            fieldType: "Repeater",
            minItems: 1,
            items: { properties: { label: { fieldType: "String", default: "Home" } } },
          },
        },
      },
    });
    await release({
      ...website,
      blocks: [...website.blocks!, footer],
      layouts: [
        ...website.layouts!,
        {
          layoutId: "landing",
          description: "Landing",
          blocks: [{ type: "footer", slot: "after", content: { title: "Bye" } }],
        },
      ],
    });

    expect((await stateOf()).definitions).toEqual(["footer", "hero", "navbar"]);
    const landing = await call(
      router.layouts.get,
      { projectSlug: project.slug, layoutId: "landing" },
      member(),
    );
    expect(landing.blocks).toEqual([
      expect.objectContaining({
        type: "footer",
        content: expect.objectContaining({ title: "Bye" }),
      }),
    ]);
    expect(landing.repeatableItems).toEqual([
      expect.objectContaining({ blockId: landing.blocks[0].id, content: { label: "Home" } }),
    ]);
  });

  it("leaves Live exactly as it was when its batch fails", async () => {
    const { release, stateOf } = await fixture();
    await release(website);
    const before = await stateOf();
    await failingOnLayout("landing");

    await expect(
      release({
        blocks: [block("hero", { title: "Hero, renamed" }), block("footer", { layoutOnly: true })],
        layouts: [
          { layoutId: "default", description: "Default", blocks: [] },
          {
            layoutId: "landing",
            description: "Landing",
            blocks: [{ type: "footer", slot: "after", content: { title: "Bye" } }],
          },
        ],
        collections: [],
        homepage: null,
      }),
    ).rejects.toThrow();

    expect(await stateOf()).toEqual(before);
  });

  it("leaves the development draft exactly as it was when its batch fails", async () => {
    const { syncDevelopment, stateOf, development } = await fixture();
    await syncDevelopment(website);
    const before = await stateOf(development);
    await failingOnLayout("landing");

    await expect(
      syncDevelopment({
        blocks: [block("footer", { layoutOnly: true })],
        layouts: [
          { layoutId: "default", description: "Default", blocks: [] },
          {
            layoutId: "landing",
            description: "Landing",
            blocks: [{ type: "footer", slot: "after", content: { title: "Bye" } }],
          },
        ],
        collections: [],
        homepage: null,
      }),
    ).rejects.toThrow();

    expect(await stateOf(development)).toEqual(before);
  });

  it.each([
    [
      "a bad reference schema",
      {
        blocks: [
          // References are only supported in content.
          block("hero", {
            settingsSchema: {
              type: "object",
              properties: { author: { fieldType: "Reference", collectionId: "authors" } },
            },
          }),
        ],
      },
    ],
    [
      "an unknown collection",
      {
        collections: [
          {
            ...authors,
            contentSchema: {
              ...authors.contentSchema,
              properties: {
                ...authors.contentSchema.properties,
                team: { fieldType: "Reference" as const, collectionId: "teams" },
              },
              required: ["name", "team"],
            },
          },
        ],
      },
    ],
    ["duplicate collection ids", { collections: [authors, authors] }],
  ])("fails on %s before any write", async (_, invalid) => {
    const { release, stateOf } = await fixture();
    await release(website);
    const before = await stateOf();

    await expect(release({ ...website, ...invalid })).rejects.toThrow();

    expect(await stateOf()).toEqual(before);
  });
});
