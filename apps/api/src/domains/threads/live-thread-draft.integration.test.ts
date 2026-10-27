import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { addMember, createRpcContext } from "../../../test/fixtures";
import { failNextMove, forgetMoves, holdNextMove } from "../../../test/live-thread-moves";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  pagesOf,
  said,
  signIn,
  socketsOnThreadOf,
  touchedOf,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { draftProcedures } from "../drafts/routes";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

// Moves into a draft fail or wait when a test asks, as D1 might.
vi.mock("./service", async (importOriginal) => {
  const service = await importOriginal<typeof import("./service")>();
  const { interceptMoves: intercept } = await import("../../../test/live-thread-moves");
  return { ...service, moveLiveThreadIntoDraft: intercept(service.moveLiveThreadIntoDraft) };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
  forgetMoves();
});

/** Waits until `check` holds, as the thread works on its own. */
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("It never happened");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const LIVE_PRICING = { "/pricing": ["<!-- Text -->\nPlans start at $9."] };

/** A script raising the pricing page's price to $12. */
const RAISE_PRICE = `
  const pricing = await tools.getPage({ path: "/pricing" });
  await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
`;

describe("a Live thread starting a draft", () => {
  it("answers a read-only question without starting a draft", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    answerWithScript(`
      const pricing = await tools.getPage({ path: "/pricing" });
      text(pricing.blocks.length + " block");
    `);
    answerFrom(({ scriptOutput }) => `The pricing page has ${scriptOutput}.`);

    const view = await ask(
      await connectLiveThread(website.project.id, token),
      "What's on pricing?",
    );

    expect(lastAnswer(view)).toBe("The pricing page has 1 block.");
    expect(view.startedDraft).toBeUndefined();
    expect(await draftsOf(website)).toEqual([]);
    // The editor's Live thread is still this one.
    const again = await connectLiveThread(website.project.id, token);
    expect(said(again.view())).toEqual(said(view));
    expect(again.view().continuedIn).toBeUndefined();
    again.close();
  });

  it("starts a draft with its first write, becoming that draft's thread", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const teammate = await addMember(website.db, website.project.organizationId);
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectLiveThread(website.project.id, token);
    answerNext("Plans start at $9.");
    await ask(thread, "What do plans cost?", { keepOpen: true });
    answerWithScript(RAISE_PRICE);
    answerNext("Raised the price to $12.");

    const operationId = crypto.randomUUID();

    const view = await ask(thread, "Raise it to $12", { operationId });

    const [draft, ...others] = await draftsOf(website);
    expect(others).toEqual([]);
    expect(draft?.createdBy.id).toBe(website.memberUser.id);
    // Only the message whose run wrote takes its studio into the draft.
    expect(view.startedDraft).toEqual({ draftId: draft?.id, operationIds: [operationId] });
    expect(await pagesOf(website, draft!.id)).toEqual({
      "/pricing": ["<!-- Text -->\nPlans start at $12."],
    });
    expect(await pagesOf(website)).toEqual(LIVE_PRICING);

    // A teammate opening the draft sees the whole thread, from before the change.
    const theirs = await connectDraftThread(
      website.project.id,
      draft!.id,
      await signIn(website.db, teammate.id),
    );
    expect(said(theirs.view())).toEqual([
      { from: "editor", text: "What do plans cost?" },
      { from: "agent", text: "Plans start at $9." },
      { from: "editor", text: "Raise it to $12" },
      { from: "agent", text: "Raised the price to $12." },
    ]);
    theirs.close();
  });

  it("leaves the editor a fresh Live thread, continued in the draft", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    answerWithScript(RAISE_PRICE);
    answerNext("Raised the price to $12.");
    await ask(await connectLiveThread(website.project.id, token), "Raise the price to $12");
    const [draft] = await draftsOf(website);

    const next = await connectLiveThread(website.project.id, token);

    expect(next.view().messages).toEqual([]);
    expect(next.view().continuedIn?.draftId).toBe(draft?.id);
    // The fresh thread is the editor's Live thread: it answers on Live.
    answerNext("Plans start at $9.");
    const answered = await ask(next, "What do plans cost?");
    expect(said(answered)).toEqual([
      { from: "editor", text: "What do plans cost?" },
      { from: "agent", text: "Plans start at $9." },
    ]);
    expect((await draftsOf(website)).map(({ id }) => id)).toEqual([draft?.id]);
  });

  it("reports the first write's touches for the message whose run started the draft", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectLiveThread(website.project.id, token);
    answerWithScript(`${RAISE_PRICE} text(pricing.page.id);`);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Raise the price to $12", { keepOpen: true });

    const [batch, ...others] = touchedOf(thread);
    expect(others).toEqual([]);
    expect(batch?.operationIds).toEqual(view.startedDraft?.operationIds);
    expect(batch?.touches).toEqual([
      expect.objectContaining({ entity: "page", pageId: lastAnswer(view), kind: "edited" }),
    ]);
    thread.close();
  });

  it("hands the first write's touches to the editor's studio entering the draft once the script ended", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const release = holdNextMove();
    answerWithScript(`${RAISE_PRICE} text(pricing.page.id);`);
    answerFrom(({ scriptOutput }) => scriptOutput);
    const operationId = crypto.randomUUID();
    const live = await connectLiveThread(website.project.id, token);
    live.send({ type: "send", operationId, text: "Raise the price to $12" });
    await until(async () => (await draftsOf(website)).length > 0);
    const [draft] = await draftsOf(website);
    // The studio left Live for the draft before the script ended.
    live.close();
    release();
    await until(
      async () => (await pagesOf(website, draft!.id))["/pricing"]?.[0]?.includes("$12") ?? false,
    );

    const inDraft = await connectDraftThread(website.project.id, draft!.id, token);
    await inDraft.untilIdle(2);
    await inDraft.until(() => touchedOf(inDraft).length > 0);

    expect(touchedOf(inDraft)).toEqual([
      {
        operationIds: [operationId],
        touches: [expect.objectContaining({ pageId: lastAnswer(inDraft.view()), kind: "edited" })],
      },
    ]);
    // Handed over once: no reconnection replays it.
    inDraft.close();
    const again = await connectDraftThread(website.project.id, draft!.id, token);
    expect(touchedOf(again)).toEqual([]);
    again.close();
  });

  it("takes the editor's follow-up from Live into its draft", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectLiveThread(website.project.id, token);
    answerWithScript(RAISE_PRICE);
    answerNext("Raised the price to $12.");
    await ask(thread, "Raise the price to $12", { keepOpen: true });
    answerWithScript(`await tools.createPage({ pathSegment: "launch", layoutId: "default" });`);
    answerNext("Added a launch page.");

    // Sent before the studio entered the draft.
    const view = await ask(thread, "Add a launch page");

    expect(said(view).at(-1)).toEqual({ from: "agent", text: "Added a launch page." });
    const [draft, ...others] = await draftsOf(website);
    expect(others).toEqual([]);
    expect(Object.keys(await pagesOf(website, draft!.id))).toEqual(["/pricing", "/launch"]);
    expect(await pagesOf(website)).toEqual(LIVE_PRICING);
  });

  it("keeps writing in its draft, never starting a second one", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    // Two writes at once, the first the thread makes.
    answerWithScript(`
      await Promise.all([
        tools.createPage({ pathSegment: "launch", layoutId: "default" }),
        (async () => { ${RAISE_PRICE} })(),
      ]);
    `);
    answerNext("Added a launch page and raised the price.");
    await ask(await connectLiveThread(website.project.id, token), "Launch, and raise the price");
    const [draft] = await draftsOf(website);
    // Reads the launch page, which only the draft has.
    answerWithScript(`
      const { page } = await tools.getPage({ path: "/launch" });
      await tools.createPage({ pathSegment: "about", layoutId: "default" });
      text(page.fullPath);
    `);
    answerFrom(({ scriptOutput }) => `Added an about page beside ${scriptOutput}.`);

    const inDraft = await connectDraftThread(website.project.id, draft!.id, token);
    const view = await ask(inDraft, "Add an about page");

    expect(said(view)).toEqual([
      { from: "editor", text: "Launch, and raise the price" },
      { from: "agent", text: "Added a launch page and raised the price." },
      { from: "editor", text: "Add an about page" },
      { from: "agent", text: "Added an about page beside /launch." },
    ]);
    expect((await draftsOf(website)).map(({ id }) => id)).toEqual([draft?.id]);
    expect(await pagesOf(website, draft!.id)).toEqual({
      "/pricing": ["<!-- Text -->\nPlans start at $12."],
      "/launch": [],
      "/about": [],
    });
    expect(await pagesOf(website)).toEqual(LIVE_PRICING);
  });

  it("reaches a teammate opening the draft before the thread moved into it", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const teammate = await addMember(website.db, website.project.organizationId);
    const token = await signIn(website.db, website.memberUser.id);
    const release = holdNextMove();
    answerWithScript(RAISE_PRICE);
    answerNext("Raised the price to $12.");
    const asked = ask(await connectLiveThread(website.project.id, token), "Raise the price to $12");
    await until(async () => (await draftsOf(website)).length > 0);
    const [draft] = await draftsOf(website);

    const opening = connectDraftThread(
      website.project.id,
      draft!.id,
      await signIn(website.db, teammate.id),
    );
    // The editor's socket, then the teammate's, reached the thread.
    await until(async () => (await socketsOnThreadOf(website.db, draft!.id)) === 2);
    release();
    const theirs = await opening;
    await asked;
    await theirs.untilIdle(2);

    expect(said(theirs.view())).toEqual([
      { from: "editor", text: "Raise the price to $12" },
      { from: "agent", text: "Raised the price to $12." },
    ]);
    theirs.close();
  });

  it("keeps the write when moving into the draft fails, and moves when the editor returns", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    failNextMove();
    answerWithScript(`${RAISE_PRICE} text("raised");`);
    answerFrom(({ scriptOutput }) => `The script ${scriptOutput} the price.`);

    const view = await ask(await connectLiveThread(website.project.id, token), "Raise the price");

    expect(lastAnswer(view)).toBe("The script raised the price.");
    const [draft] = await draftsOf(website);
    expect(await pagesOf(website, draft!.id)).toEqual({
      "/pricing": ["<!-- Text -->\nPlans start at $12."],
    });
    // Back on Live, the thread moves into its draft, and the editor gets a fresh one.
    const back = await connectLiveThread(website.project.id, token);
    await back.until(() => back.view().startedDraft?.draftId === draft?.id);
    back.close();
    const next = await connectLiveThread(website.project.id, token);
    expect(next.view().messages).toEqual([]);
    expect(next.view().continuedIn?.draftId).toBe(draft?.id);
    next.close();
  });

  it("leaves the editor a fresh Live thread when the draft it started ended before the thread moved into it", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectLiveThread(website.project.id, token);
    failNextMove();
    answerWithScript(RAISE_PRICE);
    answerNext("Raised the price.");
    await ask(thread, "Raise the price", { keepOpen: true });
    const [deleted] = await draftsOf(website);
    // The draft took the thread as its own when the write created it: it ends with the draft.
    await deleteDraft(website, deleted!.id);
    thread.close();
    answerWithScript(`
      await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      text("added");
    `);
    answerFrom(({ scriptOutput }) => `The script ${scriptOutput} a launch page.`);

    const next = await connectLiveThread(website.project.id, token);
    expect(next.view().messages).toEqual([]);
    const view = await ask(next, "Add a launch page");

    expect(lastAnswer(view)).toBe("The script added a launch page.");
    const [draft, ...others] = await draftsOf(website);
    expect(others).toEqual([]);
    expect(draft?.id).not.toBe(deleted?.id);
    expect(view.startedDraft?.draftId).toBe(draft?.id);
    expect(Object.keys(await pagesOf(website, draft!.id))).toEqual(["/pricing", "/launch"]);
  });
});

/** Deletes a draft as a member does from the studio. */
async function deleteDraft({ db, memberUser, project }: Website, draftId: string) {
  const context = createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId });
  await call(draftProcedures.delete, { projectId: project.id }, { context });
}
