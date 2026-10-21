import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { THREAD_ENDED_CLOSE_CODE } from "@camox/api-contract/threads";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
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
  connectForwarded,
  ENDED_THREAD_STORED,
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
  vi.restoreAllMocks();
  forgetThreadModel();
});

/** How the studio names a draft: by its id, or as `development` for a development draft. */
const headerOf = (draftId: string, development: boolean) =>
  development ? DEVELOPMENT_DRAFT : draftId;

/**
 * The thread of draft `draftId` (the fixture member's development draft when `development`),
 * which raised the price in it as the fixture member asked, with `watcherId`'s studio still open
 * on it.
 */
async function threadThatChanged(
  website: Website,
  { draftId, development, watcherId }: { draftId: string; development: boolean; watcherId: string },
) {
  const { db, memberUser, project } = website;
  const draft = headerOf(draftId, development);
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
    draftId,
    development: false,
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

const endings = [
  ["published", publish],
  ["discarded", discard],
] as const;

describe("a draft's thread ending with its draft", () => {
  it.each(endings)(
    "is deleted when the draft is %s, leaving an open studio no thread to reconnect to",
    async (_ending, end) => {
      const website = await websiteFixture({ pricing: "Plans start at $9." });
      const { draftId, threadId, watching } = await draftWithThread(website);

      await end(website, draftId);

      await watching.until(() => watching.closedWith() !== undefined);
      expect(watching.view().messages).toEqual([]);
      expect(watching.closedWith()).toBe(THREAD_ENDED_CLOSE_CODE);
      expect(await storedThread(threadId)).toEqual(ENDED_THREAD_STORED);
    },
  );

  it("turns away a socket that reaches it once it ended, storing nothing more", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { memberUser, project } = website;
    const { draftId, threadId, watching } = await draftWithThread(website);
    watching.close();

    // The API let the socket through just before the draft was published.
    await publish(website, draftId);
    // The thread's object restarted since, remembering nothing it didn't store.
    await abortAllDurableObjects();
    const late = await connectForwarded(
      threadId,
      { id: memberUser.id, name: memberUser.name, image: null },
      { projectId: project.id, draftId, ownerId: null },
    );
    answerNext("Hello again.");
    late.send({ type: "send", operationId: crypto.randomUUID(), text: "Hi" });

    await late.until(() => late.closedWith() !== undefined);
    expect(late.view().messages).toEqual([]);
    expect(late.closedWith()).toBe(THREAD_ENDED_CLOSE_CODE);
    expect(await storedThread(threadId)).toEqual(ENDED_THREAD_STORED);
  });

  it.each(endings)("leaves the draft %s when its thread can't be reached", async (ending, end) => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { draftId, watching } = await draftWithThread(website);
    watching.close();
    vi.spyOn(env.THREAD, "getByName").mockImplementation(() => {
      throw new Error("The thread's namespace is unreachable");
    });

    const result = await end(website, draftId);

    expect(result.ended).toMatchObject({ draftId, outcome: ending });
  });
});

describe("a development draft's thread", () => {
  it.each(endings)("is emptied when the draft is %s, which stays open", async (_ending, end) => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const draftId = await openDevelopmentDraft(db, project.id, memberUser.id);
    const { threadId, watching } = await threadThatChanged(website, {
      draftId,
      development: true,
      watcherId: memberUser.id,
    });

    await end(website, DEVELOPMENT_DRAFT);

    await watching.until(() => watching.closedWith() !== undefined);
    expect(watching.view().messages).toEqual([]);
    expect(await storedThread(threadId)).toEqual(ENDED_THREAD_STORED);
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
