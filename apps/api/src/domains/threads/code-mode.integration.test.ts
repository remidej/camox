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
import { connectLiveThread, signIn } from "../../../test/threads";
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

/** A script finding the pages whose blocks mention `needle`, printing their paths. */
const pagesMentioning = (needle: string) => `
  const pages = await tools.listPages({});
  const found = [];
  for (const { id } of pages) {
    const { page, blocks } = await tools.getPage({ id });
    if (blocks.some((block) => block.markdown.includes(${JSON.stringify(needle)}))) {
      found.push(page.fullPath);
    }
  }
  text(found.join(", "));
`;

const question = (text: string) => ({
  type: "send" as const,
  operationId: crypto.randomUUID(),
  text,
});

describe("the agent reading the website through code mode", () => {
  it("answers a question about the website from a script reading its pages", async () => {
    const { db, memberUser, project } = await websiteFixture({
      pricing: "Plans start at $9 a month.",
      about: "We build websites.",
      faq: "Is it still $9? Yes, $9 a month.",
    });
    answerWithScript(pagesMentioning("$9"));
    answerFrom(({ lastToolResult }) => `Pages mentioning it: ${lastToolResult}`);
    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));

    thread.send(question("Which pages mention our old pricing of $9?"));
    await thread.until(() => !thread.view().working && thread.view().messages.length === 2);

    const answer = thread.view().messages.at(-1);
    expect(answer).toMatchObject({ from: "agent" });
    expect(answer?.text).toContain("/pricing");
    expect(answer?.text).toContain("/faq");
    expect(answer?.text).not.toContain("/about");
    thread.close();
  });

  it("offers the model code mode alone, its scripts reaching the content tools", async () => {
    const { db, memberUser, project } = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text(ALL_TOOLS.map((tool) => tool.name).join(", "));`);
    let offered: string[] = [];
    answerFrom(({ offeredTools, lastToolResult }) => {
      offered = offeredTools;
      return lastToolResult;
    });
    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));

    thread.send(question("What can you read?"));
    await thread.until(() => !thread.view().working && thread.view().messages.length === 2);

    expect(offered).toEqual(["codemode"]);
    expect(thread.view().messages.at(-1)?.text).toContain("listPages");
    thread.close();
  });

  it("shows only the turn's final message, not what the agent writes between scripts", async () => {
    const { db, memberUser, project } = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text((await tools.listPages({})).length);`, {
      text: "Let me count your pages first.",
    });
    answerWithScript(pagesMentioning("$9"), { text: "Now let me look for the price." });
    answerNext("It's on your pricing page.");
    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));

    thread.send(question("Where's our price?"));
    await thread.until(() => !thread.view().working && thread.view().messages.length >= 2);

    expect(thread.view().messages.map(({ from, text }) => ({ from, text }))).toEqual([
      { from: "editor", text: "Where's our price?" },
      { from: "agent", text: "It's on your pricing page." },
    ]);
    thread.close();
  });

  it("stops reading for an editor removed from the project mid-thread", async () => {
    const { db, memberUser, project } = await websiteFixture({ pricing: "Plans start at $9." });
    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    await db.delete(member).where(eq(member.userId, memberUser.id));
    answerWithScript(`
      try {
        text(JSON.stringify(await tools.listPages({})));
      } catch (error) {
        text(error.message);
      }
    `);
    answerFrom(({ lastToolResult }) => lastToolResult);

    thread.send(question("Which pages do we have?"));
    await thread.until(() => !thread.view().working && thread.view().messages.length === 2);

    const answer = thread.view().messages.at(-1)?.text;
    expect(answer).toContain('"code":"FORBIDDEN"');
    expect(answer).not.toContain("/pricing");
    thread.close();
  });

  it("gives scripts no way to call a model", async () => {
    const { db, memberUser, project } = await websiteFixture({ pricing: "Plans start at $9." });
    answerWithScript(`text(typeof models);`);
    answerFrom(({ lastToolResult }) => lastToolResult);
    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));

    thread.send(question("Classify our pages"));
    await thread.until(() => !thread.view().working && thread.view().messages.length === 2);

    expect(thread.view().messages.at(-1)?.text).toContain("undefined");
    thread.close();
  });
});
