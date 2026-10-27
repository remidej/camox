import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { queryKeys } from "@camox/api-contract/query-keys";
import { abortAllDurableObjects } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addMember,
  createProjectFixture,
  openDevelopmentDraft,
  startDraft,
} from "../../../test/fixtures";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  lastAnswer,
  NOTHING_STORED,
  pagesOf,
  requestDraftThread,
  said,
  signIn,
  storedThreadOf,
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

describe("a draft's thread", () => {
  it("is shared by the members in the draft, showing who sent each message", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const teammate = await addMember(db, project.organizationId);
    const draftId = await startDraft(db, project.id, memberUser.id);
    answerNext("On it.");
    answerNext("Done too.");

    const own = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    const theirs = await connectDraftThread(project.id, draftId, await signIn(db, teammate.id));
    own.send({ type: "send", operationId: crypto.randomUUID(), text: "Rewrite the intro" });
    await theirs.untilIdle(2);
    theirs.send({ type: "send", operationId: crypto.randomUUID(), text: "And the outro" });
    for (const thread of [own, theirs]) {
      await thread.untilIdle(4);
    }

    const shown = own
      .view()
      .messages.map((message) =>
        message.from === "editor"
          ? { sender: message.sender.name, text: message.text }
          : message.from === "agent"
            ? { agent: message.text }
            : { from: message.from },
      );
    expect(shown).toEqual([
      { sender: memberUser.name, text: "Rewrite the intro" },
      { agent: "On it." },
      { sender: teammate.name, text: "And the outro" },
      { agent: "Done too." },
    ]);
    expect(theirs.view().messages).toEqual(own.view().messages);
    own.close();
    theirs.close();
  });

  it("only starts once someone messages it, reaching every member who opened the draft", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const teammate = await addMember(db, project.organizationId);
    const draftId = await startDraft(db, project.id, memberUser.id);
    const glance = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    glance.close();
    expect(await storedThreadOf(db, draftId)).toEqual(NOTHING_STORED);

    answerNext("On it.");
    const own = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    const theirs = await connectDraftThread(project.id, draftId, await signIn(db, teammate.id));
    expect(await storedThreadOf(db, draftId)).toEqual(NOTHING_STORED);
    theirs.send({ type: "send", operationId: crypto.randomUUID(), text: "Rewrite the intro" });

    await own.untilIdle(2);
    expect(said(own.view())).toEqual([
      { from: "editor", text: "Rewrite the intro" },
      { from: "agent", text: "On it." },
    ]);
    expect((await storedThreadOf(db, draftId)).tables).not.toEqual([]);
    own.close();
    theirs.close();
  });

  it("is its draft's own: another draft shows another thread", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);
    const first = await startDraft(db, project.id, memberUser.id);
    const second = await startDraft(db, project.id, memberUser.id);
    answerNext("Done.");
    const inFirst = await connectDraftThread(project.id, first, token);
    inFirst.send({ type: "send", operationId: crypto.randomUUID(), text: "Fix the typo" });
    await inFirst.untilIdle(2);
    inFirst.close();

    const inSecond = await connectDraftThread(project.id, second, token);
    const backInFirst = await connectDraftThread(project.id, first, token);

    expect(inSecond.view().messages).toEqual([]);
    expect(said(backInFirst.view())).toEqual([
      { from: "editor", text: "Fix the typo" },
      { from: "agent", text: "Done." },
    ]);
    inSecond.close();
    backInFirst.close();
  });

  it("refuses someone who isn't a project member", async () => {
    const { db, memberUser, outsiderUser, project } = await createProjectFixture(
      crypto.randomUUID(),
    );
    const draftId = await startDraft(db, project.id, memberUser.id);

    const response = await requestDraftThread(
      project.id,
      draftId,
      await signIn(db, outsiderUser.id),
    );

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it("refuses a draft of another project", async () => {
    const own = await createProjectFixture(crypto.randomUUID());
    const other = await createProjectFixture(crypto.randomUUID());
    const othersDraft = await startDraft(other.db, other.project.id, other.memberUser.id);

    const response = await requestDraftThread(
      own.project.id,
      othersDraft,
      await signIn(own.db, own.memberUser.id),
    );

    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
  });
});

describe("the agent changing content from a draft's thread", () => {
  /** Opens the website's draft thread as `userId`, in a draft the fixture member started. */
  async function openDraftThread(website: Website, userId = website.memberUser.id) {
    const { db, memberUser, project } = website;
    const draftId = await startDraft(db, project.id, memberUser.id);
    const thread = await connectDraftThread(project.id, draftId, await signIn(db, userId));
    return { draftId, thread };
  }

  it("writes in the draft from one script chaining typed results, leaving Live unchanged", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { draftId, thread } = await openDraftThread(website);
    answerWithScript(`
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      await tools.createBlock({ pageId: page.id, type: "text", content: { body: "We launched." } });
      const pricing = await tools.getPage({ path: "/pricing" });
      await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
      text(page.fullPath);
    `);
    answerFrom(({ scriptOutput }) => `Created ${scriptOutput} and raised the price.`);

    const view = await ask(thread, "Announce our launch, and raise the price to $12");

    expect(lastAnswer(view)).toBe("Created /launch and raised the price.");
    expect(await pagesOf(website, draftId)).toEqual({
      "/pricing": ["<!-- Text -->\nPlans start at $12."],
      "/launch": ["<!-- Text -->\nWe launched."],
    });
    expect(await pagesOf(website)).toEqual({ "/pricing": ["<!-- Text -->\nPlans start at $9."] });
  });

  it("announces a scripted write in the draft to the project's realtime room", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { draftId, thread } = await openDraftThread(website);
    forgetSent(website.project.id);
    answerWithScript(`
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      text(page.fullPath);
    `);
    answerFrom(({ scriptOutput }) => `Created ${scriptOutput}.`);

    await ask(thread, "Add a launch page");

    expect(refreshes(sentTo(website.project.id), draftId, queryKeys.pages.list)).toBe(true);
    expect(refreshes(sentTo(website.project.id), null, queryKeys.pages.list)).toBe(false);
  });

  it("can't publish or delete the draft from a script", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { draftId, thread } = await openDraftThread(website);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
      const outcomes = [];
      for (const name of ["publishDraft", "deleteDraft"]) {
        try {
          const { token } = await tools.previewPublish({});
          await tools[name]({ token });
          outcomes.push(name + " went through");
        } catch {
          outcomes.push(name + " failed");
        }
      }
      text(outcomes.join(", "));
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Raise the price to $12 and ship it");

    expect(lastAnswer(view)).toBe("publishDraft failed, deleteDraft failed");
    expect(await pagesOf(website, draftId)).toEqual({
      "/pricing": ["<!-- Text -->\nPlans start at $12."],
    });
    expect(await pagesOf(website)).toEqual({ "/pricing": ["<!-- Text -->\nPlans start at $9."] });
  });

  /** A script creating a page at `/launch`, printing who created it, or why it couldn't. */
  const CREATE_LAUNCH_PAGE = `
    try {
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      const { page: created } = await tools.getPage({ id: page.id });
      text(created.createdBy);
    } catch (error) {
      text(JSON.parse(error.message).code);
    }
  `;

  it("acts as the editor whose message started the run", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const teammate = await addMember(website.db, website.project.organizationId);
    const { thread } = await openDraftThread(website, teammate.id);
    answerWithScript(CREATE_LAUNCH_PAGE);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Add a launch page");

    expect(lastAnswer(view)).toBe(teammate.name);
  });

  it("can't act for an editor removed from the project mid-thread", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const teammate = await addMember(website.db, website.project.organizationId);
    const { draftId, thread } = await openDraftThread(website, teammate.id);
    await website.db.delete(member).where(eq(member.userId, teammate.id));
    answerWithScript(CREATE_LAUNCH_PAGE);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Add a launch page");

    expect(lastAnswer(view)).toBe("FORBIDDEN");
    expect(Object.keys(await pagesOf(website, draftId))).toEqual(["/pricing"]);
  });
});

describe("a development draft's thread", () => {
  it("works for its developer", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    await openDevelopmentDraft(db, project.id, memberUser.id);
    answerNext("Your local definitions look fine.");

    const thread = await connectDraftThread(
      project.id,
      DEVELOPMENT_DRAFT,
      await signIn(db, memberUser.id),
    );
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Check my blocks" });
    await thread.untilIdle(2);

    expect(thread.view().messages.at(-1)).toMatchObject({
      from: "agent",
      text: "Your local definitions look fine.",
    });
    thread.close();
  });

  it("isn't reachable by another member, even by the draft's id", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const teammate = await addMember(db, project.organizationId);
    const developmentDraftId = await openDevelopmentDraft(db, project.id, memberUser.id);
    const token = await signIn(db, teammate.id);

    const byId = await requestDraftThread(project.id, developmentDraftId, token);
    // The teammate has no development draft of their own.
    const byName = await requestDraftThread(project.id, DEVELOPMENT_DRAFT, token);

    expect(byId.status).toBe(403);
    expect(byId.webSocket).toBeNull();
    expect(byName.status).toBe(404);
    expect(byName.webSocket).toBeNull();
  });
});
