import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  openDevelopmentDraft,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { upsertBlockDefinition } from "../block-definitions/service";
import { syncLayouts } from "../layouts/service";

// Adding and removing locales (ADR 0015), as an agent does through the AI tools in its
// development draft (ADR 0010), and as the studio does through the API.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };

const development: Headers = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };

/**
 * A project with, on Live in the default locale: a page with a block holding a repeatable item,
 * a synced navbar in the default layout, and a collection record.
 */
async function fixture() {
  const base = await createProjectFixture(`locales-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  const { slug: projectSlug, deployToken } = project;
  const release = createServiceContext(db, null);
  await runService(
    upsertBlockDefinition(release, {
      projectSlug,
      deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: {
          title: { type: "string", fieldType: "String" },
          link: {
            fieldType: "Link",
            title: "Link",
            type: "object",
            properties: {
              type: { type: "string", enum: ["external", "page"] },
              text: { type: "string" },
              href: { type: "string" },
              pageId: { type: "string" },
            },
            default: { type: "external", text: "", href: "" },
          },
          items: {
            type: "array",
            fieldType: "Repeater",
            items: {
              type: "object",
              properties: { label: { type: "string", fieldType: "String" } },
            },
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  await runService(
    upsertBlockDefinition(release, {
      projectSlug,
      deployToken,
      blockId: "navbar",
      title: "Navbar",
      description: "Navbar",
      synced: true,
      contentSchema: {
        type: "object",
        properties: { brand: { type: "string", fieldType: "String" } },
        toMarkdown: ["{{brand}}"],
      },
    }),
  );
  await runService(
    syncLayouts(release, {
      projectSlug,
      deployToken,
      autoCreate: false,
      layouts: [
        {
          layoutId: base.layout.layoutId,
          description: "Layout",
          blocks: [
            { type: "navbar", slot: "before", content: { brand: "Acme" }, repeatableItems: [] },
          ],
        },
      ],
    }),
  );
  await call(
    router.collectionDefinitions.sync,
    {
      projectSlug,
      deployToken,
      autoCreate: false,
      definitions: [
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
      ],
    },
    { context: createRpcContext(db, null) },
  );

  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const createPage = (pathSegment: string) =>
    callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId },
      member(),
    ).then(({ page }) => page);
  const page = await createPage("pricing");
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Hello", items: [{ label: "One" }] } },
    member(),
  );
  const record = await callSeedingLive(
    router.collectionDefinitions.createRecord,
    { projectSlug, collectionId: "articles", content: { title: "First" } },
    member(),
  );
  await openDevelopmentDraft(db, projectId, memberUser.id);

  const callTool = async (name: string, args: object = {}, headers = development) =>
    (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
  const tool = async (name: string, args: object = {}, headers = development) => {
    const response = await callTool(name, args, headers);
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  const errorOf = async (name: string, args: object = {}, headers = development) => {
    const response = await callTool(name, args, headers);
    if (response.ok) throw new Error(`${name} succeeded`);
    return response.error.code;
  };
  const tags = async (headers = development) =>
    ((await tool("listLocales", {}, headers)) as { tag: string }[]).map(({ tag }) => tag);
  const title = async (locale?: string, headers = development) =>
    (await tool("getBlock", { id: block.id, locale }, headers)).block.content.title;
  const blocksOn = async (locale?: string, headers = development) =>
    ((await tool("getPage", { id: page.id, locale }, headers)).blocks as { id: string }[]).map(
      ({ id }) => id,
    );
  const preview = (headers = development) => tool("previewPublish", {}, headers);
  const publish = async (headers = development) => {
    const { token } = await preview(headers);
    expect(await tool("publishDraft", { token }, headers)).toMatchObject({ published: true });
  };
  const layoutIn = async (locale?: string) =>
    tool("getLayout", { layoutId: base.layout.layoutId, locale });
  const navbar = (await layoutIn()).blocks[0] as { id: string };

  return {
    ...base,
    projectId,
    projectSlug,
    member,
    createPage,
    page,
    block,
    record,
    navbar,
    callTool,
    tool,
    errorOf,
    tags,
    title,
    blocksOn,
    preview,
    publish,
    layoutIn,
  };
}

describe("locales", () => {
  it("lists, adds and removes locales with the AI tools", async () => {
    const f = await fixture();
    expect(await f.tool("listLocales")).toEqual([{ tag: "en", isDefault: true }]);

    // Any BCP 47 tag, in its canonical form.
    expect(await f.tool("addLocale", { tag: "pt-br" })).toEqual({ tag: "pt-BR", isDefault: false });
    expect(await f.tool("addLocale", { tag: "de" })).toEqual({ tag: "de", isDefault: false });
    expect(await f.tags()).toEqual(["en", "pt-BR", "de"]);
    expect(await f.errorOf("addLocale", { tag: "DE" })).toBe("CONFLICT");
    expect(await f.errorOf("addLocale", { tag: "not a tag" })).toBe("BAD_REQUEST");

    expect(await f.errorOf("removeLocale", { tag: "en" })).toBe("BAD_REQUEST");
    expect(await f.tool("removeLocale", { tag: "PT-BR" })).toEqual({
      tag: "pt-BR",
      isDefault: false,
    });
    expect(await f.tags()).toEqual(["en", "de"]);
    expect(await f.errorOf("removeLocale", { tag: "pt-BR" })).toBe("NOT_FOUND");
    // Nothing of a locale the draft added is left once it removes it.
    const { changes } = await f.preview();
    expect(changes.filter((change: { locale: string }) => change.locale === "pt-BR")).toEqual([]);

    // A locale exists only in the drafts that add it until one publishes.
    expect(await f.tags({})).toEqual(["en"]);
  });

  it("gives every page, block, item, synced block's shared content and record a localization keeping its original's id", async () => {
    const f = await fixture();
    const item = (await f.tool("getBlock", { id: f.block.id })).repeatableItems[0];

    await f.tool("addLocale", { tag: "de" });

    const german = await f.tool("getPage", { path: "/pricing", locale: "de" });
    expect(german.page).toMatchObject({ id: f.page.id, locale: "de", fullPath: "/pricing" });
    expect(german.blocks.map((block: { id: string }) => block.id)).toEqual([f.block.id]);
    const block = await f.tool("getBlock", { id: f.block.id, locale: "de" });
    expect(block.block).toMatchObject({ locale: "de", content: { title: "Hello" } });
    expect(block.repeatableItems).toEqual([
      expect.objectContaining({ id: item.id, locale: "de", content: { label: "One" } }),
    ]);
    expect((await f.layoutIn("de")).blocks).toEqual([
      expect.objectContaining({ id: f.navbar.id, locale: "de", content: { brand: "Acme" } }),
    ]);
    expect(
      await f.tool("getCollectionRecord", {
        collectionId: "articles",
        id: f.record.id,
        locale: "de",
      }),
    ).toMatchObject({ id: f.record.id, content: { title: "First" } });

    // The draft's review lists the locale it adds, not the localizations Camox copied into it.
    const { changes } = await f.preview();
    expect(changes).toEqual([
      expect.objectContaining({ entity: "locale", label: "de", change: "created" }),
    ]);
  });

  it("reads and writes the locale a request names, and the default locale without one", async () => {
    const f = await fixture();
    await f.tool("addLocale", { tag: "de" });

    await f.tool("editBlock", { id: f.block.id, content: { title: "Hallo" }, locale: "de" });
    await f.tool("editBlock", { id: f.navbar.id, content: { brand: "Acme GmbH" }, locale: "de" });
    await f.tool("editCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      content: { title: "Erster" },
      locale: "de",
    });
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hi" } });

    expect(await f.title("de")).toBe("Hallo");
    expect(await f.title()).toBe("Hi");
    expect((await f.layoutIn("de")).blocks[0].content).toEqual({ brand: "Acme GmbH" });
    expect((await f.layoutIn()).blocks[0].content).toEqual({ brand: "Acme" });
    const recordIn = async (locale?: string) =>
      (
        await f.tool("getCollectionRecord", {
          collectionId: "articles",
          id: f.record.id,
          locale,
        })
      ).content.title;
    expect(await recordIn("de")).toBe("Erster");
    expect(await recordIn()).toBe("First");

    // Markdown representations are per locale.
    const markdownIn = async (locale?: string) =>
      (await f.tool("getPage", { id: f.page.id, locale })).blocks[0].markdown;
    expect(await markdownIn("de")).toContain("# Hallo");
    expect(await markdownIn()).toContain("# Hi");

    // The API reads the locale a request names in its header.
    const { block } = await call(
      router.blocks.get,
      { id: f.block.id },
      f.member({ ...development, [LOCALE_HEADER]: "de" }),
    );
    expect(block.content).toMatchObject({ title: "Hallo" });

    // A locale the draft doesn't have is missing.
    expect(await f.errorOf("getBlock", { id: f.block.id, locale: "fr" })).toBe("NOT_FOUND");
  });

  it("publishes a locale to Live, and publishing its removal deletes its content from Live for good", async () => {
    const f = await fixture();
    await f.tool("addLocale", { tag: "de" });
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hallo" }, locale: "de" });
    // A block only the German page has.
    const german = await f.tool("createBlock", {
      pageId: f.page.id,
      type: "hero",
      content: { title: "Nur auf Deutsch" },
      locale: "de",
    });
    await f.publish();

    expect(await f.tags({})).toEqual(["en", "de"]);
    const other = generateUuidv7();
    const inOther = { [DRAFT_HEADER]: other, [DRAFT_CREATE_HEADER]: "1" };
    expect(await f.title("de", inOther)).toBe("Hallo");
    expect(await f.blocksOn("de", inOther)).toEqual([f.block.id, german.id]);
    expect(await f.blocksOn(undefined, inOther)).toEqual([f.block.id]);

    await f.tool("removeLocale", { tag: "de" });
    // Removing a locale is one change, whatever it holds.
    const { changes } = await f.preview();
    expect(changes).toEqual([
      expect.objectContaining({ entity: "locale", change: "deleted", locale: null }),
    ]);
    await f.publish();
    expect(await f.tags({})).toEqual(["en"]);

    // Adding it again starts from the default locale: nothing of the old German content is left.
    await f.tool("addLocale", { tag: "de" });
    expect(await f.blocksOn("de")).toEqual([f.block.id]);
    expect(await f.title("de")).toBe("Hello");
  });

  it("adding back a Live locale the draft removed keeps Live's content in it", async () => {
    const f = await fixture();
    await f.tool("addLocale", { tag: "de" });
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hallo" }, locale: "de" });
    await f.publish();

    await f.tool("removeLocale", { tag: "de" });
    await f.tool("addLocale", { tag: "de" });

    expect(await f.title("de")).toBe("Hallo");
    expect((await f.preview()).changes).toEqual([]);
  });

  it("blocks publishing on a path used twice in one locale, but not on the same path in two locales", async () => {
    const f = await fixture();
    const about = await f.createPage("about");
    await f.tool("addLocale", { tag: "de" });
    expect((await f.preview()).blockers).toEqual([]);

    await f.tool("updatePage", { id: f.page.id, pathSegment: "about", locale: "de" });

    // Both German pages are new in the draft, and only they share a path.
    const { blockers } = await f.preview();
    expect(blockers).toEqual(
      expect.arrayContaining(
        [f.page.id, about.id].map((id) =>
          expect.objectContaining({ code: "duplicatePath", id, locale: "de" }),
        ),
      ),
    );
    expect(blockers).toHaveLength(2);
  });

  it("doesn't block publishing a link to a page missing from the localization's locale", async () => {
    const f = await fixture();
    await f.tool("addLocale", { tag: "de" });
    // A page the default locale gains after German was added.
    const { page: team } = await f.tool("createPage", {
      pathSegment: "team",
      layoutId: f.layout.layoutId,
    });

    await f.tool("editBlock", {
      id: f.block.id,
      content: { link: { type: "page", text: "Team", pageId: team.id } },
      locale: "de",
    });

    expect((await f.preview()).blockers).toEqual([]);
  });

  it("blocks publishing a locale whose prefix is a top-level page path in the default locale", async () => {
    const f = await fixture();
    await f.createPage("pt-br");

    await f.tool("addLocale", { tag: "fr" });
    expect((await f.preview()).blockers).toEqual([]);

    const added = await f.tool("addLocale", { tag: "pt-BR" });
    expect(added.tag).toBe("pt-BR");
    expect((await f.preview()).blockers).toEqual([
      expect.objectContaining({ entity: "locale", code: "localePrefixTaken", locale: null }),
    ]);
  });

  it("blocks publishing a locale another draft published since this one added it", async () => {
    const f = await fixture();
    const other = generateUuidv7();
    await f.tool("addLocale", { tag: "de" }, { [DRAFT_HEADER]: other, [DRAFT_CREATE_HEADER]: "1" });
    await f.tool("addLocale", { tag: "de" });
    await f.tool(
      "editBlock",
      { id: f.block.id, content: { title: "Hallo" }, locale: "de" },
      {
        [DRAFT_HEADER]: other,
      },
    );
    await f.publish({ [DRAFT_HEADER]: other });

    expect((await f.preview()).blockers).toEqual([
      expect.objectContaining({ entity: "locale", code: "duplicateLocale" }),
    ]);

    // Removing its own leaves the draft reading Live's.
    await f.tool("removeLocale", { tag: "de" });
    expect(await f.tags()).toEqual(["en", "de"]);
    expect(await f.title("de")).toBe("Hallo");
    expect((await f.preview()).changes).toEqual([]);
  });

  it("corrects the default locale's tag while it's the only locale, and refuses once another exists", async () => {
    const f = await fixture();

    expect(await f.tool("setDefaultLocaleTag", { tag: "en-gb" })).toEqual({
      tag: "en-GB",
      isDefault: true,
    });
    expect(await f.tags({})).toEqual(["en-GB"]);
    expect(await f.title()).toBe("Hello");
    expect(await f.title("en-GB", {})).toBe("Hello");

    // Another locale in a draft is enough to refuse it.
    await f.tool("addLocale", { tag: "de" });
    expect(await f.errorOf("setDefaultLocaleTag", { tag: "en-US" })).toBe("BAD_REQUEST");
    expect(await f.tags({})).toEqual(["en-GB"]);
  });

  it("serves Live's content in any of Live's locales to visitors, and nothing in a locale only a draft has", async () => {
    const f = await fixture();
    const inGerman = { ...development, [LOCALE_HEADER]: "de" };
    await f.tool("addLocale", { tag: "de" });
    await call(router.pages.update, { id: f.page.id, pathSegment: "preise" }, f.member(inGerman));
    await f.tool("editBlock", { id: f.block.id, content: { title: "Hallo" }, locale: "de" });
    await f.tool("editBlock", { id: f.navbar.id, content: { brand: "Acme GmbH" }, locale: "de" });
    await f.tool("editCollectionRecord", {
      collectionId: "articles",
      id: f.record.id,
      content: { title: "Erster" },
      locale: "de",
    });
    await f.publish();

    const visitor = (locale?: string) => ({
      context: createRpcContext(f.db, null, locale ? { [LOCALE_HEADER]: locale } : {}),
    });
    const pageAt = (path: string, locale?: string) =>
      call(router.pages.getByPath, { projectSlug: f.projectSlug, path }, visitor(locale));

    expect(await call(router.locales.list, { projectSlug: f.projectSlug }, visitor())).toEqual([
      { tag: "en", isDefault: true },
      { tag: "de", isDefault: false },
    ]);
    const german = await pageAt("/preise", "de");
    expect(german.page).toMatchObject({ id: f.page.id, locale: "de", fullPath: "/preise" });
    // The page's blocks, then its layout's.
    expect(german.blocks.map((block) => block.content)).toEqual([
      expect.objectContaining({ title: "Hallo" }),
      { brand: "Acme GmbH" },
    ]);
    const original = await pageAt("/pricing");
    expect(original.blocks.map((block) => block.content)).toEqual([
      expect.objectContaining({ title: "Hello" }),
      { brand: "Acme" },
    ]);
    // A path names a page in its own locale only.
    await expect(pageAt("/pricing", "de")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pageAt("/preise")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const layout = await call(
      router.layouts.get,
      { projectSlug: f.projectSlug, layoutId: f.layout.layoutId },
      visitor("de"),
    );
    expect(layout.blocks.map((block) => block.content)).toEqual([{ brand: "Acme GmbH" }]);
    const recordsTitled = (value: string, locale?: string) =>
      call(
        router.collectionDefinitions.findRecordsByField,
        { projectSlug: f.projectSlug, collectionId: "articles", field: "title", value },
        visitor(locale),
      ).then((records) => records.map(({ id }) => id));
    expect(await recordsTitled("Erster", "de")).toEqual([f.record.id]);
    expect(await recordsTitled("First", "de")).toEqual([]);
    expect(await recordsTitled("First")).toEqual([f.record.id]);

    // A locale a draft adds stays out of Live until it's published.
    await f.tool("addLocale", { tag: "fr" });
    await expect(pageAt("/pricing", "fr")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await call(router.locales.list, { projectSlug: f.projectSlug }, visitor())).toEqual([
      { tag: "en", isDefault: true },
      { tag: "de", isDefault: false },
    ]);
    expect(
      await call(router.locales.list, { projectSlug: f.projectSlug }, f.member(development)),
    ).toEqual([
      { tag: "en", isDefault: true },
      { tag: "de", isDefault: false },
      { tag: "fr", isDefault: false },
    ]);
  });
});
