import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import type { RevisionMessage } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext, createSessionFixture } from "../../../test/fixtures";
import { sentTo } from "../../../test/project-rooms";
import { pushToMain } from "../../../test/pushes";
import { answerFrom, answerWithToolCall, forgetThreadModel } from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  signIn,
  textDefinition,
  type ThreadClient,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";
import { INFRASTRUCTURE_ATTEMPTS } from "./build";
import type { RevisionToLoad } from "./dispatch";
import type { PreviewQuestion } from "./previews";

// A draft's preview shows its latest revision (ADR 0023): once a build passes, dispatch prewarms
// the revision, its definitions become the draft's, and the draft's viewers hear of it in the
// project room. Dispatch then sends the renderer document and runtime reads of the members who can
// see the draft to that revision, asking the API through its `CamoxPreviews` entrypoint.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type Fakes = {
  defineBuildsOf(marker: string, definitionSet: unknown): Promise<void>;
  prewarmed(): Promise<RevisionToLoad[]>;
  failPrewarms(times: number): Promise<void>;
};

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;
const previews = (
  exports as unknown as {
    CamoxPreviews: { previewedRevision(question: PreviewQuestion): Promise<RevisionToLoad | null> };
  }
).CamoxPreviews;
const builds = (env as unknown as { REVISION_BUILDS: R2Bucket }).REVISION_BUILDS;

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const pricingDefinition = {
  blockId: "pricing",
  title: "Pricing",
  description: "Plans and their prices",
  contentSchema: {
    type: "object",
    toMarkdown: ["{{headline}}"],
    properties: { headline: { type: "string", fieldType: "String" } },
  },
};

const definitionSetWith = (website: Website, blocks: unknown[]) => ({
  blocks: [textDefinition, ...blocks],
  layouts: [{ layoutId: website.layout.layoutId, description: "Default", blocks: [] }],
  collections: [],
  homepage: null,
});

/** A block file the fake sandbox builds into the Definition Set scripted for `marker`. */
const blockFile = (marker: string) => `export const block = "built"; // ${marker}\n`;

/** The lockfile of a website on `camox` 1.4.0. */
const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      camox:
        specifier: 1.4.0
        version: 1.4.0(react@19.2.0)
`;

/** A website whose `main` holds its text block, on `camox` 1.4.0. */
async function websiteWithCode() {
  const website = await websiteFixture({ home: "Hello" });
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "1.4.0" } }\n`,
    "pnpm-lock.yaml": LOCKFILE,
    "src/blocks/text.tsx": `export const text = "text";\n`,
  });
  const token = await signIn(website.db, website.memberUser.id);
  return { website, token };
}

/** Has the agent call `build`, and returns its result. */
async function build(thread: ThreadClient) {
  answerWithToolCall("build", {});
  answerFrom(({ lastToolResult }) => lastToolResult);
  return lastAnswer(await ask(thread, "Build", { keepOpen: true }))!;
}

/** Has the agent write `src/blocks/pricing.tsx` as `content` on Live, which starts a draft. */
async function writePricing(website: Website, token: string, content: string) {
  const live = await connectLiveThread(website.project.id, token);
  answerWithToolCall("write", { path: "src/blocks/pricing.tsx", content });
  answerFrom(() => "Wrote it.");
  await ask(live, "Add a pricing section");
  const [draft] = await draftsOf(website);
  return {
    draftId: draft!.id,
    thread: await connectDraftThread(website.project.id, draft!.id, token),
  };
}

/** A draft with code whose pricing block's build passed, defining it. */
async function draftWithPricing() {
  const { website, token } = await websiteWithCode();
  const marker = crypto.randomUUID();
  await fakes.defineBuildsOf(marker, definitionSetWith(website, [pricingDefinition]));
  const { draftId, thread } = await writePricing(website, token, blockFile(marker));
  const result = JSON.parse(await build(thread)) as { ok: boolean; revision?: string };
  return { website, token, draftId, thread, result };
}

const revisionMessages = (website: Website) =>
  sentTo(website.project.id).filter(
    (message): message is RevisionMessage => message.type === "revision",
  );

/** The block types a draft's studio reads. */
async function blockTypesOf({ db, memberUser, project }: Website, draftId: string) {
  const context = createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId });
  const definitions = await call(
    router.blockDefinitions.list,
    { projectId: project.id },
    { context },
  );
  return definitions.map(({ blockId }) => blockId).sort();
}

describe("a draft's new revision", () => {
  it("is announced to the draft's viewers, with the SDK it was built with", async () => {
    const { website, draftId, thread, result } = await draftWithPricing();
    thread.close();

    expect(result.ok).toBe(true);
    expect(revisionMessages(website)).toEqual([
      { type: "revision", draftId, revisionId: result.revision, sdkVersion: "1.4.0" },
    ]);
  });

  it("is prewarmed through dispatch before it's announced", async () => {
    const { website, draftId, thread, result } = await draftWithPricing();
    thread.close();

    expect(await fakes.prewarmed()).toContainEqual(
      expect.objectContaining({
        revision: result.revision,
        draft: draftId,
        project: website.project.uuid,
      }),
    );
  });

  it("is announced after the draft's viewers are told its definitions changed", async () => {
    const { website, draftId, thread } = await draftWithPricing();
    thread.close();

    const messages = sentTo(website.project.id);
    const definitionsChanged = messages.findIndex(
      (message) => message.type === "invalidate" && message.draftId === draftId,
    );
    const announced = messages.findIndex((message) => message.type === "revision");
    expect(definitionsChanged).toBeGreaterThanOrEqual(0);
    expect(announced).toBeGreaterThan(definitionsChanged);
  });

  it("isn't previewed or announced while dispatch can't prewarm it", async () => {
    const { website, token } = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.defineBuildsOf(marker, definitionSetWith(website, [pricingDefinition]));
    const { draftId, thread } = await writePricing(website, token, blockFile(marker));
    await fakes.failPrewarms(INFRASTRUCTURE_ATTEMPTS);

    expect(await build(thread)).toContain("a problem on its side");
    thread.close();

    expect(revisionMessages(website)).toEqual([]);
    expect(await blockTypesOf(website, draftId)).toEqual(["text"]);
    expect(
      await previews.previewedRevision({
        project: website.project.uuid,
        draft: draftId,
        session: `better-auth.session_token=${token}`,
      }),
    ).toBeNull();
  });

  it("is prewarmed again after a failed prewarm, as Camox retries it", async () => {
    const { website, token } = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.defineBuildsOf(marker, definitionSetWith(website, [pricingDefinition]));
    const { draftId, thread } = await writePricing(website, token, blockFile(marker));
    await fakes.failPrewarms(INFRASTRUCTURE_ATTEMPTS - 1);

    const result = JSON.parse(await build(thread)) as { ok: boolean };
    thread.close();

    expect(result.ok).toBe(true);
    expect(revisionMessages(website)).toHaveLength(1);
    expect(await blockTypesOf(website, draftId)).toEqual(["pricing", "text"]);
  });

  it("isn't announced when its definitions can't be used", async () => {
    const { website, token } = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.defineBuildsOf(marker, { blocks: [{ blockId: 42 }] });
    const { thread } = await writePricing(website, token, blockFile(marker));

    expect(JSON.parse(await build(thread))).toMatchObject({ ok: false });
    thread.close();

    expect(revisionMessages(website)).toEqual([]);
  });

  it("is announced once, however often the same code is built", async () => {
    const { website, thread } = await draftWithPricing();

    await build(thread);
    thread.close();

    expect(revisionMessages(website)).toHaveLength(1);
  });

  it("keeps its build and the previous revision's, deleting older ones", async () => {
    const { website, token } = await websiteWithCode();
    const markers = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const marker of markers) {
      await fakes.defineBuildsOf(marker, definitionSetWith(website, [pricingDefinition]));
    }
    const { draftId, thread } = await writePricing(website, token, blockFile(markers[0]!));
    const revisions = [JSON.parse(await build(thread)).revision as string];
    for (const marker of markers.slice(1)) {
      answerWithToolCall("write", { path: "src/blocks/pricing.tsx", content: blockFile(marker) });
      answerFrom(() => "Changed it.");
      await ask(thread, "Change the pricing section", { keepOpen: true });
      revisions.push(JSON.parse(await build(thread)).revision as string);
    }
    thread.close();

    const stored = await builds.list({ prefix: `${website.project.uuid}/` });
    const keys = stored.objects.map(({ key }) => key);
    const kept = (revision: string) => keys.some((key) => key.includes(revision));
    expect(revisions.map(kept)).toEqual([false, true, true]);
    expect(keys.filter((key) => key.includes(draftId))).toHaveLength(2);
  });
});

describe("the revision dispatch sends a request to", () => {
  it("is the draft's previewed revision, for a member's session", async () => {
    const { website, token, draftId, thread, result } = await draftWithPricing();
    thread.close();

    const answer = await previews.previewedRevision({
      project: website.project.uuid,
      draft: draftId,
      session: `theme=dark; better-auth.session_token=${token}`,
    });

    expect(answer).toMatchObject({
      revision: result.revision,
      project: website.project.uuid,
      draft: draftId,
      archiveKey: expect.stringContaining(result.revision!),
    });
  });

  it("is found from the session's cookie as the browser holds it, signed", async () => {
    const { website, token, draftId, thread, result } = await draftWithPricing();
    thread.close();

    const answer = await previews.previewedRevision({
      project: website.project.uuid,
      draft: draftId,
      session: `__Secure-better-auth.session_token=${await signed(token)}`,
    });

    expect(answer?.revision).toBe(result.revision);
  });

  it.each([
    ["no session", () => ""],
    ["a session Camox didn't make", () => "better-auth.session_token=forged"],
    ["a badly signed session", (token: string) => `better-auth.session_token=${token}.c2lnbmVk`],
  ])("is none for %s", async (_, session) => {
    const { website, token, draftId, thread } = await draftWithPricing();
    thread.close();

    const answer = await previews.previewedRevision({
      project: website.project.uuid,
      draft: draftId,
      session: session(token),
    });

    expect(answer).toBeNull();
  });

  it("is none for a member of another organization", async () => {
    const { website, draftId, thread } = await draftWithPricing();
    thread.close();
    const outsider = await createSessionFixture(website.outsiderUser.id);

    const answer = await previews.previewedRevision({
      project: website.project.uuid,
      draft: draftId,
      session: `better-auth.session_token=${outsider}`,
    });

    expect(answer).toBeNull();
  });

  it("is none on another project's website", async () => {
    const { token, draftId, thread } = await draftWithPricing();
    thread.close();
    const other = await websiteFixture({ home: "Elsewhere" });

    const answer = await previews.previewedRevision({
      project: other.project.uuid,
      draft: draftId,
      session: `better-auth.session_token=${token}`,
    });

    expect(answer).toBeNull();
  });

  it("is none for a draft with code that previews no revision yet", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId, thread } = await writePricing(website, token, blockFile("unbuilt"));
    thread.close();

    const answer = await previews.previewedRevision({
      project: website.project.uuid,
      draft: draftId,
      session: `better-auth.session_token=${token}`,
    });

    expect(answer).toBeNull();
  });
});

/** A session token signed as Better Auth signs its cookie, URL-encoded as the cookie holds it. */
async function signed(token: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode((env as unknown as { BETTER_AUTH_SECRET: string }).BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`);
}
