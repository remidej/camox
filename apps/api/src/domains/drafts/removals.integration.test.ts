import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { collection as customers } from "../../../../playground/src/collections/customers";
import {
  callSeedingLive,
  createRpcContext,
  startDraft,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import { answerFrom, answerWithToolCall, forgetThreadModel } from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  signIn,
  textDefinition,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";
import { collectionDefinitionProcedures } from "../collections/routes";

// A draft whose code removes a definition or field that Live content still uses gets a warning
// in its publish preview (ADR 0021): no developer meant the removal, so a member should notice.
// It never blocks publishing (ADR 0007). The draft's code reaches its definitions through a
// revision the fake sandbox builds with a scripted Definition Set (test/release-fakes.js).

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type Fakes = { defineBuildsOf(marker: string, definitionSet: unknown): Promise<void> };

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const quoteDefinition = {
  blockId: "quote",
  title: "Quote",
  description: "A quote",
  contentSchema: {
    type: "object",
    toMarkdown: ["{{quote}}"],
    properties: { quote: { type: "string", fieldType: "String" } },
  },
};

/** The text block with a `caption` field beside its body, which no Live content holds. */
const captionedText = {
  ...textDefinition,
  contentSchema: {
    ...textDefinition.contentSchema,
    properties: {
      ...textDefinition.contentSchema.properties,
      caption: { type: "string", fieldType: "String" },
    },
  },
};

/** The text block with its body replaced by a heading. */
const headedText = {
  ...textDefinition,
  contentSchema: {
    type: "object",
    toMarkdown: ["{{heading}}"],
    properties: { heading: { type: "string", fieldType: "String" } },
  },
};

/** The playground's customers collection, as its code syncs it. */
const customersDefinition = (() => {
  const { id, ...definition } = customers._internal;
  return JSON.parse(JSON.stringify({ ...definition, collectionId: id }));
})();

/** The customers collection without its company field. */
const customersWithoutCompany = (() => {
  const { contentSchema } = customersDefinition;
  const { company: _, ...properties } = contentSchema.properties;
  const required = (contentSchema.required ?? []).filter((name: string) => name !== "company");
  return {
    ...customersDefinition,
    contentSchema: { ...contentSchema, properties, required },
    // Its templates no longer name the field.
    toDescription: null,
    toStructuredData: null,
  };
})();

/** What a test's Definition Set holds; each part it leaves out is the website's own. */
type Code = Pick<TestDefinitionSet, "blocks" | "layouts" | "collections">;

/** The website's Definition Set as its code gives it: its text block and layout, then `code`. */
const definitionSetWith = (website: Website, code: Code) => ({
  blocks: [textDefinition],
  layouts: [{ layoutId: website.layout.layoutId, description: "Default", blocks: [] }],
  collections: [],
  homepage: null,
  ...code,
});

/**
 * A website whose Live home and about pages each hold a text block, released with `live`, and
 * whose `main` holds its code.
 */
async function websiteWithCode(live: Code = {}) {
  const website = await websiteFixture({ home: "Hello", about: "About us" });
  await syncDefinitionSet(website.db, website.project, definitionSetWith(website, live));
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
    "src/blocks/text.tsx": `export const text = "text";\n`,
  });
  const token = await signIn(website.db, website.memberUser.id);
  return { website, token };
}

/** A draft whose agent changed the code and built it into a revision giving `code`. */
async function draftWithCode(website: Website, token: string, code: Code) {
  const marker = crypto.randomUUID();
  await fakes.defineBuildsOf(marker, definitionSetWith(website, code));
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(website.project.id, draftId, token);
  answerWithToolCall("write", {
    path: "src/blocks/text.tsx",
    content: `export const text = "changed"; // ${marker}\n`,
  });
  answerWithToolCall("build", {});
  answerFrom(() => "Changed it.");
  await ask(thread, "Change the website's code");
  return draftId;
}

/** Ada, a Live customer record. */
async function liveCustomer({ db, memberUser, project }: Website) {
  await callSeedingLive(
    collectionDefinitionProcedures.createRecord,
    {
      projectUuid: project.uuid,
      collectionId: customersDefinition.collectionId,
      content: { name: "Ada", company: "Engines", logo: null },
    },
    { context: createRpcContext(db, memberUser) },
  );
}

/** The draft's publish preview, as the studio's review reads it. */
async function previewOf({ db, memberUser, project }: Website, draftId: string) {
  const context = createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId });
  return call(router.drafts.previewPublish, { projectId: project.id }, { context });
}

/** The removal warnings of a preview: what each names, and where. */
const removalsIn = (preview: Awaited<ReturnType<typeof previewOf>>) =>
  preview.warnings
    .filter((warning) => warning.code === "removedInUse")
    .map(({ label, owner, field, message }) => ({
      label,
      place: owner?.kind === "page" ? owner.path : owner?.kind === "collection" ? owner.name : null,
      field,
      message,
    }))
    .sort((a, b) => (`${a.place}` < `${b.place}` ? -1 : 1));

describe("a draft's code removing what Live content uses", () => {
  it("warns of a removed block definition, naming it and each Live page using it", async () => {
    const { website, token } = await websiteWithCode();
    const draftId = await draftWithCode(website, token, { blocks: [quoteDefinition] });

    const preview = await previewOf(website, draftId);

    const message = `This draft's code removes the "Text" block, which this content uses`;
    expect(removalsIn(preview)).toEqual([
      { label: "text", place: "/about", field: "", message },
      { label: "text", place: "/home", field: "", message },
    ]);
    expect(preview.blockers).toEqual([]);
  });

  it("warns of a removed field that Live content holds values for", async () => {
    const { website, token } = await websiteWithCode();
    const draftId = await draftWithCode(website, token, { blocks: [headedText] });

    const preview = await previewOf(website, draftId);

    const message = `This draft's code removes the "body" field from the "Text" block, which holds a value for it here`;
    expect(removalsIn(preview)).toEqual([
      { label: "Text", place: "/about", field: "body", message },
      { label: "Text", place: "/home", field: "body", message },
    ]);
    expect(preview.blockers).toEqual([]);
  });

  it("says nothing of removed definitions and fields that no Live content uses", async () => {
    const { website, token } = await websiteWithCode({
      blocks: [captionedText, quoteDefinition],
    });
    const draftId = await draftWithCode(website, token, {});

    const preview = await previewOf(website, draftId);

    expect(removalsIn(preview)).toEqual([]);
  });

  it("warns of a removed layout on each Live page using it", async () => {
    const { website, token } = await websiteWithCode();
    const draftId = await draftWithCode(website, token, {
      layouts: [{ layoutId: "landing", description: "Landing", blocks: [] }],
    });

    const preview = await previewOf(website, draftId);

    const message = `This draft's code removes the "${website.layout.layoutId}" layout, which this page uses`;
    expect(removalsIn(preview)).toEqual([
      { label: "Page", place: "/about", field: "", message },
      { label: "Page", place: "/home", field: "", message },
    ]);
  });

  it("warns of a removed collection on its Live records", async () => {
    const { website, token } = await websiteWithCode({ collections: [customersDefinition] });
    await liveCustomer(website);
    const draftId = await draftWithCode(website, token, {});

    const preview = await previewOf(website, draftId);

    expect(removalsIn(preview)).toEqual([
      {
        label: "Record",
        place: "customers",
        field: "",
        message: `This draft's code removes the "Customers" collection, which holds this record`,
      },
    ]);
  });

  it("warns of a removed collection field on the Live records holding a value for it", async () => {
    const { website, token } = await websiteWithCode({ collections: [customersDefinition] });
    await liveCustomer(website);
    const draftId = await draftWithCode(website, token, {
      collections: [customersWithoutCompany],
    });

    const preview = await previewOf(website, draftId);

    expect(removalsIn(preview)).toEqual([
      {
        label: "Ada",
        place: "customers",
        field: "company",
        message: `This draft's code removes the "company" field from the "Customers" collection, which holds a value for it here`,
      },
    ]);
  });
});
