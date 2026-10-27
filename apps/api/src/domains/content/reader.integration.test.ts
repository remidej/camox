import { generateUuidv7 } from "@camox/api-contract/ids";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, noArtifactFields, seedLive } from "../../../test/fixtures";
import { createDb } from "../../db";
import { runService } from "../../lib/run-service";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  drafts,
  files,
  pages,
  projects,
  repeatableItems,
  sharedContentId,
  sharedContents,
} from "../../schema";
import * as overlay from "../drafts/overlay";
import { draftOf, type Draft, type DraftScope } from "../drafts/scope";
import { saveValue } from "../generated-values/service";
import { contentReader, type ResolvedReference } from "./reader";

const now = 1_700_000_000_000;
const string = (fallback = "") => ({ type: "string", fieldType: "String", default: fallback });
const image = { type: "object", fieldType: "Image" };
const person = { fieldType: "Reference", collectionId: "people", default: null };

const cardSchema = {
  type: "object",
  properties: {
    title: string("Untitled"),
    note: string(),
    photo: image,
    author: person,
    link: { type: "object", fieldType: "Link" },
    cards: {
      type: "array",
      fieldType: "Repeater",
      items: { type: "object", properties: { label: string("Card"), who: person } },
      toStructuredData: { "@type": "Question", name: "{{label}}" },
    },
  },
  toMarkdown: ["# {{title}}", "{{author.name}}"],
  toStructuredData: [
    { "@type": "Product", name: "{{title}}", image: "{{photo}}", url: "{{link}}" },
    "{{cards}}",
  ],
};

const peopleSchema = {
  type: "object",
  properties: { name: string(), avatar: image, mentor: person },
};

/** A D1 binding that counts the statements it prepares: one per query. */
function countingDb() {
  let statements = 0;
  const d1 = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          statements += 1;
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: createDb(d1),
    reset: () => void (statements = 0),
    count: () => statements,
  };
}

async function fixture() {
  const base = await createProjectFixture(`reader-${crypto.randomUUID()}`);
  const { db, project, layout } = base;
  await db.insert(blockDefinitions).values(
    ["card", "banner"].map((blockId) => ({
      projectId: project.id,
      blockId,
      title: blockId === "card" ? "Card" : "Banner",
      description: "",
      contentSchema: cardSchema,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(collectionDefinitions).values({
    projectId: project.id,
    collectionId: "people",
    title: "People",
    description: "",
    toTitle: "{{name}}",
    contentSchema: peopleSchema,
    schemaHash: "people",
  });
  const page = await seedLive(db, pages, {
    projectId: project.id,
    layoutId: layout.layoutId,
    pathSegment: "home",
    fullPath: "/home",
    nickname: "Home",
    contentUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const file = (projectId: number, name: string) =>
    seedLive(db, files, {
      projectId,
      url: `https://example.com/${name}`,
      filename: name,
      alt: name,
      mimeType: "image/png",
      size: 1,
      blobId: name,
      path: name,
      createdAt: now,
      updatedAt: now,
    });
  const person = (name: string, avatar?: string, mentor?: string) =>
    seedLive(db, collectionRecords, {
      projectId: project.id,
      collectionId: "people",
      content: { name, avatar: avatar ? { _fileId: avatar } : null, mentor: mentor ?? null },
      createdAt: now,
      updatedAt: now,
    });
  let position = 0;
  const linkedPage = () => {
    const segment = `linked-${generateUuidv7()}`;
    return seedLive(db, pages, {
      projectId: project.id,
      layoutId: layout.layoutId,
      pathSegment: segment,
      fullPath: `/${segment}`,
      nickname: segment,
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  };
  const card = (content: Record<string, unknown>, type = "card") =>
    seedLive(db, blocks, {
      projectId: project.id,
      pageId: page.id,
      type,
      content,
      position: `a${position++}`,
      createdAt: now,
      updatedAt: now,
    });
  const item = (blockId: string, content: Record<string, unknown>) =>
    seedLive(db, repeatableItems, {
      blockId,
      fieldName: "cards",
      content,
      position: `a${position++}`,
      createdAt: now,
      updatedAt: now,
    });
  const openDraft = async () =>
    draftOf(
      await db
        .insert(drafts)
        .values({
          projectId: project.id,
          kind: "regular",
          createdBy: base.memberUser.id,
          createdAt: now,
        })
        .returning()
        .get(),
    );
  const reader = (draft: DraftScope, database = db) =>
    contentReader({ db: database }, { projectId: project.id, draft });
  return { ...base, page, file, person, linkedPage, card, item, openDraft, reader };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Changes the card definition as a release would. */
const redefineCard = (f: Fixture, contentSchema: unknown) =>
  f.db.update(blockDefinitions).set({ contentSchema }).where(eq(blockDefinitions.blockId, "card"));

describe("the content reader", () => {
  it("conforms every view to the definitions in effect after they change", async () => {
    const f = await fixture();
    const ada = await f.person("Ada");
    const block = await f.card({ title: "Kept", note: "Dropped", author: ada.id });
    const item = await f.item(block.id, { label: "One", who: ada.id });
    await redefineCard(f, {
      ...cardSchema,
      properties: {
        title: string("Untitled"),
        eyebrow: string("New"),
        author: person,
        cards: {
          ...cardSchema.properties.cards,
          items: { type: "object", properties: { label: string("Card"), size: string("M") } },
        },
      },
    });
    await f.db
      .update(collectionDefinitions)
      .set({ contentSchema: { type: "object", properties: { name: string(), born: string("?") } } })
      .where(eq(collectionDefinitions.collectionId, "people"));
    const read = f.reader(null);

    const conformedBlock = { title: "Kept", eyebrow: "New", author: ada.id };
    const conformedItem = { label: "One", size: "M" };
    const conformedPerson = { name: "Ada", born: "?" };
    const [shownBlock] = await runService(read.shown.blocks([block]));
    expect(shownBlock!.content).toEqual(conformedBlock);
    const [shownItem] = await runService(read.shown.items([item]));
    expect(shownItem!.content).toEqual(conformedItem);
    const bundle = await runService(read.blocks([{ pageId: f.page.id }]));
    expect(bundle.blocks[0]!.content).toEqual({
      ...conformedBlock,
      cards: [{ _itemId: item.id }],
    });
    expect(bundle.repeatableItems[0]!.content).toEqual(conformedItem);
    expect((bundle.blocks[0]!.references.author as ResolvedReference).content).toEqual(
      conformedPerson,
    );
    const itemView = await runService(read.item(item));
    expect(itemView!.item.content).toEqual(conformedItem);
    const [record] = await runService(read.records("people", [ada]));
    expect(record!.content).toEqual(conformedPerson);
    const [shownRecord] = await runService(read.shown.records("people", [ada]));
    expect(shownRecord!.content).toEqual(conformedPerson);
    const [markdown] = await runService(read.markdown([{ pageId: f.page.id }]));
    expect(markdown!.json).not.toContain("Dropped");
  });

  it("shows shared content, summaries, references and files as Live, and as a draft over it", async () => {
    const f = await fixture();
    const liveAvatar = await f.file(f.project.id, "live.png");
    const ada = await f.person("Ada", liveAvatar.id);
    const shared = await seedLive(f.db, sharedContents, {
      id: sharedContentId({ projectId: f.project.id, type: "banner" }),
      projectId: f.project.id,
      type: "banner",
      content: { title: "Shared", author: ada.id },
      createdAt: now,
      updatedAt: now,
    });
    const placement = await f.card({}, "banner");
    const live = { projectId: f.project.id, draftId: null };
    const summaryKey = { entity: "sharedContent", entityId: shared.id, type: "summary" } as const;
    await runService(saveValue(f.db, live, summaryKey, { summary: "Live summary" }, now));

    const draft = await f.openDraft();
    await runService(
      overlay.update(
        f.db,
        draft,
        sharedContents,
        shared.id,
        {
          content: { title: "Drafted", author: ada.id },
        },
        noArtifactFields,
      ),
    );
    await runService(
      overlay.update(f.db, draft, collectionRecords, ada.id, {
        content: { name: "Ada L.", avatar: { _fileId: liveAvatar.id }, mentor: null },
      }),
    );
    await runService(overlay.update(f.db, draft, files, liveAvatar.id, { url: "https://d/x" }));
    const home = { projectId: f.project.id, draftId: draft.id };
    await runService(saveValue(f.db, home, summaryKey, { summary: "Draft summary" }, now));

    const view = async (scope: Draft | null) => {
      const bundle = await runService(f.reader(scope).blocks([{ pageId: f.page.id }]));
      const block = bundle.blocks.find((candidate) => candidate.id === placement.id)!;
      const author = block.references.author as ResolvedReference;
      return {
        title: block.content.title,
        summary: block.summary,
        author: author.title,
        avatar: (author.content.avatar as { url: string }).url,
        files: bundle.files.map((file) => file.url),
      };
    };
    expect(await view(null)).toEqual({
      title: "Shared",
      summary: "Live summary",
      author: "Ada",
      avatar: "https://example.com/live.png",
      files: ["https://example.com/live.png"],
    });
    expect(await view(draft)).toEqual({
      title: "Drafted",
      summary: "Draft summary",
      author: "Ada L.",
      avatar: "https://d/x",
      files: ["https://d/x"],
    });
  });

  it("resolves only files of the reader's project", async () => {
    const f = await fixture();
    const other = await f.db
      .insert(projects)
      .values({
        slug: `other-${crypto.randomUUID()}`,
        name: "Other",
        deployToken: "other",
        organizationId: f.project.organizationId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const foreign = await f.file(other.id, "foreign.png");
    const ada = await f.person("Ada", foreign.id);
    const block = await f.card({ photo: { _fileId: foreign.id }, author: ada.id });
    const read = f.reader(null);

    const bundle = await runService(read.blocks([{ block }]));
    expect(bundle.files).toEqual([]);
    expect((bundle.blocks[0]!.references.author as ResolvedReference).content.avatar).toBeNull();
    const [record] = await runService(read.records("people", [ada]));
    expect(record!.content.avatar).toBeNull();
  });

  it("gives an item its summary and the records it references", async () => {
    const f = await fixture();
    const ada = await f.person("Ada");
    const block = await f.card({});
    const item = await f.item(block.id, { label: "One", who: ada.id });
    const live = { projectId: f.project.id, draftId: null };
    const key = { entity: "repeatableItem", entityId: item.id, type: "summary" } as const;
    await runService(saveValue(f.db, live, key, { summary: "First card" }, now));

    const view = await runService(f.reader(null).item(item));
    expect(view!.item.summary).toBe("First card");
    expect((view!.item.references.who as ResolvedReference).title).toBe("Ada");
    const [shown] = await runService(f.reader(null).shown.items([item]));
    expect(shown!.summary).toBe("First card");
  });

  it("reads a page in the same number of queries whatever it holds", async () => {
    const f = await fixture();
    const counting = countingDb();
    const queriesFor = async (cards: number) => {
      for (let index = 0; index < cards; index++) {
        const avatar = await f.file(f.project.id, `avatar-${generateUuidv7()}.png`);
        const mentor = await f.person(`Mentor ${index}`, avatar.id);
        const author = await f.person(`Author ${index}`, avatar.id, mentor.id);
        const photo = await f.file(f.project.id, `photo-${generateUuidv7()}.png`);
        const block = await f.card({
          photo: { _fileId: photo.id },
          author: author.id,
          link: { type: "page", pageId: (await f.linkedPage()).id, text: "Read", newTab: false },
        });
        await f.item(block.id, { label: `Card ${index}`, who: mentor.id });
      }
      const read = f.reader(null, counting.db);
      counting.reset();
      const bundle = await runService(read.blocks([{ pageId: f.page.id }]));
      const queries = counting.count();
      counting.reset();
      await runService(read.markdown([{ pageId: f.page.id }]));
      const markdownQueries = counting.count();
      counting.reset();
      const structuredData = await runService(read.structuredData(bundle));
      return {
        queries,
        markdownQueries,
        structuredDataQueries: counting.count(),
        nodes: Object.values(structuredData.blocks).flat().length,
        blocks: bundle.blocks.length,
      };
    };

    const small = await queriesFor(1);
    const large = await queriesFor(6);
    expect(large.blocks).toBe(7);
    expect(large.queries).toBe(small.queries);
    expect(large.markdownQueries).toBe(small.markdownQueries);
    // A Product and a Question for each of the seven cards.
    expect(large.nodes).toBe(14);
    expect(large.structuredDataQueries).toBe(small.structuredDataQueries);
  });
});
