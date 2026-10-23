import { LOCALE_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext, seedLive } from "../../../test/fixtures";
import { roundTripDb } from "../../../test/round-trips";
import { router } from "../../router";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  files,
  locales,
  pages,
  repeatableItems,
  sharedContentId,
  sharedContents,
} from "../../schema";

// A website reads its pages from the API on every visit, and each D1 round trip costs tens of
// milliseconds. The reads a page needs wait only on the reads they depend on: whatever runs
// beside them shares their round trip.

const now = 1_700_000_000_000;
const string = (fallback = "") => ({ type: "string", fieldType: "String", default: fallback });
const image = { type: "object", fieldType: "Image" };
const person = { fieldType: "Reference", collectionId: "people", default: null };
const cardSchema = {
  type: "object",
  properties: {
    title: string("Untitled"),
    photo: image,
    author: person,
    link: { type: "object", fieldType: "Link" },
    cards: {
      type: "array",
      fieldType: "Repeater",
      items: {
        type: "object",
        properties: { label: string("Card"), picture: image, who: person },
      },
    },
  },
  toMarkdown: ["# {{title}}", "{{author.name}}"],
  toStructuredData: { "@type": "Product", name: "{{title}}", image: "{{photo}}", url: "{{link}}" },
};

/**
 * A project in English and French whose English home page holds everything a page read
 * resolves: cards with items, a synced banner, a layout block, files, references two hops deep
 * (an author and the author's mentor), and links to another page.
 */
async function fixture() {
  const base = await createProjectFixture(`public-reads-${crypto.randomUUID()}`);
  const { db, project, layout } = base;
  await seedLive(db, locales, { projectId: project.id, tag: "fr", createdAt: now, updatedAt: now });
  await db.insert(blockDefinitions).values(
    ["card", "banner", "header"].map((blockId) => ({
      projectId: project.id,
      blockId,
      title: blockId,
      description: "",
      contentSchema: cardSchema,
      synced: blockId === "banner",
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
    contentSchema: {
      type: "object",
      properties: { name: string(), avatar: image, mentor: person },
    },
    schemaHash: "people",
  });
  const page = (segment: string) =>
    seedLive(db, pages, {
      projectId: project.id,
      layoutId: layout.layoutId,
      pathSegment: segment,
      fullPath: `/${segment}`,
      nickname: segment,
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  const home = await page("home");
  const linked = await page("linked");
  const file = (name: string) =>
    seedLive(db, files, {
      projectId: project.id,
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
  const personRecord = async (name: string, mentor: string | null) =>
    seedLive(db, collectionRecords, {
      projectId: project.id,
      collectionId: "people",
      content: { name, avatar: { _fileId: (await file(`${name}.png`)).id }, mentor },
      createdAt: now,
      updatedAt: now,
    });
  const author = await personRecord("Author", (await personRecord("Mentor", null)).id);
  await seedLive(db, sharedContents, {
    id: sharedContentId({ projectId: project.id, type: "banner" }),
    projectId: project.id,
    type: "banner",
    content: { title: "Shared", author: author.id },
    createdAt: now,
    updatedAt: now,
  });
  let position = 0;
  const block = (values: Record<string, unknown>) =>
    seedLive(db, blocks, {
      projectId: project.id,
      position: `a${position++}`,
      createdAt: now,
      updatedAt: now,
      ...values,
    } as never);
  /** Adds cards to the home page, each with its photo and two items with their pictures. */
  const addCards = async (count: number) => {
    for (let index = 0; index < count; index++) {
      const card = await block({
        pageId: home.id,
        type: "card",
        content: {
          title: `Card ${position}`,
          photo: { _fileId: (await file(`photo-${position}.png`)).id },
          author: author.id,
          link: { type: "page", pageId: linked.id, text: "Read", newTab: false },
        },
      });
      for (let item = 0; item < 2; item++) {
        await seedLive(db, repeatableItems, {
          blockId: card.id,
          fieldName: "cards",
          content: {
            label: `Item ${item}`,
            picture: { _fileId: (await file(`picture-${position}.png`)).id },
            who: author.id,
          },
          position: `a${position++}`,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  };
  await addCards(1);
  await block({ pageId: home.id, type: "banner", content: {} });
  await block({ layoutId: layout.layoutId, slot: "before", type: "header", content: {} });

  const counting = roundTripDb();
  /** Runs a public read as a visitor does, and what it cost. */
  const read = async (run: (context: ReturnType<typeof createRpcContext>) => Promise<unknown>) => {
    const context = (headers: Record<string, string> = {}) =>
      createRpcContext(counting.db, null, headers);
    counting.reset();
    const result = await run(context()).catch((error: unknown) => error);
    return { result, roundTrips: counting.roundTrips(), rounds: counting.rounds() };
  };
  const inLocale = (tag: string) => createRpcContext(counting.db, null, { [LOCALE_HEADER]: tag });
  return { ...base, home, addCards, counting, read, inLocale, projectUuid: project.uuid };
}

/** What a full page read waits on, one after another. */
const PAGE_READ = [
  "the project",
  "the page, with its layout",
  "the page's SEO, its blocks with their items and shared content, and the definitions",
  "the summaries, and the records the blocks reference",
  "the records those records reference",
  "the files the content and the records place",
  "the pages the Structured Data links",
];

/** What a page's Markdown waits on: no summaries, nor Structured Data. */
const MARKDOWN_READ = [
  "the project, with its locales: the path's prefix names the locale",
  "the page, with its layout",
  "the page's SEO, its blocks with their items and shared content, and the definitions",
  "the records the blocks reference",
  "the records those records reference",
  "the files the content and the records place",
];

describe("a website's page reads", () => {
  it("wait on D1 only for the reads they depend on", async () => {
    const f = await fixture();
    const { projectUuid } = f;

    const page = await f.read((context) =>
      call(router.pages.getByPath, { projectUuid, path: "/home" }, { context }),
    );
    expect(page.result).toMatchObject({ page: { id: f.home.id } });
    expect(page.roundTrips, JSON.stringify(page.rounds)).toBe(PAGE_READ.length);

    const markdown = await f.read((context) =>
      call(router.pages.getMarkdown, { projectUuid, path: "/home" }, { context }),
    );
    expect(markdown.result).toMatchObject({ page: { id: f.home.id } });
    expect((markdown.result as { markdown: string }).markdown).toContain("Author");
    expect(markdown.roundTrips, JSON.stringify(markdown.rounds)).toBe(MARKDOWN_READ.length);

    // The locales are read with the project.
    const listed = await f.read((context) =>
      call(router.locales.list, { projectUuid }, { context }),
    );
    expect(listed.result).toEqual([
      { tag: "en", isDefault: true },
      { tag: "fr", isDefault: false },
    ]);
    expect(listed.roundTrips).toBe(1);
  });

  it("read as many round trips whatever the page holds", async () => {
    const f = await fixture();
    const input = { projectUuid: f.projectUuid, path: "/home" };
    const roundTrips = async () => ({
      page: (await f.read((context) => call(router.pages.getByPath, input, { context })))
        .roundTrips,
      markdown: (await f.read((context) => call(router.pages.getMarkdown, input, { context })))
        .roundTrips,
    });
    const small = await roundTrips();
    // Enough blocks, items and files that reading their summaries or their files takes more than
    // one query each.
    await f.addCards(32);
    expect(await roundTrips()).toEqual(small);
  });

  it("find the locale a request names along with the project", async () => {
    const f = await fixture();
    const { projectUuid } = f;
    // No page in either locale: the read ends once the page lookup finds none.
    const missing = (context: ReturnType<typeof createRpcContext>) =>
      call(router.pages.getByPath, { projectUuid, path: "/missing" }, { context });
    const inDefault = await f.read(missing);
    const inFrench = await f.read(() => missing(f.inLocale("fr")));
    expect(inFrench.result).toMatchObject({ code: "NOT_FOUND" });
    expect(inFrench.roundTrips).toBe(inDefault.roundTrips);

    // The Markdown read finds the locale in the path, in the same round trip.
    const french = await f.read((context) =>
      call(router.pages.getMarkdown, { projectUuid, path: "/fr/missing" }, { context }),
    );
    expect(french.result).toMatchObject({
      locale: { tag: "fr", isDefault: false },
      path: "/missing",
      page: null,
    });
    expect(french.roundTrips).toBe(inDefault.roundTrips);
  });
});
