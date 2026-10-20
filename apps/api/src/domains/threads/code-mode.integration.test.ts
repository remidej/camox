import type { ThreadView } from "@camox/api-contract/threads";
import { abortAllDurableObjects } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  connectLiveThread,
  lastAnswer,
  said,
  signIn,
  type ThreadClient,
} from "../../../test/threads";
import { runService } from "../../lib/run-service";
import { member } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { blockProcedures } from "../blocks/routes";
import { pageProcedures } from "../pages/routes";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** A project whose Live website has a page per `pages` entry, each with a text block. */
async function websiteFixture(pages: Record<string, string>) {
  const base = await createProjectFixture(crypto.randomUUID());
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "text",
      title: "Text",
      description: "A paragraph",
      contentSchema: {
        type: "object",
        toMarkdown: ["{{body}}"],
        properties: { body: { type: "string", fieldType: "String" } },
      },
    }),
  );
  const options = { context: createRpcContext(base.db, base.memberUser) };
  for (const [pathSegment, body] of Object.entries(pages)) {
    const { page } = await callSeedingLive(
      pageProcedures.create,
      { projectId: base.project.id, pathSegment, layoutId: base.layout.layoutId },
      options,
    );
    await callSeedingLive(
      blockProcedures.create,
      { pageId: page.id, type: "text", content: { body } } as never,
      options,
    );
  }
  return base;
}

type Website = Awaited<ReturnType<typeof websiteFixture>>;

/** Opens the fixture member's Live thread, as their studio does. */
const openThread = async ({ db, memberUser, project }: Website) =>
  connectLiveThread(project.id, await signIn(db, memberUser.id));

/** Sends `text` in `thread`, returning what the thread shows once the agent's turn ended. */
async function ask(thread: ThreadClient, text: string): Promise<ThreadView> {
  thread.send({ type: "send", operationId: crypto.randomUUID(), text });
  await thread.until(() => !thread.view().running && thread.view().messages.length >= 2);
  thread.close();
  return thread.view();
}

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

  it("offers the model code mode alone, its scripts reaching the content tools", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text(ALL_TOOLS.map((tool) => tool.name).join(", "));`);
    let offered: string[] = [];
    answerFrom(({ offeredTools, scriptOutput }) => {
      offered = offeredTools;
      return scriptOutput;
    });

    const view = await ask(await openThread(website), "What can you read?");

    expect(offered).toEqual(["codemode"]);
    expect(lastAnswer(view)?.split(", ")).toEqual(expect.arrayContaining(["listPages", "getPage"]));
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

  it("gives scripts no way to call a model", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text(typeof models);`);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(await openThread(website), "Classify our pages");

    expect(lastAnswer(view)).toBe("undefined");
  });
});
