import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext, syncDefinitionSet } from "../../../test/fixtures";
import { router } from "../../router";

// Collection records are linked entities: a collection's `toStructuredData` template defines
// each record's node once, and references in block and repeatable item templates link to it.
// The API evaluates record nodes beside blocks' nodes on every page read, and leaves links to
// records as `camox:record:` ids, which the runtime turns into absolute `@id`s.

type Headers = Record<string, string>;

const string = { type: "string", fieldType: "String" } as const;
const reference = (collectionId: string) => ({
  fieldType: "Reference" as const,
  collectionId,
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
  default: null,
});

const companies = {
  collectionId: "companies",
  title: "Companies",
  description: "",
  toTitle: "{{name}}",
  toDescription: null,
  contentSchema: {
    type: "object" as const,
    properties: { name: string },
    required: ["name"],
    additionalProperties: false as const,
  },
  toStructuredData: { "@type": "Organization", name: "{{name}}" },
};

const people = {
  collectionId: "people",
  title: "People",
  description: "",
  toTitle: "{{name}}",
  toDescription: "{{bio}}",
  contentSchema: {
    type: "object" as const,
    properties: { name: string, bio: string, role: string, employer: reference("companies") },
    required: ["name", "bio", "role", "employer"],
    additionalProperties: false as const,
  },
  toStructuredData: { "@type": "Person", jobTitle: "{{role}}", worksFor: "{{employer}}" },
};

/** A collection without structured data. */
const topics = {
  collectionId: "topics",
  title: "Topics",
  description: "",
  toTitle: "{{label}}",
  toDescription: null,
  contentSchema: {
    type: "object" as const,
    properties: { label: string },
    required: ["label"],
    additionalProperties: false as const,
  },
};

const testimonial = {
  blockId: "testimonial",
  title: "Testimonial",
  description: "A quote",
  contentSchema: {
    type: "object" as const,
    properties: { quote: string, author: reference("people"), topic: reference("topics") },
    toMarkdown: ["{{quote}}"],
    toTitle: "{{quote}}",
    toStructuredData: {
      "@type": "Review",
      reviewBody: "{{quote}}",
      author: "{{author}}",
      about: "{{topic}}",
    },
  },
};

/** A block that references people without placing them in any node. */
const byline = {
  blockId: "byline",
  title: "Byline",
  description: "Who wrote it",
  contentSchema: {
    type: "object" as const,
    properties: { person: reference("people") },
    toMarkdown: [],
    toTitle: "Byline",
  },
};

/** A project with the definitions above, and a draft every test reads and writes in. */
async function fixture() {
  const base = await createProjectFixture(`record-structured-data-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  const projectUuid = project.uuid;
  await syncDefinitionSet(db, project, {
    blocks: [testimonial, byline],
    collections: [companies, people, topics],
  });
  const draft = generateUuidv7();
  const en: Headers = { [DRAFT_HEADER]: draft };
  const de: Headers = { [DRAFT_HEADER]: draft, [LOCALE_HEADER]: "de" };
  const member = (headers: Headers) => ({ context: createRpcContext(db, memberUser, headers) });
  const { page: help } = await call(
    router.pages.create,
    { projectId, pathSegment: "help", layoutId: base.layout.layoutId },
    member({ ...en, [DRAFT_CREATE_HEADER]: "1" }),
  );
  const record = (collectionId: string, content: Record<string, unknown>) =>
    call(
      router.collectionDefinitions.createRecord,
      { projectUuid, collectionId, content },
      member(en),
    );
  const create = (type: string, content: Record<string, unknown>) =>
    call(router.blocks.create, { pageId: help.id, type, content }, member(en));
  const read = (headers: Headers = en) =>
    call(router.pages.getByPath, { projectUuid, path: "/help" }, member(headers));
  const acme = await record("companies", { name: "Acme" });
  const ada = await record("people", {
    name: "Ada",
    bio: "Writes about content.",
    role: "Founder",
    employer: acme.id,
  });
  return { ...base, projectId, projectUuid, en, de, member, record, create, read, acme, ada };
}

describe("records as linked entities", () => {
  it("links a block's reference to the record's node, with the records it links", async () => {
    const f = await fixture();
    const block = await f.create("testimonial", { quote: "Great", author: f.ada.id });

    const { structuredData, recordStructuredData } = await f.read();

    expect(structuredData[block.id]).toEqual([
      { "@type": "Review", reviewBody: "Great", author: { "@id": `camox:record:${f.ada.id}` } },
    ]);
    expect(recordStructuredData.nodes[f.ada.id]).toEqual({
      "@type": "Person",
      "@id": `camox:record:${f.ada.id}`,
      name: "Ada",
      description: "Writes about content.",
      jobTitle: "Founder",
      worksFor: { "@id": `camox:record:${f.acme.id}` },
    });
    expect(recordStructuredData.nodes[f.acme.id]).toEqual({
      "@type": "Organization",
      "@id": `camox:record:${f.acme.id}`,
      name: "Acme",
    });
  });

  it("resolves a reference to a collection without structured data to the record's title", async () => {
    const f = await fixture();
    const topic = await f.record("topics", { label: "Pricing" });
    const block = await f.create("testimonial", { quote: "Cheap", topic: topic.id });

    const { structuredData, recordStructuredData } = await f.read();

    expect(structuredData[block.id]).toEqual([
      { "@type": "Review", reviewBody: "Cheap", about: "Pricing" },
    ]);
    expect(recordStructuredData.nodes).not.toHaveProperty(topic.id);
  });

  it("lists the records the page's content references, whether or not a template places them", async () => {
    const f = await fixture();
    const grace = await f.record("people", {
      name: "Grace",
      bio: "",
      role: "Engineer",
      employer: null,
    });
    await f.create("testimonial", { quote: "Great", author: f.ada.id });
    await f.create("byline", { person: grace.id });

    const { recordStructuredData } = await f.read();

    expect(recordStructuredData.referenced.toSorted()).toEqual([f.ada.id, grace.id].toSorted());
    // Ada's employer is only linked by Ada's node: the page's content doesn't reference it.
    expect(recordStructuredData.nodes).toHaveProperty(f.acme.id);
  });

  it("describes a German page's records with their German content", async () => {
    const f = await fixture();
    await f.create("testimonial", { quote: "Great", author: f.ada.id });
    await call(router.locales.add, { projectId: f.projectId, tag: "de" }, f.member(f.en));
    await call(
      router.collectionDefinitions.editRecord,
      {
        projectUuid: f.projectUuid,
        collectionId: "people",
        id: f.ada.id,
        content: {
          name: "Ada",
          bio: "Schreibt über Inhalte.",
          role: "Gründerin",
          employer: f.acme.id,
        },
      },
      f.member(f.de),
    );

    const german = (await f.read(f.de)).recordStructuredData.nodes[f.ada.id];
    const english = (await f.read()).recordStructuredData.nodes[f.ada.id];

    expect(german).toMatchObject({ jobTitle: "Gründerin", description: "Schreibt über Inhalte." });
    expect(english).toMatchObject({ jobTitle: "Founder" });
  });
});
