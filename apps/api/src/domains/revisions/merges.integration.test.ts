import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext } from "../../../test/fixtures";
import { sentTo } from "../../../test/project-rooms";
import { commitToMain, pushToMain, startDeliveringPush } from "../../../test/pushes";
import {
  broken,
  failingMarker,
  HERO,
  LOCKFILE,
  PRICING,
  revisionFakes as fakes,
  websiteWithCode,
} from "../../../test/revision-builds";
import {
  answerNext,
  answerWithToolCall,
  forgetThreadModel,
  holdNextToolCall,
  threadModelCalls,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  said,
  signIn,
  type Website,
} from "../../../test/threads";
import { router } from "../../router";

// When Live's code moves, through a publish or an Upgrade, Camox merges it into every open draft
// with code (ADR 0020's amendment, spec #560 section 11), so each draft's preview shows what
// publishing it would produce. A clean merge is silent: it becomes a merge revision, which the
// preview reloads to.

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
/** The hero block as another publish changed it on `main`. */
const NEW_HERO = `export const hero = "Welcome to the new Acme";\n`;
const FAQ_FILE = "src/blocks/faq.tsx";
const FAQ = `export const faq = "Questions and answers";\n`;

/** `main`'s files, as `websiteWithCode` pushed them, with `changes`. */
const mainWith = (changes: Record<string, string>) => ({
  "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
  "pnpm-lock.yaml": LOCKFILE,
  [HERO_FILE]: HERO,
  ...changes,
});

const reviewer = ({ db, memberUser }: Website, draftId: string) => ({
  context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId }),
});

const previewOf = (website: Website, draftId: string) =>
  call(router.drafts.previewPublish, { projectId: website.project.id }, reviewer(website, draftId));

/** A draft whose agent added a pricing block, which built at the end of its turn. */
async function draftWithPricing() {
  const website = await websiteWithCode();
  const token = await signIn(website.db, website.memberUser.id);
  const live = await connectLiveThread(website.project.id, token);
  answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
  answerNext("I added a pricing section.");
  await ask(live, "Add a pricing section");
  const [draft] = await draftsOf(website);
  return { website, token, draftId: draft!.id };
}

/** The revision messages the draft's viewers were sent, in order. */
const revisionsSentFor = (website: Website, draftId: string) =>
  sentTo(website.project.id).flatMap((message) =>
    message.type === "revision" && message.draftId === draftId ? [message.revisionId] : [],
  );

describe("merging Live's code into a draft", () => {
  it("merges a push to main into an open draft with code, whose preview reloads silently", async () => {
    const { website, token, draftId } = await draftWithPricing();
    const repo = website.project.uuid;
    const shown = revisionsSentFor(website, draftId);
    const thread = await connectDraftThread(website.project.id, draftId, token);
    const before = said(thread.view());

    await pushToMain(repo, mainWith({ [HERO_FILE]: NEW_HERO }));

    // The preview reloads to a build holding both changes.
    const reloaded = revisionsSentFor(website, draftId);
    expect(reloaded).toHaveLength(shown.length + 1);
    const [build] = (await fakes.revisionBuilds(draftId)).slice(-1);
    expect(build!.files).toMatchObject({ [PRICING_FILE]: PRICING, [HERO_FILE]: NEW_HERO });
    expect((await previewOf(website, draftId)).code).toMatchObject({
      revision: reloaded.at(-1),
      includesLive: true,
    });
    // The draft's branch holds both, and its thread shows nothing of it.
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(NEW_HERO);
    expect(await fakes.readFile(repo, draftId, PRICING_FILE)).toBe(PRICING);
    expect(said(thread.view())).toEqual(before);
    expect(thread.view().running).toBe(false);
  });

  it("merges into a draft whose agent is mid-turn only after the turn's last commit", async () => {
    const { website, token, draftId } = await draftWithPricing();
    const repo = website.project.uuid;
    const thread = await connectDraftThread(website.project.id, draftId, token);
    const write = holdNextToolCall("write", { path: FAQ_FILE, content: FAQ });
    answerNext("I added an FAQ.");
    const calls = threadModelCalls();
    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Add an FAQ" });
    await vi.waitFor(() => expect(threadModelCalls()).toBe(calls + 1));
    const builtBefore = (await fakes.revisionBuilds(draftId)).length;

    await pushToMain(repo, mainWith({ [HERO_FILE]: NEW_HERO }));
    // The agent is still working on its turn: nothing merged yet.
    expect(await fakes.revisionBuilds(draftId)).toHaveLength(builtBefore);
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(HERO);

    write();
    await thread.untilIdle();
    const [turn, merge] = (await fakes.revisionBuilds(draftId)).slice(builtBefore);
    expect(turn!.files).toMatchObject({ [FAQ_FILE]: FAQ, [HERO_FILE]: HERO });
    expect(merge!.files).toMatchObject({ [FAQ_FILE]: FAQ, [HERO_FILE]: NEW_HERO });
    expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(NEW_HERO);
    expect(await fakes.readFile(repo, draftId, FAQ_FILE)).toBe(FAQ);
    expect(lastAnswer(thread.view())).toBe("I added an FAQ.");
  });

  it("says the draft doesn't include everything published to Live until it merged it", async () => {
    const { website, draftId } = await draftWithPricing();
    const repo = website.project.uuid;
    const reviewed = await previewOf(website, draftId);
    expect(reviewed.code).toMatchObject({ includesLive: true });
    await fakes.holdBuilds(draftId);

    await commitToMain(repo, mainWith({ [HERO_FILE]: NEW_HERO }));
    const delivered = await startDeliveringPush(repo);
    await vi.waitFor(
      async () =>
        expect((await previewOf(website, draftId)).code).toMatchObject({ includesLive: false }),
      { timeout: 10_000, interval: 50 },
    );
    // A merge building doesn't hold up publishing: the publish waits for it instead.
    const merging = await previewOf(website, draftId);
    expect(merging.code).toMatchObject({ revision: reviewed.code!.revision, building: false });
    expect(merging.blockers).toEqual([]);

    await fakes.releaseBuilds(draftId);
    await delivered();
    expect((await previewOf(website, draftId)).code).toMatchObject({ includesLive: true });
  });

  // Camox's reconcile turn (#582) takes these over: until then, the clash is recorded.
  describe("that clashes", () => {
    /** A draft whose agent changed the hero block, built at the end of its turn. */
    async function draftChangingHero(hero: string) {
      const website = await websiteWithCode();
      const token = await signIn(website.db, website.memberUser.id);
      const live = await connectLiveThread(website.project.id, token);
      answerWithToolCall("write", { path: HERO_FILE, content: hero });
      answerNext("I changed the hero.");
      await ask(live, "Change the hero");
      const [draft] = await draftsOf(website);
      return { website, draftId: draft!.id };
    }

    it("keeps the draft's last revision when Live's change conflicts with the draft's", async () => {
      const ours = `export const hero = "Welcome, friends";\n`;
      const { website, draftId } = await draftChangingHero(ours);
      const repo = website.project.uuid;
      const reviewed = await previewOf(website, draftId);
      const shown = revisionsSentFor(website, draftId);

      const main = await pushToMain(repo, mainWith({ [HERO_FILE]: NEW_HERO }));

      expect(revisionsSentFor(website, draftId)).toEqual(shown);
      expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(ours);
      expect((await previewOf(website, draftId)).code).toMatchObject({
        revision: reviewed.code!.revision,
        includesLive: false,
      });
      expect(await env.DRAFT_CODE.getByName(draftId).clash()).toEqual({
        main,
        conflicts: [HERO_FILE],
      });
    });

    it("keeps the draft's last revision when the merged code doesn't build", async () => {
      const { website, token, draftId } = await draftWithPricing();
      const repo = website.project.uuid;
      const reviewed = await previewOf(website, draftId);
      const builtBefore = (await fakes.revisionBuilds(draftId)).length;
      const marker = await failingMarker(HERO_FILE);

      const main = await pushToMain(repo, mainWith({ [HERO_FILE]: broken(marker) }));

      // The merged tree was built, and nothing of it committed.
      expect(await fakes.revisionBuilds(draftId)).toHaveLength(builtBefore + 1);
      expect(await fakes.readFile(repo, draftId, HERO_FILE)).toBe(HERO);
      expect((await previewOf(website, draftId)).code).toMatchObject({
        revision: reviewed.code!.revision,
        includesLive: false,
      });
      expect(await env.DRAFT_CODE.getByName(draftId).clash()).toMatchObject({
        main,
        result: { ok: false, build: [expect.objectContaining({ file: HERO_FILE })] },
      });
      // The agent's working copy is still the draft's, and its next turn builds it as such.
      const thread = await connectDraftThread(website.project.id, draftId, token);
      answerWithToolCall("write", { path: FAQ_FILE, content: FAQ });
      answerNext("I added an FAQ.");
      await ask(thread, "Add an FAQ");
      const [turn] = (await fakes.revisionBuilds(draftId)).slice(-1);
      expect(turn!.files).toMatchObject({ [HERO_FILE]: HERO, [FAQ_FILE]: FAQ });
    });
  });
});
