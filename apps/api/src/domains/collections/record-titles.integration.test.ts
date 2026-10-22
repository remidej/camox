import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { collectionDefinitionProcedures as routes } from "./routes";

const string = { type: "string", fieldType: "String", default: "" };
const people = {
  collectionId: "people",
  title: "People",
  description: "",
  contentSchema: {
    type: "object",
    properties: { firstName: string, lastName: string, role: string, slug: string },
    required: ["firstName", "lastName", "role", "slug"],
    additionalProperties: false,
  },
};
const teams = {
  collectionId: "teams",
  title: "Teams",
  description: "",
  toTitle: "{{name}}",
  toDescription: null,
  contentSchema: {
    type: "object",
    properties: {
      name: string,
      members: {
        type: "array",
        fieldType: "ReferenceList",
        collectionId: "people",
        items: { type: "string", format: "uuid" },
        default: [],
      },
    },
    required: ["name", "members"],
    additionalProperties: false,
  },
};

async function fixture(peopleDefinition: Record<string, unknown>) {
  const base = await createProjectFixture(`record-titles-${crypto.randomUUID()}`);
  const options = { context: createRpcContext(base.db, base.memberUser) };
  const visitor = { context: createRpcContext(base.db, null) };
  await syncDefinitionSet(base.db, base.project, {
    collections: [{ ...people, ...peopleDefinition }, teams] as never,
  });
  const named = { projectUuid: base.project.uuid };
  const person = (content: Record<string, string>) =>
    callSeedingLive(
      routes.createRecord,
      {
        ...named,
        collectionId: "people",
        content: { firstName: "", lastName: "", role: "", slug: "", ...content },
      },
      options,
    );
  return { ...base, named, options, visitor, person };
}

describe("record titles and descriptions", () => {
  it("names each record from its collection's title and description templates", async () => {
    const f = await fixture({
      toTitle: "{{firstName}} {{lastName}}",
      toDescription: "{{role}}",
    });
    const ada = await f.person({
      firstName: "Ada",
      lastName: "Lovelace",
      role: "Mathematician",
      slug: "ada",
    });
    const scope = { ...f.named, collectionId: "people" };

    expect(await callSeedingLive(routes.listRecords, scope, f.options)).toEqual([
      {
        id: ada.id,
        title: "Ada Lovelace",
        description: "Mathematician",
        duplicatePageValue: false,
      },
    ]);
    expect(await call(routes.listRecordPageValues, { ...scope, field: "slug" }, f.visitor)).toEqual(
      [{ id: ada.id, value: "ada", title: "Ada Lovelace", description: "Mathematician" }],
    );
    expect(
      await call(routes.findRecordsByField, { ...scope, field: "slug", value: "ada" }, f.visitor),
    ).toMatchObject([{ id: ada.id, title: "Ada Lovelace", description: "Mathematician" }]);
  });

  it("names referenced records, and lists them by title in Markdown", async () => {
    const f = await fixture({
      toTitle: "{{firstName}} {{lastName}}",
      toDescription: "{{role}}",
    });
    const ada = await f.person({ firstName: "Ada", lastName: "Lovelace", role: "Mathematician" });
    const grace = await f.person({ firstName: "Grace", lastName: "Hopper" });
    const team = await callSeedingLive(
      routes.createRecord,
      {
        ...f.named,
        collectionId: "teams",
        content: { name: "Pioneers", members: [ada.id, grace.id] },
      },
      f.options,
    );
    const scope = { ...f.named, collectionId: "teams" };

    const [found] = await call(
      routes.findRecordsByField,
      { ...scope, field: "name", value: "Pioneers" },
      f.visitor,
    );
    expect(found.references.members).toMatchObject([
      { id: ada.id, title: "Ada Lovelace", description: "Mathematician" },
      { id: grace.id, title: "Grace Hopper", description: null },
    ]);
    expect(
      await call(
        routes.recordMarkdown,
        { ...scope, id: team.id, toMarkdown: ["{{members}}"] },
        f.visitor,
      ),
    ).toBe("- Ada Lovelace\n- Grace Hopper");
  });

  it("gives records no description when the collection describes nothing", async () => {
    const f = await fixture({ toTitle: "{{firstName}}", toDescription: null });
    const ada = await f.person({ firstName: "Ada", role: "Mathematician" });

    expect(
      await callSeedingLive(routes.listRecords, { ...f.named, collectionId: "people" }, f.options),
    ).toEqual([{ id: ada.id, title: "Ada", description: null, duplicatePageValue: false }]);
  });

  it("rejects templates naming fields the collection doesn't have", async () => {
    await expect(fixture({ toTitle: "{{nickname}}", toDescription: null })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        issues: [expect.objectContaining({ message: expect.stringContaining("nickname") })],
      },
    });
  });

  it("still syncs and reads a definition set naming records with the old label", async () => {
    const f = await fixture({ label: "firstName" });
    const ada = await f.person({ firstName: "Ada", lastName: "Lovelace", role: "Mathematician" });

    expect(
      await callSeedingLive(routes.listRecords, { ...f.named, collectionId: "people" }, f.options),
    ).toEqual([{ id: ada.id, title: "Ada", description: null, duplicatePageValue: false }]);
    expect(
      await callSeedingLive(routes.get, { ...f.named, collectionId: "people" }, f.options),
    ).toMatchObject({ toTitle: "{{firstName}}", toDescription: null });
  });
});
