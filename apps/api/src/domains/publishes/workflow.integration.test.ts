import {
  DRAFT_HEADER,
  PUBLISHING_DRAFT_HEADER,
  REVISION_CHANGED_ERROR,
} from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import {
  abortAllDurableObjects,
  introspectWorkflow,
  introspectWorkflowInstance,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callSeedingLive, createRpcContext } from "../../../test/fixtures";
import { sentTo } from "../../../test/project-rooms";
import { deliverPushes, pushToMain } from "../../../test/pushes";
import {
  answerFrom,
  answerWithScript,
  answerWithToolCall,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  pagesOf,
  signIn,
  textDefinition,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";
import { blocks } from "../../schema";

// Publishing a draft with code (spec #560, section 13): the publish Workflow uploads the build of
// the revision members previewed as a new version of the project's Worker, re-checks conflicts,
// promotes the version, runs the publish batch with the draft's definitions, records the tree
// Live serves, pushes that tree to `main` and deletes the draft's code. Wrangler, the sandboxes
// and Artifacts are faked at their bindings (test/release-fakes.js).

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type WorkerVersion = { id: string; build: string; vars: Record<string, string> };

type Fakes = {
  defineBuildsOf(marker: string, definitionSet: unknown): Promise<void>;
  revisionBuilds(
    sandbox: string,
  ): Promise<{ files: Record<string, string>; archive: number[] | null }[]>;
  servedVersion(project: string): Promise<WorkerVersion | null>;
  workerVersions(project: string): Promise<WorkerVersion[]>;
  deployments(project: string): Promise<string[]>;
  publishCommands(project: string): Promise<{ command: string; order: number }[]>;
  holdPublishCommand(project: string, pattern: string): Promise<void>;
  letGoPublishCommand(project: string, pattern: string): Promise<void>;
  commandsRun(repo: string): Promise<{ command: string; order: number }[]>;
  log(repo: string): Promise<{ oid: string; message: string }[]>;
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
  branches(repo: string): Promise<string[]>;
  sandboxDestroyed(sandbox: string): Promise<boolean>;
};

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

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

/** The Live home page's text block, as the studio reads its Markdown. */
const HELLO = "<!-- Text -->\nHello";
/** A pricing block saying plans start at $9, as the studio reads its Markdown. */
const PRICING = "<!-- Pricing -->\nPlans start at $9";

/** A website whose `main` holds its text block, and whose Live home page says "Hello". */
async function websiteWithCode() {
  const website = await websiteFixture({ home: "Hello" });
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
    "src/blocks/text.tsx": `export const text = "text";\n`,
  });
  const token = await signIn(website.db, website.memberUser.id);
  return { website, token };
}

/** The pricing block's file, which the fake sandbox builds into a set with the pricing block. */
const pricingFile = (marker: string) => `export const pricing = "built"; // ${marker}\n`;

/**
 * A draft whose agent wrote a pricing block, built it and placed it on the home page, in one
 * turn on Live. Returns the draft and the block's file.
 */
async function draftAddingPricing(website: Website, token: string) {
  const marker = crypto.randomUUID();
  await fakes.defineBuildsOf(marker, {
    blocks: [textDefinition, pricingDefinition],
    layouts: [{ layoutId: website.layout.layoutId, description: "Default", blocks: [] }],
    collections: [],
    homepage: null,
  });
  const thread = await connectLiveThread(website.project.id, token);
  answerWithToolCall("write", { path: "src/blocks/pricing.tsx", content: pricingFile(marker) });
  answerWithToolCall("build", {});
  answerWithScript(`
    const [home] = await tools.listPages({});
    await tools.createBlock({ pageId: home.id, type: "pricing", content: { headline: "Plans start at $9" } });
    text("placed");
  `);
  answerFrom(() => "Added it.");
  await ask(thread, "Add a pricing section saying plans start at $9");
  const [draft] = await draftsOf(website);
  return { draftId: draft!.id, file: pricingFile(marker) };
}

const memberContext = ({ db, memberUser }: Website, draftId?: string) =>
  createRpcContext(db, memberUser, draftId ? { [DRAFT_HEADER]: draftId } : {});

/** The draft's publish preview, as the studio's review reads it. */
async function previewOf(website: Website, draftId: string) {
  return call(
    router.drafts.previewPublish,
    { projectId: website.project.id },
    { context: memberContext(website, draftId) },
  );
}

type Preview = Awaited<ReturnType<typeof previewOf>>;

/** Publishes the draft as its review showed it, the way the studio's Publish does. */
async function publish(website: Website, draftId: string, preview: Preview) {
  return call(
    router.drafts.publish,
    {
      projectId: website.project.id,
      token: preview.token,
      revision: preview.code?.revision ?? undefined,
    },
    { context: memberContext(website, draftId) },
  );
}

/** Starts watching the publishes started from now on, with their retries' delays disabled. */
async function watchPublishes() {
  const publishes = await introspectWorkflow(env.PUBLISH_WORKFLOW);
  await publishes.modifyAll(async (m) => m.disableRetryDelays());
  return publishes;
}

type Publishes = Awaited<ReturnType<typeof watchPublishes>>;

/** Waits for every publish started since `watchPublishes` to end as `status`. */
async function publishesEnd(publishes: Publishes, status: "complete" | "errored" = "complete") {
  for (const instance of await publishes.get()) await instance.waitForStatus(status);
}

/** The build a draft's revision sandbox made last, as the fake archives it. */
async function lastBuildOf(draftId: string) {
  const builds = await fakes.revisionBuilds(draftId);
  const archive = builds.findLast((build) => build.archive)!.archive!;
  return (JSON.parse(new TextDecoder().decode(new Uint8Array(archive))) as { build: string }).build;
}

/** The block types the studio reads on Live. */
async function liveBlockTypes(website: Website) {
  const definitions = await call(
    router.blockDefinitions.list,
    { projectId: website.project.id },
    { context: memberContext(website) },
  );
  return definitions.map(({ blockId }) => blockId).sort();
}

/**
 * The website's pages by path, each with its blocks' Markdown, as a public read with `headers`
 * sees them, with no session: as a Worker version of the project reads them.
 */
async function publicPagesOf({ db, project }: Website, headers: Record<string, string> = {}) {
  const context = createRpcContext(db, null, headers);
  const pages = await call(router.pages.list, { projectId: project.id }, { context });
  const shown: Record<string, string[]> = {};
  for (const page of pages) {
    const { blocks } = await call(router.blocks.getPageMarkdown, { pageId: page.id }, { context });
    shown[page.fullPath] = blocks.map((block) => block.markdown);
  }
  return shown;
}

/** Waits until a project's publish sandbox ran a command containing `pattern`. */
async function ran(project: string, pattern: string) {
  await vi.waitFor(
    async () => {
      const commands = await fakes.publishCommands(project);
      expect(commands.some(({ command }) => command.includes(pattern))).toBe(true);
    },
    { timeout: 10_000, interval: 50 },
  );
}

/**
 * A draft whose agent changed the text block's code and built it, on Live, changing no content.
 * Returns the draft.
 */
async function draftChangingCode(website: Website, token: string) {
  const before = new Set((await draftsOf(website)).map(({ id }) => id));
  const thread = await connectLiveThread(website.project.id, token);
  answerWithToolCall("write", {
    path: "src/blocks/text.tsx",
    content: `export const text = "${crypto.randomUUID()}";\n`,
  });
  answerWithToolCall("build", {});
  answerFrom(() => "Changed it.");
  await ask(thread, "Change the text block's code");
  return (await draftsOf(website)).find(({ id }) => !before.has(id))!.id;
}

/** Has the draft's agent change its code again and build it: a newer revision. */
async function changeCodeAgain(website: Website, token: string, draftId: string) {
  const thread = await connectDraftThread(website.project.id, draftId, token);
  answerWithToolCall("write", {
    path: "src/blocks/text.tsx",
    content: `export const text = "${crypto.randomUUID()}";\n`,
  });
  answerWithToolCall("build", {});
  answerFrom(() => "Changed it again.");
  await ask(thread, "Change it again");
}

/** The Live home page's text block. */
async function helloBlock({ db, project }: Website) {
  const [block] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(and(eq(blocks.projectId, project.id), eq(blocks.type, "text"), isNull(blocks.draftId)));
  return block!.id;
}

/** Writes the home page's text block in a draft, or on Live, through a published draft. */
async function writeHello(website: Website, body: string, draftId?: string) {
  await callSeedingLive(
    router.blocks.updateContent,
    { id: await helloBlock(website), content: { body } },
    { context: memberContext(website, draftId) },
  );
}

/** The commands of a project's publish sandbox containing `pattern`. */
async function commandsLike(project: string, pattern: string) {
  return (await fakes.publishCommands(project)).filter(({ command }) => command.includes(pattern));
}

/** Starts an Upgrade of the project to camox 1.1.0, from the commit `main` points to. */
async function startUpgrade(repo: string) {
  const [main] = await fakes.log(repo);
  const upgrade = crypto.randomUUID();
  const upgrading = await introspectWorkflowInstance(env.PROJECT_UPGRADE_WORKFLOW, upgrade);
  await upgrading.modify(async (m) => m.disableRetryDelays());
  await env.PROJECT_UPGRADE_WORKFLOW.create({
    id: upgrade,
    params: {
      provider: "cloudflare-artifacts",
      providerData: { namespace: "projects" },
      event: { type: "push" },
      owner: "projects",
      repo,
      sha: main!.oid,
      remote: "cloudflare",
      trigger: "push",
      ref: "refs/heads/main",
      branch: "main",
      camoxVersion: "1.1.0",
      upgradeInstanceId: crypto.randomUUID(),
    } as never,
  });
  return upgrading;
}

/** Waits until the project's Upgrade built, and is ready to push. */
async function readyToPush(repo: string) {
  await vi.waitFor(
    async () => {
      const built = await fakes.commandsRun(repo);
      expect(built.some(({ command }) => command.includes("camox release --dry-run"))).toBe(true);
    },
    { timeout: 10_000, interval: 50 },
  );
}

/** The order of the project's Upgrade's push to `main` among the fakes' commands. */
async function upgradePushOrder(repo: string) {
  const push = (await fakes.commandsRun(repo)).find(({ command }) =>
    command.includes("HEAD:refs/heads/main"),
  );
  return push!.order;
}

/** The `camox` version `main`'s `package.json` asks for. */
async function camoxOnMain(repo: string) {
  const manifest = JSON.parse((await fakes.readFile(repo, "main", "package.json"))!);
  return manifest.dependencies.camox as string;
}

describe("publishing a draft with code", () => {
  it("puts the previewed build, the draft's definitions and content on Live, and its tree on main", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId, file } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    const mainBefore = await fakes.log(repo);
    const releaseCommandsBefore = (await fakes.commandsRun(repo)).length;
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ publishing: false });

    await using publishes = await watchPublishes();
    expect(await publish(website, draftId, preview)).toMatchObject({ publishing: true });
    await publishesEnd(publishes);

    expect(await fakes.servedVersion(repo)).toMatchObject({ build: await lastBuildOf(draftId) });
    expect(await pagesOf(website)).toEqual({ "/home": [HELLO, PRICING] });
    expect(await liveBlockTypes(website)).toEqual(["pricing", "text"]);
    expect(await draftsOf(website)).toEqual([]);
    expect(sentTo(website.project.id)).toContainEqual(
      expect.objectContaining({ type: "draftEnded", draftId, outcome: "published" }),
    );

    const mainAfter = await fakes.log(repo);
    expect(mainAfter.length).toBe(mainBefore.length + 1);
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).toBe(file);
    expect(await fakes.readFile(repo, "main", "src/blocks/text.tsx")).toBe(
      `export const text = "text";\n`,
    );
    // The push of the tree Live serves releases nothing.
    await deliverPushes(repo);
    expect((await fakes.commandsRun(repo)).length).toBe(releaseCommandsBefore);
  });

  it("lets the uploaded version read Live overlaid with the draft while it publishes", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    const publishing = { [PUBLISHING_DRAFT_HEADER]: draftId };
    // Not publishing yet: a read naming the draft without a session is Live's.
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO] });

    await fakes.holdPublishCommand(repo, "versions deploy");
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await ran(repo, "versions deploy");

    const [uploaded] = await fakes.workerVersions(repo).then((versions) => versions.slice(-1));
    expect(uploaded!.vars).toEqual({ CAMOX_PUBLISHING_DRAFT: draftId });
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO, PRICING] });
    expect(await publicPagesOf(website)).toEqual({ "/home": [HELLO] });
    expect(await pagesOf(website)).toEqual({ "/home": [HELLO] });

    await fakes.letGoPublishCommand(repo, "versions deploy");
    await publishesEnd(publishes);
    // The draft ended: reads naming it are Live's, which now holds what it published.
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO, PRICING] });
  });

  it("is refused once the agent left a revision after the review", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const reviewed = await previewOf(website, draftId);
    await changeCodeAgain(website, token, draftId);

    await expect(publish(website, draftId, reviewed)).rejects.toMatchObject({
      code: REVISION_CHANGED_ERROR,
    });
    expect((await previewOf(website, draftId)).code).toMatchObject({ publishing: false });
    expect(await fakes.publishCommands(website.project.uuid)).toEqual([]);
  });

  it("goes back to the review when the agent leaves a revision while it waits", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId: first } = await draftAddingPricing(website, token);
    const second = await draftChangingCode(website, token);
    const repo = website.project.uuid;
    await fakes.holdPublishCommand(repo, "versions upload");
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await ran(repo, "versions upload");
    await publish(website, second, await previewOf(website, second));
    expect((await previewOf(website, second)).code).toMatchObject({ publishing: true });

    await changeCodeAgain(website, token, second);
    await fakes.letGoPublishCommand(repo, "versions upload");
    await publishesEnd(publishes);

    expect((await previewOf(website, second)).code).toMatchObject({
      publishing: false,
      publishAborted: "revisionChanged",
    });
    expect(await commandsLike(repo, `draft ${second}`)).toEqual([]);
  });

  it("runs a project's publishes one after the other, the second shipping its merge of the first", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId: first, file } = await draftAddingPricing(website, token);
    const second = await draftChangingCode(website, token);
    const changed = await fakes.readFile(website.project.uuid, second, "src/blocks/text.tsx");
    const repo = website.project.uuid;
    await fakes.holdPublishCommand(repo, "versions upload");
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await ran(repo, "versions upload");
    await publish(website, second, await previewOf(website, second));
    const mainBefore = await fakes.log(repo);
    await fakes.letGoPublishCommand(repo, "versions upload");

    // The first lands, moving `main`: the second waits for the draft to merge it.
    await vi.waitFor(
      async () => expect(await fakes.log(repo)).toHaveLength(mainBefore.length + 1),
      {
        timeout: 10_000,
        interval: 50,
      },
    );
    expect(await commandsLike(repo, `draft ${second}`)).toEqual([]);
    await deliverPushes(repo);
    await publishesEnd(publishes);

    // It shipped the merge revision's build: both drafts' code, on Live and on `main`.
    const [merge] = (await fakes.revisionBuilds(second)).slice(-1);
    expect(merge!.files).toMatchObject({
      "src/blocks/pricing.tsx": file,
      "src/blocks/text.tsx": changed,
    });
    expect(await fakes.servedVersion(repo)).toMatchObject({ build: await lastBuildOf(second) });
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).toBe(file);
    expect(await fakes.readFile(repo, "main", "src/blocks/text.tsx")).toBe(changed);
    expect(await draftsOf(website)).toEqual([]);
  });

  it("goes back to the review with the new conflicts when they change before promotion", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    await writeHello(website, "Hello there", draftId);
    const repo = website.project.uuid;
    const served = await fakes.servedVersion(repo);
    const reviewed = await previewOf(website, draftId);
    expect(reviewed.conflicts).toEqual([]);
    await fakes.holdPublishCommand(repo, "versions upload");
    await using publishes = await watchPublishes();
    await publish(website, draftId, reviewed);
    await ran(repo, "versions upload");

    await writeHello(website, "Hi");
    await fakes.letGoPublishCommand(repo, "versions upload");
    await publishesEnd(publishes);

    expect(await fakes.servedVersion(repo)).toEqual(served);
    expect(await commandsLike(repo, "versions deploy")).toEqual([]);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ publishing: false, publishAborted: "conflictsChanged" });
    expect(preview.conflicts).toEqual([expect.objectContaining({ entity: "block" })]);
    expect(await pagesOf(website)).toEqual({ "/home": ["<!-- Text -->\nHi"] });
  });

  it("puts the previous version back when the batch aborts after promotion, and leaves main", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    await writeHello(website, "Hello there", draftId);
    const repo = website.project.uuid;
    const served = await fakes.servedVersion(repo);
    const mainBefore = await fakes.log(repo);
    await fakes.holdPublishCommand(repo, "versions deploy");
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await ran(repo, "versions deploy");

    await writeHello(website, "Hi");
    await fakes.letGoPublishCommand(repo, "versions deploy");
    await publishesEnd(publishes);

    const deployments = await fakes.deployments(repo);
    expect(deployments.slice(-2)).toEqual([expect.not.stringMatching(served!.id), served!.id]);
    expect(await fakes.servedVersion(repo)).toEqual(served);
    expect(await fakes.log(repo)).toEqual(mainBefore);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ publishing: false, publishAborted: "conflictsChanged" });
    expect(preview.conflicts).toEqual([expect.objectContaining({ entity: "block" })]);
    expect(await pagesOf(website)).toEqual({ "/home": ["<!-- Text -->\nHi"] });
    expect(await liveBlockTypes(website)).toEqual(["text"]);
  });

  it("holds an Upgrade's push to main until the project's publish pushed, keeping both", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId, file } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    await fakes.holdPublishCommand(repo, "versions upload");
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await ran(repo, "versions upload");

    await using upgrading = await startUpgrade(repo);
    await readyToPush(repo);
    await fakes.letGoPublishCommand(repo, "versions upload");
    await publishesEnd(publishes);
    await upgrading.waitForStatus("complete");

    const published = Math.max(...(await fakes.publishCommands(repo)).map(({ order }) => order));
    expect(await upgradePushOrder(repo)).toBeGreaterThan(published);
    // The Upgrade's commit sits on the publish's: `main` has both changes.
    const [upgraded, publishedCommit] = await fakes.log(repo);
    expect(upgraded!.message).toBe("Upgrade Camox to 1.1.0");
    expect(publishedCommit!.message).toMatch(/^Publish/);
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).toBe(file);
    expect(await camoxOnMain(repo)).toBe("^1.1.0");
  });

  it("holds a publish asked for after an Upgrade waiting to push, which then ships over it", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId: first } = await draftAddingPricing(website, token);
    const second = await draftChangingCode(website, token);
    const changed = await fakes.readFile(website.project.uuid, second, "src/blocks/text.tsx");
    const repo = website.project.uuid;
    await fakes.holdPublishCommand(repo, "versions upload");
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await ran(repo, "versions upload");
    await using upgrading = await startUpgrade(repo);
    await readyToPush(repo);
    await publish(website, second, await previewOf(website, second));

    await fakes.letGoPublishCommand(repo, "versions upload");
    // The Upgrade pushes before the second publish does anything.
    await upgrading.waitForStatus("complete");
    expect(await commandsLike(repo, `draft ${second}`)).toEqual([]);
    expect(await camoxOnMain(repo)).toBe("^1.1.0");

    // The second ships its merge of the upgraded `main`, once that released.
    await deliverPushes(repo);
    await publishesEnd(publishes);
    const [served] = (await fakes.deployments(repo)).slice(-1);
    expect(await fakes.servedVersion(repo)).toMatchObject({
      id: served,
      build: await lastBuildOf(second),
    });
    expect(await fakes.readFile(repo, "main", "src/blocks/text.tsx")).toBe(changed);
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).not.toBeNull();
    expect(await camoxOnMain(repo)).toBe("^1.1.0");
  });

  it("deletes the draft's branch, builds, working copy and sandbox once it lands", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    expect(await fakes.branches(repo)).toContain(draftId);
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await publishesEnd(publishes);

    expect(await fakes.branches(repo)).toEqual(["main"]);
    const builds = await env.REVISION_BUILDS.list({ prefix: `${repo}/${draftId}/` });
    expect(builds.objects).toEqual([]);
    expect(await env.DRAFT_CODE.getByName(draftId).held()).toBe(false);
    expect(await fakes.sandboxDestroyed(draftId)).toBe(true);
  });
});
