import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addMember,
  createRpcContext,
  openDevelopmentDraft,
  startDraft,
} from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  connectDraftThread,
  said,
  signIn,
  storedThread,
  threadIdOf,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const NOTHING_STORED = { tables: [], keys: [] };

/**
 * The thread of `draft` (a draft's id, or `development` for the fixture member's development
 * draft, whose id is `draftId`), which raised the price in it as the fixture member asked, with
 * `watcherId`'s studio still open on it.
 */
async function threadThatChanged(
  website: Website,
  { draft, draftId, watcherId }: { draft: string; draftId: string; watcherId: string },
) {
  const { db, memberUser, project } = website;
  const thread = await connectDraftThread(project.id, draft, await signIn(db, memberUser.id));
  const watching = await connectDraftThread(project.id, draft, await signIn(db, watcherId));
  answerWithScript(`
    const pricing = await tools.getPage({ path: "/pricing" });
    await tools.editBlock({ id: pricing.blocks[0].id, content: { body: "Plans start at $12." } });
  `);
  answerFrom(() => "Raised the price.");
  thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Raise the price to $12" });
  await watching.untilIdle(2);
  thread.close();
  const threadId = await threadIdOf(db, draftId);
  if (!threadId) throw new Error("The draft's thread didn't start");
  return { threadId, watching };
}

/** A draft the fixture member started, whose thread changed it, open in a teammate's studio. */
async function draftWithThread(website: Website) {
  const { db, memberUser, project } = website;
  const teammate = await addMember(db, project.organizationId);
  const draftId = await startDraft(db, project.id, memberUser.id);
  const opened = await threadThatChanged(website, {
    draft: draftId,
    draftId,
    watcherId: teammate.id,
  });
  return { draftId, ...opened };
}

const inDraft = ({ db, memberUser }: Website, draft: string) => ({
  context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: draft }),
});

async function publish(website: Website, draft: string) {
  const projectId = website.project.id;
  const { token } = await call(
    router.drafts.previewPublish,
    { projectId },
    inDraft(website, draft),
  );
  return call(router.drafts.publish, { projectId, token }, inDraft(website, draft));
}

const discard = (website: Website, draft: string) =>
  call(router.drafts.discard, { projectId: website.project.id }, inDraft(website, draft));

describe("a draft's thread ending with its draft", () => {
  it("is deleted when the draft is published, leaving an open studio no thread", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { draftId, threadId, watching } = await draftWithThread(website);

    await publish(website, draftId);

    await watching.until(() => watching.view().messages.length === 0);
    expect(await storedThread(threadId)).toEqual(NOTHING_STORED);
    watching.close();
  });

  it("is deleted when the draft is discarded, leaving an open studio no thread", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { draftId, threadId, watching } = await draftWithThread(website);

    await discard(website, draftId);

    await watching.until(() => watching.view().messages.length === 0);
    expect(await storedThread(threadId)).toEqual(NOTHING_STORED);
    watching.close();
  });
});

describe("a development draft's thread", () => {
  it.each([
    ["publishing", publish],
    ["discarding", discard],
  ])("is emptied by %s the draft, which stays open", async (_ending, end) => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const draftId = await openDevelopmentDraft(db, project.id, memberUser.id);
    const { threadId, watching } = await threadThatChanged(website, {
      draft: DEVELOPMENT_DRAFT,
      draftId,
      watcherId: memberUser.id,
    });

    await end(website, DEVELOPMENT_DRAFT);

    await watching.until(() => watching.view().messages.length === 0);
    expect(await storedThread(threadId)).toEqual(NOTHING_STORED);
    watching.close();
    answerNext("Hello again.");
    const reopened = await connectDraftThread(
      project.id,
      DEVELOPMENT_DRAFT,
      await signIn(db, memberUser.id),
    );
    expect(reopened.view().messages).toEqual([]);
    reopened.send({ type: "send", operationId: crypto.randomUUID(), text: "Hi" });
    await reopened.untilIdle(2);
    expect(said(reopened.view())).toEqual([
      { from: "editor", text: "Hi" },
      { from: "agent", text: "Hello again." },
    ]);
    reopened.close();
  });
});
