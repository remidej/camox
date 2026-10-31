import { DRAFT_HEADER, REVISION_CHANGED_ERROR } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type Checkout, checkoutOf } from "../../../test/checkouts";
import { createRpcContext, reviewed, runChecks, startDraft } from "../../../test/fixtures";
import { commitToMain, pushToMain, startDeliveringPush } from "../../../test/pushes";
import {
  broken,
  failingMarker,
  type FakeTypeError,
  HERO,
  LOCKFILE,
  PRICING,
  revisionFakes as fakes,
  typeErrorsMarker,
  websiteWithCode,
} from "../../../test/revision-builds";
import {
  answerFrom,
  answerNext,
  answerWithCodeRequest,
  answerWithMessages,
  answerWithToolCall,
  forgetThreadModel,
  holdNextAnswer,
  holdNextToolCall,
} from "../../../test/thread-model";
import { ask, connectDraftThread, lastAnswer, signIn, type Website } from "../../../test/threads";
import { router } from "../../router";
import { projects } from "../../schema";

// A member pushes commits from their own checkout of a flagged project onto a draft, through the
// API, never to the repo (ADR 0026). The API checks the pushed code against the agent's line
// (ADR 0021) and refuses what doesn't fit, writing nothing; accepted commits land as they are on
// the draft's branch, and their head becomes a revision, built and previewed like the agent's.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const PRICING_FILE = "src/blocks/pricing.tsx";
const HERO_FILE = "src/blocks/hero.tsx";
const PACKAGE = `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`;

/** `main`'s files, as `websiteWithCode` pushed them, with `changes`. */
const mainWith = (changes: Record<string, string>) => ({
  "package.json": PACKAGE,
  "pnpm-lock.yaml": LOCKFILE,
  [HERO_FILE]: HERO,
  ...changes,
});

/** An Upgrade's change to `main`: a new `camox` in the manifest and the lockfile. */
const UPGRADE = {
  "package.json": PACKAGE.replace("1.0.0", "1.1.0"),
  "pnpm-lock.yaml": LOCKFILE.replaceAll("1.0.0", "1.1.0"),
};

const gitFakes = fakes as unknown as {
  branches(repo: string): Promise<string[]>;
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
  failPushes(repo: string, branch: string, times: number): Promise<void>;
};
const branchesOf = (repo: string) => gitFakes.branches(repo);

/** A flagged project's website with code on `main`, and a member's checkout of it. */
async function flaggedWebsite() {
  const website = await websiteWithCode();
  await website.db
    .update(projects)
    .set({ codeOutsideCamox: true })
    .where(eq(projects.id, website.project.id));
  const checkout = await checkoutOf(website.project.uuid);
  return { website, checkout };
}

/**
 * Starts pushing the checkout's branch as `camox push` does, as the website's member unless
 * told, to a new draft, or to the draft `draftId` names: the push's stream of events.
 */
async function pushing(
  website: Website,
  checkout: Checkout,
  { as = website.memberUser, draftId }: { as?: Website["memberUser"]; draftId?: string } = {},
) {
  return call(
    router.code.push,
    {
      projectUuid: website.project.uuid,
      branch: checkout.branch,
      bundle: await checkout.bundle(),
      ...(draftId && { draftId }),
    },
    { context: createRpcContext(website.db, as) },
  );
}

/** The push a stream of events ends on, once it landed: a refusal rejects. */
async function landed(events: Awaited<ReturnType<typeof pushing>>) {
  for await (const event of events) if (event.type === "pushed") return event;
  throw new Error("The push ended without landing");
}

/** Reads the push's events until it says it waits for the agent's turn, keeping the stream. */
async function untilWaiting(events: Awaited<ReturnType<typeof pushing>>) {
  for (;;) {
    const { done, value } = await events.next();
    if (done) throw new Error("The push ended without waiting");
    if (value.type === "progress" && value.step === "waiting") return;
  }
}

/** Pushes the checkout's branch, as `pushing` does, once it landed. */
const push = async (...args: Parameters<typeof pushing>) => landed(await pushing(...args));

const FAQ_FILE = "src/blocks/faq.tsx";
const FAQ = `export const faq = "Questions and answers";\n`;

/** A draft of the flagged website whose agent added a pricing block, and its connected thread. */
async function agentDraft(website: Website) {
  const token = await signIn(website.db, website.memberUser.id);
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(website.project.id, draftId, token);
  answerWithCodeRequest("Add a pricing block listing plans with their price.");
  answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
  answerNext("I added a pricing section.");
  await ask(thread, "Add a pricing section", { keepOpen: true });
  return { draftId, thread };
}

/** What a refused push must leave as it was: the draft's branch, builds and preview. */
async function draftAsItIs(website: Website, checkout: Checkout, draftId: string) {
  return {
    branch: await checkout.remoteLog(draftId),
    builds: (await fakes.revisionBuilds(draftId)).length,
    preview: (await previewOf(website, draftId)).code,
  };
}

const PULL_FIRST = {
  code: "PUSH_REFUSED",
  data: { reason: "pullDraftFirst" },
  message: expect.stringMatching(/pull the draft first/),
};

const draftsOf = async (website: Website) =>
  (
    await call(
      router.drafts.list,
      { projectId: website.project.id },
      { context: createRpcContext(website.db, website.memberUser) },
    )
  ).drafts;

const previewOf = (website: Website, draftId: string) =>
  call(
    router.drafts.previewPublish,
    { projectId: website.project.id },
    { context: createRpcContext(website.db, website.memberUser, { [DRAFT_HEADER]: draftId }) },
  );

describe("pushing a new branch", () => {
  it("opens a draft named after the branch, whose branch is the pushed commits and whose preview shows them", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING }, "Add a pricing section");
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");

    const pushed = await push(website, checkout);

    expect(pushed.result).toMatchObject({ ok: true });
    const drafts = await draftsOf(website);
    expect(drafts.find(({ id }) => id === pushed.draftId)).toMatchObject({ name: "pricing" });
    // The draft's branch is the checkout's, commits included, so the checkout fast-forwards.
    expect(await checkout.remoteLog(pushed.draftId)).toEqual(await checkout.log());
    // One build, of the pushed head, which the draft previews.
    const builds = await fakes.revisionBuilds(pushed.draftId);
    expect(builds).toHaveLength(1);
    expect(builds[0]!.files).toMatchObject({
      [PRICING_FILE]: `${PRICING}// Monthly\n`,
      "src/blocks/hero.tsx": HERO,
      "pnpm-lock.yaml": LOCKFILE,
    });
    expect((await previewOf(website, pushed.draftId)).code).toMatchObject({
      revision: pushed.result.revision,
      building: false,
    });
    expect(pushed.studioUrl).toBe(
      `https://${website.project.slug}.camox.site/?camox-draft=${pushed.draftId}`,
    );
  });
});

describe("pushing to an open draft", () => {
  it("adds a later push from the same branch to its draft, as a revision of its own", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING }, "Add a pricing section");
    const first = await push(website, checkout);
    await checkout.pull(first.draftId);
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");

    const second = await push(website, checkout, { draftId: first.draftId });

    expect(second).toMatchObject({ draftId: first.draftId });
    expect(second.result).toMatchObject({ ok: true });
    expect(second.result.revision).not.toBe(first.result.revision);
    expect(await draftsOf(website)).toEqual([expect.objectContaining({ id: first.draftId })]);
    expect(await checkout.remoteLog(first.draftId)).toEqual(await checkout.log());
    const builds = await fakes.revisionBuilds(first.draftId);
    expect(builds.at(-1)!.files).toMatchObject({ [PRICING_FILE]: `${PRICING}// Monthly\n` });
    expect((await previewOf(website, first.draftId)).code).toMatchObject({
      revision: second.result.revision,
    });
  });
  it("sends an open publish confirmation back to the review, as a later agent turn does", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING }, "Add a pricing section");
    const first = await push(website, checkout);
    const reviewed = await previewOf(website, first.draftId);
    await runChecks(website.db, first.draftId);
    await checkout.pull(first.draftId);
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");

    await push(website, checkout, { draftId: first.draftId });

    await expect(
      call(
        router.drafts.publish,
        {
          projectId: website.project.id,
          token: reviewed.token,
          revision: reviewed.code!.revision!,
        },
        {
          context: createRpcContext(website.db, website.memberUser, {
            [DRAFT_HEADER]: first.draftId,
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: REVISION_CHANGED_ERROR,
      message: expect.not.stringMatching(/agent/),
    });
    expect((await previewOf(website, first.draftId)).code).toMatchObject({ publishing: false });
  });
});

describe("a push's entry in the draft's thread", () => {
  it("shows who pushed, their commits and their build, which the agent reads without answering", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING }, "Add a pricing section");
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");
    const pushed = await push(website, checkout);
    const token = await signIn(website.db, website.memberUser.id);

    const thread = await connectDraftThread(website.project.id, pushed.draftId, token);
    await thread.until(() => thread.view().messages.length > 0);

    expect(thread.view()).toMatchObject({
      running: false,
      messages: [
        {
          from: "push",
          sender: { id: website.memberUser.id, name: website.memberUser.name },
          subjects: ["Add a pricing section", "Bill monthly"],
          outcome: "built",
        },
      ],
    });
    answerWithMessages((messages) =>
      JSON.stringify(messages).includes("Bill monthly") ? "I see your push." : "What push?",
    );
    expect(lastAnswer(await ask(thread, "What changed?"))).toBe("I see your push.");
  });

  it("adds one entry for each later push", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING }, "Add a pricing section");
    const first = await push(website, checkout);
    await checkout.pull(first.draftId);
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");
    await push(website, checkout, { draftId: first.draftId });
    const token = await signIn(website.db, website.memberUser.id);

    const thread = await connectDraftThread(website.project.id, first.draftId, token);
    await thread.until(() => thread.view().messages.length >= 2);

    expect(thread.view().messages).toMatchObject([
      { from: "push", subjects: ["Add a pricing section"] },
      { from: "push", subjects: ["Bill monthly"] },
    ]);
    expect(thread.view().running).toBe(false);
  });
});

describe("pushing to a draft the agent works in", () => {
  it("lands a branch that pulled an agent-started draft on it, after the agent's commits", async () => {
    const { website, checkout } = await flaggedWebsite();
    const { draftId } = await agentDraft(website);
    const agents = await checkout.remoteLog(draftId);
    await checkout.pull(draftId);
    await checkout.commit({ [FAQ_FILE]: FAQ }, "Add an FAQ");

    const pushed = await push(website, checkout, { draftId });

    expect(pushed).toMatchObject({ draftId, result: { ok: true } });
    const branch = await checkout.remoteLog(draftId);
    expect(branch).toEqual(await checkout.log());
    expect(branch.slice(1)).toEqual(agents);
    const [build] = (await fakes.revisionBuilds(draftId)).slice(-1);
    expect(build!.files).toMatchObject({ [PRICING_FILE]: PRICING, [FAQ_FILE]: FAQ });
    expect((await previewOf(website, draftId)).code).toMatchObject({
      revision: pushed.result.revision,
    });
  });

  it("refuses a branch missing the draft's head, telling the member to pull it first", async () => {
    const { website, checkout } = await flaggedWebsite();
    const { draftId } = await agentDraft(website);
    await checkout.commit({ [FAQ_FILE]: FAQ }, "Add an FAQ");
    const before = await draftAsItIs(website, checkout, draftId);

    await expect(push(website, checkout, { draftId })).rejects.toMatchObject(PULL_FIRST);

    expect(await draftAsItIs(website, checkout, draftId)).toEqual(before);
  });

  it("tells the Code Agent about it with its next request, once", async () => {
    const { website, checkout } = await flaggedWebsite();
    const { draftId, thread } = await agentDraft(website);
    await checkout.pull(draftId);
    await checkout.commit({ [FAQ_FILE]: FAQ }, "Add an FAQ");
    await push(website, checkout, { draftId });
    const told: string[] = [];
    for (const request of ["Add a testimonials block.", "Add a team block."]) {
      answerWithCodeRequest(request);
      answerFrom(({ editorMessages }) => {
        told.push(editorMessages.at(-1)!);
        return "Done.";
      });
    }

    await ask(thread, "Add testimonials", { keepOpen: true });
    await ask(thread, "Add our team");

    expect(told[0]).toContain("Add an FAQ");
    expect(told[0]).toContain("Add a testimonials block.");
    expect(told[1]).not.toContain("Add an FAQ");
  });

  it("waits for the agent's turn going, then lands", async () => {
    const { website, checkout } = await flaggedWebsite();
    const { draftId, thread } = await agentDraft(website);
    await checkout.pull(draftId);
    await checkout.commit({ [FAQ_FILE]: FAQ }, "Add an FAQ");
    const answer = holdNextAnswer("Plans start at $9.");
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "What do plans cost?" });
    await thread.until(() => thread.view().running);

    const events = await pushing(website, checkout, { draftId });
    await untilWaiting(events);
    answer();
    const pushed = await landed(events);

    expect(pushed.result).toMatchObject({ ok: true });
    expect(await checkout.remoteLog(draftId)).toEqual(await checkout.log());
  });

  it("is refused when the agent's turn it waited for committed code, writing nothing", async () => {
    const { website, checkout } = await flaggedWebsite();
    const { draftId, thread } = await agentDraft(website);
    await checkout.pull(draftId);
    await checkout.commit({ [FAQ_FILE]: FAQ }, "Add an FAQ");
    answerWithCodeRequest("Make the hero's title bold.");
    const write = holdNextToolCall("write", { path: HERO_FILE, content: `${HERO}// Bold\n` });
    answerNext("I made the hero bold.");
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Make the hero bold" });
    await thread.until(() => thread.view().running);

    const events = await pushing(website, checkout, { draftId });
    await untilWaiting(events);
    write();
    await thread.untilIdle();
    const before = await draftAsItIs(website, checkout, draftId);

    await expect(landed(events)).rejects.toMatchObject(PULL_FIRST);
    expect(await draftAsItIs(website, checkout, draftId)).toEqual(before);
  });
});

describe("a refused push", () => {
  /** Expects the push to be refused for `reason`, having written no draft, branch or revision. */
  async function expectRefused(
    website: Website,
    checkout: Checkout,
    reason: string,
    message: RegExp,
  ) {
    const refusal = await push(website, checkout).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "PUSH_REFUSED", data: { reason }, message });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
    return refusal as { data: Record<string, unknown> };
  }

  it.each([
    ["the Vite config", "vite.config.ts"],
    ["the manifest", "package.json"],
    ["a file outside src/", "README.md"],
    ["a file under src/camox/", "src/camox/routes.ts"],
  ])("refuses a branch that changes %s, a platform-owned file", async (_, file) => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING, [file]: "export default {};\n" });

    await expectRefused(website, checkout, "platformFile", new RegExp(file.replaceAll(".", "\\.")));
  });

  it("refuses a branch that deletes a platform-owned file", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ "pnpm-lock.yaml": null });

    await expectRefused(website, checkout, "platformFile", /pnpm-lock\.yaml/);
  });

  it("refuses a branch that adds a file under src/ that isn't TypeScript or CSS", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING, "src/assets/logo.svg": "<svg />\n" });

    await expectRefused(website, checkout, "notCode", /src\/assets\/logo\.svg/);
  });

  it("refuses a branch that starts from a commit that was never on main", async () => {
    const { website, checkout } = await flaggedWebsite();
    const neverPushed = await checkout.commit({ [PRICING_FILE]: PRICING }, "Never pushed");
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` });

    // The bundle builds on a commit only the checkout has.
    const refusal = await call(
      router.code.push,
      {
        projectUuid: website.project.uuid,
        branch: checkout.branch,
        bundle: await checkout.bundle({ since: neverPushed }),
      },
      { context: createRpcContext(website.db, website.memberUser) },
    )
      .then(landed)
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "PUSH_REFUSED",
      data: { reason: "baseNotOnMain" },
      message: expect.stringMatching(/never on `main`/),
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses a branch that conflicts with the current main", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [HERO_FILE]: `export const hero = "Welcome, friends";\n` });
    await pushToMain(
      website.project.uuid,
      mainWith({ [HERO_FILE]: `export const hero = "Welcome to the new Acme";\n` }),
    );

    await expectRefused(
      website,
      checkout,
      "conflictsWithMain",
      /src\/blocks\/hero\.tsx.*Merge `main`/,
    );
  });

  it("refuses a branch whose head doesn't build, with the build's errors", async () => {
    const { website, checkout } = await flaggedWebsite();
    const marker = await failingMarker(PRICING_FILE);
    await checkout.commit({ [PRICING_FILE]: broken(marker) });

    const refusal = await expectRefused(website, checkout, "doesNotBuild", /doesn't build/);

    expect(refusal.data.build).toEqual([
      expect.objectContaining({ file: PRICING_FILE, message: expect.stringMatching(/missing/) }),
    ]);
  });

  it("refuses a branch missing an Upgrade that's on main, telling the member to merge main", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    await pushToMain(website.project.uuid, mainWith(UPGRADE), "Upgrade camox");

    await expectRefused(website, checkout, "mergeMainFirst", /package\.json.*Merge `main` first/);
  });

  it("refuses a push naming a deleted draft, telling the member to start from main", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    const first = await push(website, checkout);
    await call(
      router.drafts.delete,
      { projectId: website.project.id },
      {
        context: createRpcContext(website.db, website.memberUser, {
          [DRAFT_HEADER]: first.draftId,
        }),
      },
    );
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` });

    await expect(push(website, checkout, { draftId: first.draftId })).rejects.toMatchObject({
      code: "PUSH_REFUSED",
      data: { reason: "draftEnded" },
      message: expect.stringMatching(/deleted.*start a new branch from `main`/),
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses a push naming a published draft, telling the member to start from main", async () => {
    const { website, checkout } = await flaggedWebsite();
    // A draft the agent started, which changed content only, published.
    const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
    const inDraft = {
      context: createRpcContext(website.db, website.memberUser, { [DRAFT_HEADER]: draftId }),
    };
    await call(
      router.pages.create,
      { projectId: website.project.id, pathSegment: "pricing", layoutId: website.layout.layoutId },
      inDraft,
    );
    const { token } = await reviewed(
      website.db,
      draftId,
      call(router.drafts.previewPublish, { projectId: website.project.id }, inDraft),
    );
    await call(router.drafts.publish, { projectId: website.project.id, token }, inDraft);
    await checkout.commit({ [PRICING_FILE]: PRICING });

    await expect(push(website, checkout, { draftId })).rejects.toMatchObject({
      code: "PUSH_REFUSED",
      data: { reason: "draftEnded" },
      message: expect.stringMatching(/published.*start a new branch from `main`/),
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses a project whose code can't be worked on outside Camox", async () => {
    const website = await websiteWithCode();
    const checkout = await checkoutOf(website.project.uuid);
    await checkout.commit({ [PRICING_FILE]: PRICING });

    await expect(push(website, checkout)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/can't be worked on outside Camox/),
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses someone outside the project's organization", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });

    await expect(push(website, checkout, { as: website.outsiderUser })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });
});

describe("an accepted push", () => {
  it("passes with an Upgrade merged from main, which its build has", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    await pushToMain(website.project.uuid, mainWith(UPGRADE), "Upgrade camox");
    await checkout.mergeMain();

    const pushed = await push(website, checkout);

    expect(pushed.result).toMatchObject({ ok: true });
    expect(await checkout.remoteLog(pushed.draftId)).toEqual(await checkout.log());
    const [build] = await fakes.revisionBuilds(pushed.draftId);
    expect(build!.files).toMatchObject({ ...UPGRADE, [PRICING_FILE]: PRICING });
    expect((await previewOf(website, pushed.draftId)).code).toMatchObject({ includesLive: true });
  });

  it("opens a draft Camox merges main's later moves into, as any draft", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    const pushed = await push(website, checkout);
    const NEW_HERO = `export const hero = "Welcome to the new Acme";\n`;

    await pushToMain(website.project.uuid, mainWith({ [HERO_FILE]: NEW_HERO }));

    const repo = website.project.uuid;
    expect(await gitFakes.readFile(repo, pushed.draftId, HERO_FILE)).toBe(NEW_HERO);
    expect(await gitFakes.readFile(repo, pushed.draftId, PRICING_FILE)).toBe(PRICING);
    expect((await previewOf(website, pushed.draftId)).code).toMatchObject({ includesLive: true });
  });

  it("counts a newer main the branch merged as merged into its draft", async () => {
    const { website, checkout } = await flaggedWebsite();
    const repo = website.project.uuid;
    await checkout.commit({ [PRICING_FILE]: PRICING });
    const first = await push(website, checkout);
    await checkout.pull(first.draftId);
    const NEW_HERO = `export const hero = "Welcome to the new Acme";\n`;
    await commitToMain(repo, mainWith({ [HERO_FILE]: NEW_HERO }));
    await checkout.mergeMain();
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");
    await push(website, checkout, { draftId: first.draftId });
    // The agent works in the draft, so Camox's own merge of `main` waits for its turn.
    const thread = await connectDraftThread(
      website.project.id,
      first.draftId,
      await signIn(website.db, website.memberUser.id),
    );
    const answer = holdNextAnswer("Plans start at $9.");
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "What do plans cost?" });
    await thread.until(() => thread.view().running);

    const delivered = await startDeliveringPush(repo);
    await delivered();

    expect((await previewOf(website, first.draftId)).code).toMatchObject({ includesLive: true });
    answer();
    await thread.untilIdle();
    expect(await checkout.remoteLog(first.draftId)).toEqual(await checkout.log());
  });

  it("opens no draft when Camox fails to land it, after building it", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    // Every try at writing the draft's branch fails, on Camox's side.
    await gitFakes.failPushes(website.project.uuid, "*", 1_000);

    await expect(push(website, checkout)).rejects.toThrow();

    await gitFakes.failPushes(website.project.uuid, "*", 0);
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("shows the head's type errors as a Blocker on the draft", async () => {
    const { website, checkout } = await flaggedWebsite();
    const error: FakeTypeError = {
      file: PRICING_FILE,
      line: 2,
      column: 7,
      code: "TS2322",
      message: "Type 'number' is not assignable to type 'string'.",
    };
    const marker = await typeErrorsMarker([error]);
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// ${marker}\n` });

    const pushed = await push(website, checkout);

    expect(pushed.result).toMatchObject({
      ok: false,
      types: [expect.objectContaining({ file: PRICING_FILE, code: "TS2322" })],
    });
    expect((await previewOf(website, pushed.draftId)).blockers).toEqual([
      expect.objectContaining({
        entity: "code",
        code: "codeDoesNotTypeCheck",
        message: expect.stringMatching(/^The code pushed last has type errors: fix them/),
      }),
    ]);
  });
});
