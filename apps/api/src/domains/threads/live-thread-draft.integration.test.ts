import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { addMember } from "../../../test/fixtures";
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
  websiteFixture,
} from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

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

    const view = await ask(thread, "Raise it to $12");

    const [draft, ...others] = await draftsOf(website);
    expect(others).toEqual([]);
    expect(draft?.createdBy.id).toBe(website.memberUser.id);
    expect(view.startedDraft).toBe(draft?.id);
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
    expect(next.view().continuedIn).toBe(draft?.id);
    // The fresh thread is the editor's Live thread: it answers on Live.
    answerNext("Plans start at $9.");
    const answered = await ask(next, "What do plans cost?");
    expect(said(answered)).toEqual([
      { from: "editor", text: "What do plans cost?" },
      { from: "agent", text: "Plans start at $9." },
    ]);
    expect((await draftsOf(website)).map(({ id }) => id)).toEqual([draft?.id]);
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
});
