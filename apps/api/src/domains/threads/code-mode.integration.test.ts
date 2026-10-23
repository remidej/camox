import { abortAllDurableObjects } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callSeedingLive, createRpcContext, syncDefinitionSet } from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectLiveThread,
  lastAnswer,
  said,
  signIn,
  textDefinition,
  touchedOf,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";
import { blocks, member, pages } from "../../schema";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** Opens the fixture member's Live thread, as their studio does. */
const openThread = async ({ db, memberUser, project }: Website) =>
  connectLiveThread(project.id, await signIn(db, memberUser.id));

/** A script printing the paths of the pages whose blocks mention `needle`, in order. */
const pagesMentioning = (needle: string) => `
  const pages = await tools.listPages({});
  const found = [];
  for (const { id } of pages) {
    const { page, blocks } = await tools.getPage({ id });
    if (blocks.some((block) => block.markdown.includes(${JSON.stringify(needle)}))) {
      found.push(page.fullPath);
    }
  }
  text(found.sort().join(", "));
`;

describe("the agent reading the website through code mode", () => {
  it("answers a question about the website from a script reading its pages", async () => {
    const website = await websiteFixture({
      pricing: "Plans start at $9 a month.",
      about: "We build websites.",
      faq: "Is it still $9? Yes, $9 a month.",
    });
    answerWithScript(pagesMentioning("$9"));
    answerFrom(({ scriptOutput }) => `Pages mentioning it: ${scriptOutput}`);

    const view = await ask(await openThread(website), "Which pages mention our old pricing of $9?");

    expect(view.messages.at(-1)).toMatchObject({
      from: "agent",
      text: "Pages mentioning it: /faq, /pricing",
    });
  });

  it("offers the model code mode, the web and code tools, its scripts reaching the content tools", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text(ALL_TOOLS.map((tool) => tool.name).join(", "));`);
    let offered: string[] = [];
    answerFrom(({ offeredTools, scriptOutput }) => {
      offered = offeredTools;
      return scriptOutput;
    });

    const view = await ask(await openThread(website), "What can you read?");

    expect(offered.toSorted()).toEqual([
      "codemode",
      "edit",
      "find",
      "grep",
      "ls",
      "mv",
      "read",
      "rm",
      "web_fetch",
      "web_search",
      "write",
    ]);
    const scriptTools = lastAnswer(view)?.split(", ");
    expect(scriptTools).toEqual(
      expect.arrayContaining(["listPages", "getPage", "read", "grep", "write", "mv"]),
    );
    expect(scriptTools).not.toEqual(expect.arrayContaining(["web_fetch"]));
    expect(scriptTools).not.toEqual(expect.arrayContaining(["web_search"]));
  });

  it("shows only the turn's final message, not what the agent writes between scripts", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text((await tools.listPages({})).length);`, {
      text: "Let me count your pages first.",
    });
    answerWithScript(pagesMentioning("$9"), { text: "Now let me look for the price." });
    answerNext("It's on your pricing page.");

    const view = await ask(await openThread(website), "Where's our price?");

    expect(said(view)).toEqual([
      { from: "editor", text: "Where's our price?" },
      { from: "agent", text: "It's on your pricing page." },
    ]);
  });

  it("stops reading for an editor removed from the project mid-thread", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const thread = await openThread(website);
    await website.db.delete(member).where(eq(member.userId, website.memberUser.id));
    answerWithScript(`
      try {
        text(JSON.stringify(await tools.listPages({})));
      } catch (error) {
        text(error.message);
      }
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Which pages do we have?");

    expect(JSON.parse(lastAnswer(view)!)).toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports once what a script's writes touched, in write order, when it ends", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const thread = await openThread(website);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      const price = pricing.blocks[0].id;
      await tools.editBlock({ id: price, content: { body: "Plans start at $12." } });
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      const intro = await tools.createBlock({ pageId: page.id, type: "text", content: { body: "Hi" } });
      await tools.moveBlock({ id: price, position: "first" });
      text(JSON.stringify({ pricing: pricing.page.id, price, launch: page.id, intro: intro.id }));
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);
    const operationId = crypto.randomUUID();

    const view = await ask(thread, "Raise the price, and add a launch page", {
      keepOpen: true,
      operationId,
    });

    const ids = JSON.parse(lastAnswer(view)!);
    expect(touchedOf(thread)).toEqual([
      {
        operationIds: [operationId],
        touches: [
          { entity: "page", pageId: ids.pricing, blockId: ids.price, kind: "edited", locale: "en" },
          { entity: "page", pageId: ids.launch, kind: "created", locale: "en" },
          { entity: "page", pageId: ids.launch, blockId: ids.intro, kind: "created", locale: "en" },
          { entity: "page", pageId: ids.pricing, blockId: ids.price, kind: "moved", locale: "en" },
        ],
      },
    ]);
    thread.close();
  });

  it("reports the writes a failing script made before it failed", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const thread = await openThread(website);
    answerWithScript(`
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      text(page.id);
      await tools.editBlock({ id: page.id, content: { body: "Not a block" } }).catch(() => {});
      throw new Error("Something went wrong");
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Add a launch page", { keepOpen: true });

    const launch = lastAnswer(view)?.split("\n")[0];
    expect(touchedOf(thread).map(({ touches }) => touches)).toEqual([
      [{ entity: "page", pageId: launch, kind: "created", locale: "en" }],
    ]);
    thread.close();
  });

  it("reports a page's settings and deletions apart from its content", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9.", about: "Us." });
    const thread = await openThread(website);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      const about = await tools.getPage({ path: "/about" });
      await tools.updatePage({ id: pricing.page.id, nickname: "Plans" });
      await tools.setPageSeo({ path: "/pricing", metaTitle: "Plans" });
      await tools.deleteBlock({ id: pricing.blocks[0].id });
      await tools.deletePage({ id: about.page.id });
      text(JSON.stringify({ pricing: pricing.page.id, price: pricing.blocks[0].id, about: about.page.id }));
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Tidy up", { keepOpen: true });

    const ids = JSON.parse(lastAnswer(view)!);
    expect(touchedOf(thread).map(({ touches }) => touches)).toEqual([
      [
        { entity: "page", pageId: ids.pricing, kind: "settings", locale: "en" },
        { entity: "page", pageId: ids.pricing, kind: "settings", locale: "en" },
        { entity: "page", pageId: ids.pricing, blockId: ids.price, kind: "deleted", locale: "en" },
        { entity: "page", pageId: ids.about, kind: "deleted", locale: "en" },
      ],
    ]);
    thread.close();
  });

  it("reports a Synced Block's shared content by its block type", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    await syncDefinitionSet(website.db, website.project, {
      blocks: [
        textDefinition,
        {
          blockId: "navbar",
          title: "Navbar",
          description: "Navigation",
          synced: true,
          contentSchema: {
            type: "object",
            properties: { title: { fieldType: "String", type: "string" } },
            toMarkdown: ["# {{title}}"],
          },
        },
      ],
    });
    const pricing = await website.db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, website.project.id), eq(pages.fullPath, "/pricing")))
      .get();
    const navbar = await callSeedingLive(
      router.blocks.create,
      { pageId: pricing!.id, type: "navbar", content: { title: "Acme" } } as never,
      { context: createRpcContext(website.db, website.memberUser) },
    );
    const thread = await openThread(website);
    answerWithScript(
      `await tools.editBlock({ id: ${JSON.stringify(navbar.id)}, content: { title: "Acme Inc" } });`,
    );
    answerNext("Renamed the navbar's title.");

    await ask(thread, "Rename us in the navbar", { keepOpen: true });

    expect(touchedOf(thread).map(({ touches }) => touches)).toEqual([
      [{ entity: "synced-block", blockType: "navbar", kind: "edited", locale: "en" }],
    ]);
    thread.close();
  });

  it("reports a Layout's block by its Layout", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const now = Date.now();
    const footer = await website.db
      .insert(blocks)
      .values({
        projectId: website.project.id,
        layoutId: website.layout.layoutId,
        type: "text",
        slot: "after",
        content: { body: "© Acme" },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const thread = await openThread(website);
    answerWithScript(`
      const layout = await tools.getLayout({ layoutId: "default" });
      await tools.editBlock({ id: layout.blocks[0].id, content: { body: "© Acme Inc" } });
    `);
    answerNext("Updated the footer.");

    await ask(thread, "Rename us in the footer", { keepOpen: true });

    expect(touchedOf(thread).map(({ touches }) => touches)).toEqual([
      [
        {
          entity: "layout",
          layoutId: website.layout.layoutId,
          blockId: footer.id,
          kind: "edited",
          locale: "en",
        },
      ],
    ]);
    thread.close();
  });

  it("reports nothing touched for a script that only reads", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const thread = await openThread(website);
    answerWithScript(pagesMentioning("$9"));
    answerFrom(({ scriptOutput }) => scriptOutput);

    await ask(thread, "Which pages mention $9?", { keepOpen: true });

    expect(touchedOf(thread)).toEqual([]);
    thread.close();
  });

  it("gives scripts no way to call a model", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text(typeof models);`);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(await openThread(website), "Classify our pages");

    expect(lastAnswer(view)).toBe("undefined");
  });
});
