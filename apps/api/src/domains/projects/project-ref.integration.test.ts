import { DEVELOPMENT_DRAFT, DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";
import type { ProjectRef } from "./ref";

// A website's code, the studio and the CLI name a project by its Project ID. Its Project Slug is
// only an address, which the inputs they send don't take.

const navbar = (brand: string): TestDefinitionSet => ({
  blocks: [
    {
      blockId: "navbar",
      title: "Navbar",
      description: "Navbar",
      synced: true,
      contentSchema: {
        type: "object",
        properties: { brand: { type: "string", fieldType: "String" } },
        toMarkdown: ["{{brand}}"],
      },
    },
  ],
  layouts: [
    {
      layoutId: "default",
      description: "Layout",
      blocks: [{ type: "navbar", slot: "before", content: { brand }, repeatableItems: [] }],
    },
  ],
});

async function fixture() {
  const base = await createProjectFixture(`project-ref-${crypto.randomUUID()}`);
  const { db, project } = base;
  const visitor = () => ({ context: createRpcContext(db, null) });
  /** The brands the default layout shows: in Live, or as `context` reads it. */
  const brands = async (context = visitor()) => {
    const layout = await call(
      router.layouts.get,
      { projectUuid: project.uuid, layoutId: "default" },
      context,
    );
    return layout.blocks.map((block) => (block.content as { brand: string }).brand);
  };
  const inDevelopmentDraft = () => ({
    context: createRpcContext(db, base.memberUser, { [DRAFT_HEADER]: DEVELOPMENT_DRAFT }),
  });
  return { ...base, visitor, brands, inDevelopmentDraft };
}

describe("A project named by its Project ID", () => {
  it("gets its definitions released to Live with the Deploy Token", async () => {
    const f = await fixture();

    await syncDefinitionSet(f.db, f.project, navbar("Acme"));

    expect(await f.brands()).toEqual(["Acme"]);
  });

  it("is refused a release with the wrong Deploy Token", async () => {
    const f = await fixture();
    const project = { ...f.project, deployToken: "wrong-deploy-token" };

    await expect(syncDefinitionSet(f.db, project, navbar("Acme"))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(await f.brands()).toEqual([]);
  });

  it("gets its definitions synced to a member's development draft when running locally", async () => {
    const f = await fixture();

    await syncDefinitionSet(f.db, f.project, navbar("Local"), {
      as: f.memberUser,
    });

    expect(await f.brands(f.inDevelopmentDraft())).toEqual(["Local"]);
    expect(await f.brands()).toEqual([]);
  });

  it("is loaded for a member, like by its slug", async () => {
    const f = await fixture();
    const member = { context: createRpcContext(f.db, f.memberUser) };

    const byId = await call(router.projects.getByUuid, { projectUuid: f.project.uuid }, member);

    expect(byId).toMatchObject({ id: f.project.id, uuid: f.project.uuid, slug: f.project.slug });
    expect(byId).toEqual(await call(router.projects.getBySlug, { slug: f.project.slug }, member));
  });

  it("is not loaded for someone outside its organization", async () => {
    const f = await fixture();
    const outsider = { context: createRpcContext(f.db, f.outsiderUser) };

    await expect(
      call(router.projects.getByUuid, { projectUuid: f.project.uuid }, outsider),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["an uppercase Project ID", (uuid: string) => uuid.toUpperCase()],
    ["a Project ID that isn't a UUIDv7", () => crypto.randomUUID()],
  ])("is not loaded by %s", async (_, projectUuidOf) => {
    const f = await fixture();
    const member = { context: createRpcContext(f.db, f.memberUser) };

    await expect(
      call(router.projects.getByUuid, { projectUuid: projectUuidOf(f.project.uuid) }, member),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

const articles: TestDefinitionSet["collections"] = [
  {
    collectionId: "articles",
    title: "Articles",
    description: "",
    label: "title",
    contentSchema: {
      type: "object",
      properties: { title: { type: "string", fieldType: "String" } },
      required: ["title"],
      additionalProperties: false,
    },
  },
];

/** A project with, on Live, a page, a navbar in its layout and a collection record. */
async function fixtureWithContent() {
  const f = await fixture();
  const { db, project, memberUser } = f;
  await syncDefinitionSet(db, project, { ...navbar("Acme"), collections: articles });
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  await callSeedingLive(
    router.pages.create,
    { projectId: project.id, pathSegment: "pricing", layoutId: "default" },
    member(),
  );
  const record = await callSeedingLive(
    router.collectionDefinitions.createRecord,
    { projectUuid: project.uuid, collectionId: "articles", content: { title: "First" } },
    member(),
  );
  const byId = { projectUuid: project.uuid };
  // The project named by its slug, which the inputs' types don't allow.
  const bySlug = { projectSlug: project.slug } as unknown as ProjectRef;
  return { ...f, record, member, byId, bySlug };
}

type Content = Awaited<ReturnType<typeof fixtureWithContent>>;

/** The public reads a website's Worker makes, each naming the project as `named`. */
const publicReads: Record<string, (f: Content, named: ProjectRef) => Promise<unknown>> = {
  "pages.getByPath": (f, named) =>
    call(router.pages.getByPath, { ...named, path: "/pricing" }, f.visitor()),
  "pages.getStructure": (f, named) =>
    call(router.pages.getStructure, { ...named, path: "/pricing" }, f.visitor()),
  "pages.listBySlug": (f, named) => call(router.pages.listBySlug, named, f.visitor()),
  "layouts.get": (f, named) =>
    call(router.layouts.get, { ...named, layoutId: "default" }, f.visitor()),
  "blocks.getLayoutMarkdown": (f, named) =>
    call(router.blocks.getLayoutMarkdown, { ...named, layoutId: "default" }, f.visitor()),
  "locales.list": (f, named) => call(router.locales.list, named, f.visitor()),
  "collectionDefinitions.findRecordsByField": (f, named) =>
    call(
      router.collectionDefinitions.findRecordsByField,
      { ...named, collectionId: "articles", field: "title", value: "First" },
      f.visitor(),
    ),
  "collectionDefinitions.listRecordPageValues": (f, named) =>
    call(
      router.collectionDefinitions.listRecordPageValues,
      { ...named, collectionId: "articles", field: "title" },
      f.visitor(),
    ),
  "collectionDefinitions.recordMarkdown": (f, named) =>
    call(
      router.collectionDefinitions.recordMarkdown,
      { ...named, collectionId: "articles", id: f.record.id, toMarkdown: ["# {{title}}"] },
      f.visitor(),
    ),
};

/** The studio's collection reads, as a member, each naming the project as `named`. */
const memberReads: Record<string, (f: Content, named: ProjectRef) => Promise<unknown>> = {
  "collectionDefinitions.list": (f, named) =>
    call(router.collectionDefinitions.list, named, f.member()),
  "collectionDefinitions.get": (f, named) =>
    call(router.collectionDefinitions.get, { ...named, collectionId: "articles" }, f.member()),
  "collectionDefinitions.listRecords": (f, named) =>
    call(
      router.collectionDefinitions.listRecords,
      { ...named, collectionId: "articles" },
      f.member(),
    ),
  "collectionDefinitions.getRecord": (f, named) =>
    call(
      router.collectionDefinitions.getRecord,
      { ...named, collectionId: "articles", id: f.record.id },
      f.member(),
    ),
  "collectionDefinitions.getRecordUsageCount": (f, named) =>
    call(
      router.collectionDefinitions.getRecordUsageCount,
      { ...named, collectionId: "articles", id: f.record.id },
      f.member(),
    ),
};

describe("A read naming the project", () => {
  const reads = { ...publicReads, ...memberReads };

  it.each(Object.keys(reads))("%s finds it by its Project ID", async (name) => {
    const f = await fixtureWithContent();

    expect(await reads[name]!(f, f.byId)).toBeTruthy();
  });

  it.each(Object.keys(reads))("%s is rejected when it names it by its slug", async (name) => {
    const f = await fixtureWithContent();

    await expect(reads[name]!(f, f.bySlug)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("A project's name in an input", () => {
  const invalidNames: Record<string, (project: { uuid: string; slug: string }) => object> = {
    "an uppercase Project ID": ({ uuid }) => ({ projectUuid: uuid.toUpperCase() }),
    "a Project ID that isn't a UUIDv7": () => ({ projectUuid: crypto.randomUUID() }),
    "its slug": ({ slug }) => ({ projectSlug: slug }),
    "no name at all": () => ({}),
  };
  const procedures: Record<string, (f: Content, names: object) => Promise<unknown>> = {
    "definitions.sync": (f, names) =>
      call(
        router.definitions.sync,
        {
          ...(names as ProjectRef),
          deployToken: f.project.deployToken,
          autoCreate: false,
          definitionSet: { blocks: [], layouts: [], collections: [], homepage: null },
        },
        f.visitor(),
      ),
    "pages.getByPath": (f, names) =>
      call(router.pages.getByPath, { ...(names as ProjectRef), path: "/pricing" }, f.visitor()),
    "collectionDefinitions.list": (f, names) =>
      call(router.collectionDefinitions.list, names as ProjectRef, f.member()),
  };
  const cases = Object.keys(invalidNames).flatMap((names) =>
    Object.keys(procedures).map((procedure) => [names, procedure] as const),
  );

  it.each(cases)("is rejected when it's %s (%s)", async (names, procedure) => {
    const f = await fixtureWithContent();

    await expect(procedures[procedure]!(f, invalidNames[names]!(f.project))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("A collection write naming the project by its Project ID", () => {
  it("creates, edits and deletes a record in the member's draft", async () => {
    const f = await fixtureWithContent();
    const inDraft = f.member({ [DRAFT_HEADER]: generateUuidv7(), [DRAFT_CREATE_HEADER]: "1" });
    const scope = { ...f.byId, collectionId: "articles" };

    const created = await call(
      router.collectionDefinitions.createRecord,
      { ...scope, content: { title: "Second" } },
      inDraft,
    );
    const edited = await call(
      router.collectionDefinitions.editRecord,
      { ...scope, id: created.id, content: { title: "Second, edited" } },
      inDraft,
    );
    await call(router.collectionDefinitions.deleteRecord, { ...scope, id: f.record.id }, inDraft);

    expect(edited.content).toEqual({ title: "Second, edited" });
    const records = await call(router.collectionDefinitions.listRecords, scope, inDraft);
    expect(records.map(({ title }) => title)).toEqual(["Second, edited"]);
  });
});
