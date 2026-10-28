import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";

// References and links resolve in the locale being rendered (ADR 0015): a localization keeps its
// original's id, so a German block's references lead to German records. A record excluded from a
// locale is missing there, like a deleted record; a page missing from a locale is linked in the
// default locale instead.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };
type Resolved = { id: string; title: string };

const articleSchema = {
  type: "object" as const,
  properties: { title: { type: "string", fieldType: "String" as const } },
  required: ["title"],
  additionalProperties: false as const,
};

/**
 * A project whose Live has, in the default locale, three articles and a page with a block
 * listing them three ways: a query-backed list by title, a manual list, and a required single
 * reference to `featured`. The page's block also links to a team page.
 */
async function fixture(titles: [string, string, string]) {
  const base = await createProjectFixture(`locale-references-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  const projectUuid = project.uuid;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  await syncDefinitionSet(db, project, {
    collections: [
      {
        collectionId: "articles",
        title: "Articles",
        description: "",
        toTitle: "{{title}}",
        toDescription: null,
        contentSchema: articleSchema,
      },
    ],
    blocks: [
      {
        blockId: "article-index",
        title: "Article index",
        description: "Articles",
        contentSchema: {
          type: "object",
          properties: {
            byTitle: {
              type: "array",
              items: { type: "string", format: "uuid" },
              fieldType: "ReferenceList",
              collectionId: "articles",
              title: "By title",
              query: { orderBy: { title: "asc" } },
              referenceSchema: articleSchema,
            },
            picks: {
              type: "array",
              items: { type: "string", format: "uuid" },
              fieldType: "ReferenceList",
              collectionId: "articles",
              title: "Picks",
              default: [],
            },
            featured: {
              fieldType: "Reference",
              collectionId: "articles",
              title: "Featured",
              required: true,
              anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
              default: null,
            },
            team: {
              fieldType: "Link",
              title: "Team",
              type: "object",
              properties: {
                type: { type: "string", enum: ["external", "page"] },
                text: { type: "string" },
                href: { type: "string" },
                pageId: { type: "string" },
              },
              default: { type: "external", text: "", href: "" },
            },
          },
          required: ["byTitle", "picks", "featured", "team"],
          toMarkdown: [],
        },
      },
    ],
  });

  const createPage = (pathSegment: string) =>
    callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId },
      member(),
    ).then(({ page }) => page);
  const team = await createPage("team");
  const page = await createPage("articles");
  const articles: { id: string }[] = [];
  for (const title of titles) {
    articles.push(
      await callSeedingLive(
        router.collectionDefinitions.createRecord,
        { projectUuid, collectionId: "articles", content: { title } },
        member(),
      ),
    );
  }
  const [first, second, third] = articles as [{ id: string }, { id: string }, { id: string }];
  const block = await callSeedingLive(
    router.blocks.create,
    {
      pageId: page.id,
      type: "article-index",
      content: {
        picks: [first.id, second.id, third.id],
        featured: second.id,
        team: { type: "page", text: "Team", pageId: team.id },
      },
    },
    member(),
  );
  // The draft the AI tools work in, which the first request starts: a new one once it's published.
  const newDraft = (): Headers => ({
    [DRAFT_HEADER]: generateUuidv7(),
    [DRAFT_CREATE_HEADER]: "1",
  });
  let current = newDraft();

  const tool = async (name: string, args: object = {}, headers = current) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  const publish = async () => {
    const { token } = await tool("previewPublish");
    // These tests don't run the translations adding a locale queues.
    expect(await tool("publishDraft", { token, publishAnyway: true })).toMatchObject({
      published: true,
    });
    current = newDraft();
  };
  const retitle = (record: { id: string }, title: string, locale: string) =>
    tool("editCollectionRecord", {
      collectionId: "articles",
      id: record.id,
      content: { title },
      locale,
    });
  const exclude = (record: { id: string }, locale: string) =>
    tool("deleteCollectionRecord", { collectionId: "articles", id: record.id, locale });

  /**
   * The titles the block's references resolve to in `locale`: for a member in the draft, or for
   * a visitor on Live.
   */
  const referencesIn = async (locale: string | undefined, reader: "member" | "visitor") => {
    const headers: Headers = locale ? { [LOCALE_HEADER]: locale } : {};
    const { block: read } = await call(
      router.blocks.get,
      { id: block.id },
      reader === "member"
        ? member({ ...current, ...headers })
        : { context: createRpcContext(db, null, headers) },
    );
    const references = read.references as Record<string, Resolved | Resolved[] | null>;
    const titles = (field: string) => (references[field] as Resolved[]).map(({ title }) => title);
    return {
      byTitle: titles("byTitle"),
      picks: titles("picks"),
      featured: (references.featured as Resolved | null)?.title ?? null,
    };
  };

  return {
    ...base,
    projectUuid,
    member,
    tool,
    publish,
    retitle,
    exclude,
    referencesIn,
    page,
    team,
    block,
    articles: [first, second, third] as const,
  };
}

describe("references per locale", () => {
  it("resolves a German page's references to German records, leaving out records excluded from German", async () => {
    const f = await fixture(["Apple", "Banana", "Cherry"]);
    const [apple, banana, cherry] = f.articles;
    await f.tool("addLocale", { tag: "de" });
    await f.retitle(apple, "Zitrone", "de");
    await f.retitle(banana, "Birne", "de");
    await f.retitle(cherry, "Aprikose", "de");
    await f.exclude(apple, "de");

    const german = {
      // Ordered by their German titles.
      byTitle: ["Aprikose", "Birne"],
      picks: ["Birne", "Aprikose"],
      featured: "Birne",
    };
    expect(await f.referencesIn("de", "member")).toEqual(german);
    // The default locale keeps every record.
    const original = {
      byTitle: ["Apple", "Banana", "Cherry"],
      picks: ["Apple", "Banana", "Cherry"],
      featured: "Banana",
    };
    expect(await f.referencesIn(undefined, "member")).toEqual(original);

    await f.publish();
    expect(await f.referencesIn("de", "visitor")).toEqual(german);
    expect(await f.referencesIn(undefined, "visitor")).toEqual(original);
  });

  it("sorts a query-backed list's text in the rendered locale's collation", async () => {
    // Swedish sorts Ö after Z, where English sorts it with O.
    const f = await fixture(["Zebra", "Ödla", "Apa"]);
    await f.tool("addLocale", { tag: "sv" });
    await f.publish();

    for (const reader of ["member", "visitor"] as const) {
      expect((await f.referencesIn("sv", reader)).byTitle).toEqual(["Apa", "Zebra", "Ödla"]);
      expect((await f.referencesIn(undefined, reader)).byTitle).toEqual(["Apa", "Ödla", "Zebra"]);
    }
  });
});

describe("publishing references and links per locale", () => {
  it("blocks publishing the exclusion of a record a required reference in the locale points at", async () => {
    const f = await fixture(["Apple", "Banana", "Cherry"]);
    const [apple, banana] = f.articles;
    await f.tool("addLocale", { tag: "de" });
    await f.publish();

    // Records only a list holds can leave the locale.
    await f.exclude(apple, "de");
    expect((await f.tool("previewPublish")).blockers).toEqual([]);

    await f.exclude(banana, "de");
    expect((await f.tool("previewPublish")).blockers).toEqual([
      expect.objectContaining({
        entity: "block",
        id: f.block.id,
        code: "danglingReference",
        field: "featured",
        locale: "de",
      }),
    ]);
  });

  it("doesn't block publishing a page's removal from a locale that links to it", async () => {
    const f = await fixture(["Apple", "Banana", "Cherry"]);
    await f.tool("addLocale", { tag: "de" });
    await f.publish();

    await f.tool("deletePage", { id: f.team.id, locale: "de" });

    expect((await f.tool("previewPublish")).blockers).toEqual([]);
    await f.publish();
  });
});
