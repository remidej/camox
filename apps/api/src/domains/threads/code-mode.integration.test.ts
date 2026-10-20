import { abortAllDurableObjects } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { member } from "../../schema";

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
