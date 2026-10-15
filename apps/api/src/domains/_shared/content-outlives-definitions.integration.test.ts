import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
  createProjectFixture,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import type { BaseContext } from "../../orpc";
import { router } from "../../router";

type Schema = Record<string, unknown>;
type Definition = {
  blockId: string;
  contentSchema: Schema;
  settingsSchema?: Schema;
  layoutOnly?: boolean;
};

const string = (value: string) => ({ type: "string", fieldType: "String", default: value });

const hero: Definition = {
  blockId: "hero",
  contentSchema: {
    type: "object",
    properties: { title: string("Welcome"), subtitle: string("Hello") },
    toMarkdown: ["# {{title}}", "{{subtitle}}"],
  },
  settingsSchema: {
    type: "object",
    properties: { theme: { type: "string", enum: ["light", "dark"], default: "light" } },
  },
};

const cards = (properties: Schema): Definition => ({
  blockId: "cards",
  contentSchema: {
    type: "object",
    properties: {
      heading: string("Cards"),
      ...properties,
    },
  },
});

const cardsRepeater = {
  type: "array",
  fieldType: "Repeater",
  items: { type: "object", properties: { label: string("Card") } },
};

async function fixture() {
  const base = await createProjectFixture(`outlives-${crypto.randomUUID()}`);
  const service = createServiceContext(base.db, base.memberUser);
  const context: BaseContext = {
    ...service,
    headers: new Headers(),
    session: {
      id: "session",
      token: "test",
      userId: base.memberUser.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
  const options = { context };
  const releaseOptions = {
    context: { ...context, user: null, session: null } satisfies BaseContext,
  };
  const release = {
    blocks: (definitions: Definition[]) =>
      call(
        router.blockDefinitions.sync,
        {
          projectSlug: base.project.slug,
          deployToken: base.project.deployToken,
          autoCreate: false,
          definitions: definitions.map((definition) => ({
            title: definition.blockId,
            description: "",
            ...definition,
          })),
        },
        releaseOptions,
      ),
    layouts: (layouts: { layoutId: string; kind?: "curated" | "derived" | "singleton" }[]) =>
      call(
        router.layouts.sync,
        {
          projectSlug: base.project.slug,
          deployToken: base.project.deployToken,
          autoCreate: false,
          layouts: layouts.map((layout) => ({ description: "", blocks: [], ...layout })),
        },
        releaseOptions,
      ),
  };
  await release.blocks([hero, cards({ cards: cardsRepeater })]);
  const { page } = await callSeedingLive(
    router.pages.create,
    {
      projectId: base.project.id,
      pathSegment: "home",
      layoutId: base.layout.layoutId,
    },
    options,
  );
  return { ...base, options, release, page };
}

describe("content outlives its definitions", () => {
  it("hides a removed field from every read and brings it back unchanged with its definition", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Kept", subtitle: "Stored" } },
      f.options,
    );
    const withoutSubtitle: Definition = {
      ...hero,
      contentSchema: {
        type: "object",
        properties: { title: string("Welcome") },
        toMarkdown: ["# {{title}}", "{{subtitle}}"],
      },
    };
    await f.release.blocks([withoutSubtitle, cards({ cards: cardsRepeater })]);

    const read = await call(router.blocks.get, { id: block.id }, f.options);
    expect(read.block.content).toEqual({ title: "Kept" });
    const page = await call(
      router.pages.getByPath,
      { projectSlug: f.project.slug, path: f.page.fullPath },
      f.options,
    );
    expect(page.blocks.find((b) => b.id === block.id)?.content).toEqual({ title: "Kept" });
    const markdown = await call(router.blocks.getPageMarkdown, { pageId: f.page.id }, f.options);
    expect(markdown.markdown).not.toContain("Stored");

    await f.release.blocks([hero, cards({ cards: cardsRepeater })]);
    const restored = await call(router.blocks.get, { id: block.id }, f.options);
    expect(restored.block.content).toEqual({ title: "Kept", subtitle: "Stored" });
  });

  it("fills a field added after the content was written with its default", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Kept", subtitle: "Stored" } },
      f.options,
    );
    const withEyebrow: Definition = {
      ...hero,
      contentSchema: {
        type: "object",
        properties: { eyebrow: string("New"), title: string("Welcome"), subtitle: string("Hello") },
      },
    };
    await f.release.blocks([withEyebrow, cards({ cards: cardsRepeater })]);

    const read = await call(router.blocks.get, { id: block.id }, f.options);
    expect(read.block.content).toEqual({ eyebrow: "New", title: "Kept", subtitle: "Stored" });
  });

  it("reads a value of the wrong kind as the default and leaves the stored value untouched", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      {
        pageId: f.page.id,
        type: "hero",
        content: { title: "Kept", subtitle: "Stored" },
        settings: { theme: "dark" },
      },
      f.options,
    );
    const changedKinds: Definition = {
      ...hero,
      contentSchema: {
        type: "object",
        properties: {
          title: string("Welcome"),
          subtitle: { type: "number", fieldType: "Number", default: 3 },
        },
      },
      settingsSchema: {
        type: "object",
        properties: { theme: { type: "string", enum: ["light", "blue"], default: "light" } },
      },
    };
    await f.release.blocks([changedKinds, cards({ cards: cardsRepeater })]);

    const read = await call(router.blocks.get, { id: block.id }, f.options);
    expect(read.block.content).toEqual({ title: "Kept", subtitle: 3 });
    expect(read.block.settings).toEqual({ theme: "light" });

    await f.release.blocks([hero, cards({ cards: cardsRepeater })]);
    const restored = await call(router.blocks.get, { id: block.id }, f.options);
    expect(restored.block.content).toEqual({ title: "Kept", subtitle: "Stored" });
    expect(restored.block.settings).toEqual({ theme: "dark" });
  });

  it("keeps stale keys stored when a write patches content, and validates only the patch", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Kept", subtitle: "Stored" } },
      f.options,
    );
    const withoutSubtitle: Definition = {
      ...hero,
      contentSchema: { type: "object", properties: { title: string("Welcome") } },
    };
    await f.release.blocks([withoutSubtitle, cards({ cards: cardsRepeater })]);
    await callSeedingLive(
      router.blocks.updateContent,
      { id: block.id, content: { title: "Edited" } },
      f.options,
    );
    await expect(
      callSeedingLive(
        router.blocks.updateContent,
        { id: block.id, content: { title: 42 } },
        f.options,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await f.release.blocks([hero, cards({ cards: cardsRepeater })]);
    const restored = await call(router.blocks.get, { id: block.id }, f.options);
    expect(restored.block.content).toEqual({ title: "Edited", subtitle: "Stored" });
  });

  it("leaves out repeatable items under a removed repeater, and brings them back with it", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      {
        pageId: f.page.id,
        type: "cards",
        content: { heading: "Team", cards: [{ label: "Ada" }, { label: "Grace" }] },
      },
      f.options,
    );
    const before = await call(router.blocks.get, { id: block.id }, f.options);
    const [item] = before.repeatableItems;

    await f.release.blocks([hero, cards({})]);
    const read = await call(router.blocks.get, { id: block.id }, f.options);
    expect(read.block.content).toEqual({ heading: "Team" });
    expect(read.repeatableItems).toEqual([]);
    const page = await call(
      router.pages.getByPath,
      { projectSlug: f.project.slug, path: f.page.fullPath },
      f.options,
    );
    expect(page.repeatableItems).toEqual([]);
    await expect(
      call(router.repeatableItems.get, { id: item.id }, f.options),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await f.release.blocks([hero, cards({ cards: cardsRepeater })]);
    const restored = await call(router.blocks.get, { id: block.id }, f.options);
    expect(restored.repeatableItems.map((i) => i.content)).toEqual([
      { label: "Ada" },
      { label: "Grace" },
    ]);
  });
});

describe("pages whose layout is gone", () => {
  const read = (f: Awaited<ReturnType<typeof fixture>>, path = f.page.fullPath) =>
    call(router.pages.getByPath, { projectSlug: f.project.slug, path }, f.options);
  const listed = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const pages = await call(router.pages.list, { projectId: f.project.id }, f.options);
    return pages.find((page) => page.id === f.page.id);
  };

  it("aren't served when their layout is removed, are listed as needing a layout, and come back with it", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Kept" } },
      f.options,
    );
    await f.release.layouts([{ layoutId: "other" }]);

    await expect(read(f)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        router.pages.getStructure,
        { projectSlug: f.project.slug, path: f.page.fullPath },
        f.options,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(router.blocks.getPageMarkdown, { pageId: f.page.id }, f.options),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listed(f)).toMatchObject({ needsLayout: true, shadowed: false });
    await expect(
      call(router.layouts.get, { projectSlug: f.project.slug, layoutId: "default" }, f.options),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await f.release.layouts([{ layoutId: "default" }, { layoutId: "other" }]);
    expect((await read(f)).blocks.map((b) => b.id)).toEqual([block.id]);
    expect(await listed(f)).toMatchObject({ needsLayout: false });
  });

  it("are served again once moved to a curated layout", async () => {
    const f = await fixture();
    const sync = await f.release.layouts([{ layoutId: "other" }]);
    const other = sync.layouts.find((result) => result.layout.layoutId === "other")!.layout;
    await callSeedingLive(
      router.pages.setLayout,
      { id: f.page.id, layoutId: other.layoutId },
      f.options,
    );
    expect((await read(f)).layout?.layoutId).toBe("other");
    expect(await listed(f)).toMatchObject({ needsLayout: false });
  });

  it("aren't served when their layout is no longer curated, and are listed as needing a layout", async () => {
    const f = await fixture();
    await f.release.layouts([{ layoutId: "default", kind: "derived" }]);
    await expect(read(f)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listed(f)).toMatchObject({ needsLayout: true });
  });

  it("are flagged as shadowed when a singleton claims their URL", async () => {
    const f = await fixture();
    await f.release.layouts([{ layoutId: "default" }, { layoutId: "home", kind: "singleton" }]);
    expect(await listed(f)).toMatchObject({ needsLayout: false, shadowed: true });

    await f.release.layouts([{ layoutId: "default" }]);
    expect(await listed(f)).toMatchObject({ shadowed: false });
  });
});

describe("collection records", () => {
  const text = (extra: Schema = {}) => ({ type: "string", fieldType: "String", ...extra });
  const people = (properties: Schema) => ({
    collectionId: "people",
    title: "People",
    description: "",
    label: "name",
    contentSchema: {
      type: "object" as const,
      properties: { name: text(), ...properties },
      required: ["name", ...Object.keys(properties)],
      additionalProperties: false as const,
    },
  });
  const withRole = people({ role: text({ default: "Member" }) });
  const profile: Definition = {
    blockId: "profile",
    contentSchema: {
      type: "object",
      properties: {
        person: {
          anyOf: [{ type: "null" }, { type: "string", format: "uuid" }],
          fieldType: "Reference",
          collectionId: "people",
          default: null,
        },
      },
    },
  };

  async function collectionFixture() {
    const f = await fixture();
    const syncCollections = (definitions: unknown[]) =>
      call(
        router.collectionDefinitions.sync,
        {
          projectSlug: f.project.slug,
          deployToken: f.project.deployToken,
          autoCreate: false,
          definitions: definitions as never,
        },
        { context: { ...f.options.context, user: null, session: null } },
      );
    await syncCollections([withRole]);
    await f.release.blocks([hero, cards({ cards: cardsRepeater }), profile]);
    const scope = { projectSlug: f.project.slug, collectionId: "people" };
    const record = await callSeedingLive(
      router.collectionDefinitions.createRecord,
      { ...scope, content: { name: "Ada", role: "Engineer" } },
      f.options,
    );
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "profile", content: { person: record.id } },
      f.options,
    );
    const referenced = async () =>
      (await call(router.blocks.get, { id: block.id }, f.options)).block.references.person;
    const get = () =>
      call(router.collectionDefinitions.getRecord, { ...scope, id: record.id }, f.options);
    return { ...f, syncCollections, scope, record, referenced, get };
  }

  it("syncs a removed field while records exist, hides it, and brings it back unchanged", async () => {
    const f = await collectionFixture();
    await f.syncCollections([people({})]);

    expect((await f.get()).content).toEqual({ name: "Ada" });
    expect(await f.referenced()).toMatchObject({ content: { name: "Ada" } });
    const found = await call(
      router.collectionDefinitions.findRecordsByField,
      { ...f.scope, field: "name", value: "Ada" },
      f.options,
    );
    expect(found.map((record) => record.content)).toEqual([{ name: "Ada" }]);

    await f.syncCollections([withRole]);
    expect((await f.get()).content).toEqual({ name: "Ada", role: "Engineer" });
  });

  it("syncs a changed field while records exist, and reads a value of the wrong kind as the default", async () => {
    const f = await collectionFixture();
    await f.syncCollections([
      people({ role: { type: "boolean", fieldType: "Boolean", default: true } }),
    ]);
    expect((await f.get()).content).toEqual({ name: "Ada", role: true });
    expect(await f.referenced()).toMatchObject({ content: { name: "Ada", role: true } });

    await f.syncCollections([people({ role: { type: "boolean", fieldType: "Boolean" } })]);
    expect((await f.get()).content).toEqual({ name: "Ada", role: false });

    await f.syncCollections([withRole]);
    expect((await f.get()).content).toEqual({ name: "Ada", role: "Engineer" });
  });

  it("fills a field added after records exist, with its default or an empty value of its kind", async () => {
    const f = await collectionFixture();
    await f.syncCollections([
      people({
        role: text({ default: "Member" }),
        bio: text(),
        active: { type: "boolean", fieldType: "Boolean" },
        team: { type: "string", fieldType: "Enum", enum: ["core", "guest"] },
        photo: { type: "object", fieldType: "Image" },
        friends: {
          type: "array",
          fieldType: "ReferenceList",
          collectionId: "people",
          items: { type: "string", format: "uuid" },
        },
      }),
    ]);
    expect((await f.get()).content).toEqual({
      name: "Ada",
      role: "Engineer",
      bio: "",
      active: false,
      team: "core",
      photo: null,
      friends: [],
    });
  });

  it("keeps a removed field's value stored through edits", async () => {
    const f = await collectionFixture();
    await f.syncCollections([people({})]);
    await callSeedingLive(
      router.collectionDefinitions.editRecord,
      { ...f.scope, id: f.record.id, content: { name: "Ada L." } },
      f.options,
    );
    await f.syncCollections([withRole]);
    expect((await f.get()).content).toEqual({ name: "Ada L.", role: "Engineer" });
  });

  it("hides records of a removed collection from lists and references, and rejects writes to them", async () => {
    const f = await collectionFixture();
    await f.syncCollections([]);

    await expect(
      call(router.collectionDefinitions.listRecords, f.scope, f.options),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.get()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await f.referenced()).toBeNull();
    await expect(
      call(
        router.collectionDefinitions.findRecordsByField,
        { ...f.scope, field: "name", value: "Ada" },
        f.options,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callSeedingLive(
        router.collectionDefinitions.editRecord,
        { ...f.scope, id: f.record.id, content: { name: "X" } },
        f.options,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callSeedingLive(
        router.collectionDefinitions.createRecord,
        { ...f.scope, content: { name: "X" } },
        f.options,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await f.syncCollections([withRole]);
    expect(await f.referenced()).toMatchObject({ content: { name: "Ada", role: "Engineer" } });
  });
});

describe("blocks of a removed block definition", () => {
  it("are kept, read with no content, render no Markdown, and come back with their definition", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "cards", content: { heading: "Team", cards: [{ label: "Ada" }] } },
      f.options,
    );
    await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Kept" } },
      f.options,
    );

    const sync = await f.release.blocks([hero]);
    expect(sync.deletedDefinitionTypes).toEqual(["cards"]);

    const page = await call(
      router.pages.getByPath,
      { projectSlug: f.project.slug, path: f.page.fullPath },
      f.options,
    );
    expect(page.page.blockIds).toContain(block.id);
    expect(page.blocks.find((b) => b.id === block.id)).toMatchObject({
      type: "cards",
      content: {},
      settings: null,
    });
    expect(page.repeatableItems).toEqual([]);
    const markdown = await call(router.blocks.getPageMarkdown, { pageId: f.page.id }, f.options);
    expect(markdown.blocks.map((b) => b.id)).not.toContain(block.id);
    expect(markdown.markdown).not.toContain("Team");

    await f.release.blocks([hero, cards({ cards: cardsRepeater })]);
    const restored = await call(router.blocks.get, { id: block.id }, f.options);
    expect(restored.block.content).toMatchObject({ heading: "Team" });
    expect(restored.repeatableItems.map((i) => i.content)).toEqual([{ label: "Ada" }]);
  });

  it("can be deleted", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "cards", content: { heading: "Team" } },
      f.options,
    );
    await f.release.blocks([hero]);
    await callSeedingLive(router.blocks.delete, { id: block.id }, f.options);
    const page = await call(
      router.pages.getByPath,
      { projectSlug: f.project.slug, path: f.page.fullPath },
      f.options,
    );
    expect(page.page.blockIds).not.toContain(block.id);
  });

  it("keep rendering when their definition becomes layout-only", async () => {
    const f = await fixture();
    const block = await callSeedingLive(
      router.blocks.create,
      { pageId: f.page.id, type: "hero", content: { title: "Kept" } },
      f.options,
    );
    await f.release.blocks([{ ...hero, layoutOnly: true }, cards({ cards: cardsRepeater })]);
    const page = await call(
      router.pages.getByPath,
      { projectSlug: f.project.slug, path: f.page.fullPath },
      f.options,
    );
    expect(page.blocks.find((b) => b.id === block.id)?.content).toEqual({
      title: "Kept",
      subtitle: "Hello",
    });
  });
});
