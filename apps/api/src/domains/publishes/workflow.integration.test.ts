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
import { env, exports } from "cloudflare:workers";
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
  holdNextAnswer,
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
import { drafts } from "../drafts/schema";
import { revisions } from "../revisions/schema";
import { PUBLISHES_CHECKED_EVERY } from "../upgrades/project-workflow";
import { publishScriptsTag } from "./scripts";
import { INFRASTRUCTURE_RETRIES } from "./workflow";

/** How many times a publish's step that fails on Camox's side runs before it gives up. */
const STEP_ATTEMPTS = Number(INFRASTRUCTURE_RETRIES.retries!.limit) + 1;

// Publishing a draft with code (spec #560, section 13): the publish Workflow uploads the build of
// the revision members previewed as a user Worker of its own, re-checks conflicts, points Live at
// it, runs the publish batch with the draft's definitions, records the tree Live serves, pushes
// that tree to `main` and deletes the draft's code. The Cloudflare API, the sandboxes and
// Artifacts are faked at their edges (test/release-fakes.js, test/fake-cloudflare-api.ts). What
// serves a website is what dispatch asks the API's `CamoxPreviews` entrypoint.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type UserWorker = {
  name: string;
  metadata: Record<string, unknown> | null;
  modules: Record<string, { type: string; text: string }>;
  assets: Record<string, { contentType: string; text: string }>;
  tags: string[];
};

type Fakes = {
  defineBuildsOf(marker: string, definitionSet: unknown): Promise<void>;
  configureBuildsOf(marker: string, config: Record<string, unknown>): Promise<void>;
  revisionBuilds(
    sandbox: string,
  ): Promise<{ files: Record<string, string>; archive: number[] | null; build?: string }[]>;
  userWorker(name: string): Promise<UserWorker | null>;
  userWorkersOf(project: string): Promise<string[]>;
  cloudflareCalls(project: string): Promise<{ call: string; order: number }[]>;
  failCloudflareCalls(
    project: string,
    pattern: string,
    times: number,
    landing?: boolean,
  ): Promise<void>;
  holdCloudflareCalls(project: string, pattern: string): Promise<void>;
  letGoCloudflareCalls(project: string, pattern: string): Promise<void>;
  holdBuilds(sandbox: string): Promise<void>;
  releaseBuilds(sandbox: string): Promise<void>;
  mostBuildsAtOnce(sandbox: string): Promise<number>;
  failPushes(repo: string, branch: string, times: number): Promise<void>;
  holdPushes(repo: string, branch: string): Promise<void>;
  letGoPushes(repo: string, branch: string): Promise<void>;
  pushesWaiting(repo: string): Promise<number>;
  commandsRun(repo: string): Promise<{ command: string; order: number }[]>;
  log(repo: string): Promise<{ oid: string; message: string }[]>;
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
  branches(repo: string): Promise<string[]>;
  sandboxDestroyed(sandbox: string): Promise<boolean>;
};

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;
const previews = (
  exports as unknown as {
    CamoxPreviews: { liveScript(question: { project: string }): Promise<string | null> };
  }
).CamoxPreviews;

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

type Modifier = Parameters<
  Parameters<Awaited<ReturnType<typeof introspectWorkflow>>["modifyAll"]>[0]
>[0];

/**
 * Starts watching the publishes started from now on, with their retries' delays disabled, and
 * their sleeps unless `sleeps`: a publish waits for dispatch to serve the script it pointed Live
 * at before its batch, the moment a test can change Live's content in.
 */
async function watchPublishes({
  sleeps = false,
  modify,
}: { sleeps?: boolean; modify?: (m: Modifier) => Promise<void> } = {}) {
  const publishes = await introspectWorkflow(env.PUBLISH_WORKFLOW);
  await publishes.modifyAll(async (m) => {
    await m.disableRetryDelays();
    if (!sleeps) await m.disableSleeps();
    await modify?.(m);
  });
  return publishes;
}

type Publishes = Awaited<ReturnType<typeof watchPublishes>>;

/** Waits for every publish started since `watchPublishes` to end as `status`. */
async function publishesEnd(publishes: Publishes, status: "complete" | "errored" = "complete") {
  for (const instance of await publishes.get()) await instance.waitForStatus(status);
}

/** The build a draft's revision sandbox made last, which the fake names in its main module. */
async function lastBuildOf(draftId: string) {
  const builds = await fakes.revisionBuilds(draftId);
  return builds.findLast((build) => build.archive)!.build!;
}

/** The plain text bindings a user Worker was uploaded with. */
const varsOf = (worker: UserWorker) =>
  Object.fromEntries(
    ((worker.metadata?.bindings ?? []) as { type: string; name: string; text: string }[])
      .filter(({ type }) => type === "plain_text")
      .map(({ name, text }) => [name, text]),
  );

/**
 * The user Worker serving the website, as dispatch finds it: the one the API names, or the one
 * named after the Project ID. With the build its main module names, and its variables.
 */
async function served({ project }: Website) {
  const name = (await previews.liveScript({ project: project.uuid })) ?? project.uuid;
  const worker = await fakes.userWorker(name);
  if (!worker) return null;
  const main = (worker.metadata?.main_module as string | undefined) ?? "index.js";
  const build = /^\/\/ (.*)$/m.exec(worker.modules[main]?.text ?? "")?.[1];
  return { name, build, vars: varsOf(worker) };
}

/** Whether the website is served by a publish's own user Worker. */
async function servedByAPublish(website: Website) {
  return (await served(website))?.name !== website.project.uuid;
}

/** Waits until the publish pointed Live at its user Worker. */
async function promoted(website: Website) {
  await vi.waitFor(async () => expect(await servedByAPublish(website)).toBe(true), {
    timeout: 10_000,
    interval: 20,
  });
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
 * sees them, with no session: as a Worker of the project reads them.
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

/** A publish's upload of its user Worker, as its call to the Cloudflare API names it. */
const UPLOAD = (project: string) => `PUT ${project}-publish-`;

/** Waits until a project called the Cloudflare API with a call containing `pattern`. */
async function called(project: string, pattern: string) {
  await vi.waitFor(
    async () => {
      const calls = await fakes.cloudflareCalls(project);
      expect(calls.some(({ call }) => call.includes(pattern))).toBe(true);
    },
    { timeout: 10_000, interval: 50 },
  );
}

/** How many publish uploads the project made. */
async function uploadsOf(project: string) {
  return (await fakes.cloudflareCalls(project)).filter(({ call }) => call.includes(UPLOAD(project)))
    .length;
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

    expect(await served(website)).toMatchObject({ build: await lastBuildOf(draftId) });
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

  it("uploads the build's modules and assets, with the platform's settings, never the build's", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await publishesEnd(publishes);

    const worker = (await fakes.userWorker((await served(website))!.name))!;
    expect(Object.keys(worker.modules).sort()).toEqual(["assets/chunk.js", "index.js"]);
    expect(worker.modules["index.js"]!.type).toBe("application/javascript+module");
    expect(worker.metadata).toMatchObject({
      main_module: "index.js",
      compatibility_date: "2026-04-11",
      compatibility_flags: ["nodejs_compat"],
      bindings: [{ type: "plain_text", name: "CAMOX_PUBLISHING_DRAFT", text: draftId }],
      assets: {
        config: {
          _headers: "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
        },
      },
    });
    expect(Object.keys(worker.metadata!).sort()).toEqual([
      "assets",
      "bindings",
      "compatibility_date",
      "compatibility_flags",
      "main_module",
      "tags",
    ]);
    expect(Object.keys(worker.assets).sort()).toEqual([
      "/assets/index.css",
      "/favicon.svg",
      "/robots.txt",
    ]);
    expect(worker.assets["/assets/index.css"]).toEqual({
      contentType: "text/css; charset=utf-8",
      text: `body { /* ${await lastBuildOf(draftId)} */ }\n`,
    });
    expect(worker.tags).toEqual([publishScriptsTag(website.project.uuid)]);
  });

  it("doesn't publish a build asking for compatibility flags Camox doesn't allow", async () => {
    const { website, token } = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.configureBuildsOf(marker, {
      compatibility_flags: ["nodejs_compat", "experimental"],
    });
    const thread = await connectLiveThread(website.project.id, token);
    answerWithToolCall("write", { path: "src/blocks/text.tsx", content: `// ${marker}\n` });
    answerWithToolCall("build", {});
    answerFrom(() => "Changed it.");
    await ask(thread, "Change the text block's code");
    const [draft] = await draftsOf(website);
    const before = await served(website);

    await using publishes = await watchPublishes();
    await publish(website, draft!.id, await previewOf(website, draft!.id));
    await publishesEnd(publishes, "errored");

    expect(await uploadsOf(website.project.uuid)).toBe(0);
    expect(await served(website)).toEqual(before);
    expect((await previewOf(website, draft!.id)).code).toMatchObject({
      publishing: false,
      publishAborted: "failed",
    });
  });

  it("lets the uploaded Worker read Live overlaid with the draft while it publishes", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const publishing = { [PUBLISHING_DRAFT_HEADER]: draftId };
    // Not publishing yet: a read naming the draft without a session is Live's.
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO] });

    // The publish waits for dispatch to serve its Worker before its batch.
    await using publishes = await watchPublishes({ sleeps: true });
    await publish(website, draftId, await previewOf(website, draftId));
    await promoted(website);

    expect((await served(website))!.vars).toEqual({ CAMOX_PUBLISHING_DRAFT: draftId });
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO, PRICING] });
    expect(await publicPagesOf(website)).toEqual({ "/home": [HELLO] });
    expect(await pagesOf(website)).toEqual({ "/home": [HELLO] });

    await publishesEnd(publishes);
    // The draft ended: reads naming it are Live's, which now holds what it published.
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO, PRICING] });
  });

  it("keeps reads naming the draft on Live's until the promotion", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    const publishing = { [PUBLISHING_DRAFT_HEADER]: draftId };
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await called(repo, UPLOAD(repo));

    // Publishing, but nothing reads the draft yet.
    expect(await publicPagesOf(website, publishing)).toEqual({ "/home": [HELLO] });
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    await publishesEnd(publishes);
  });

  it("refuses edits to the draft's content while it publishes", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await called(repo, UPLOAD(repo));

    await expect(writeHello(website, "Hello there", draftId)).rejects.toMatchObject({
      message: expect.stringContaining("being published"),
    });
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    await publishesEnd(publishes);
    expect(await pagesOf(website)).toEqual({ "/home": [HELLO, PRICING] });
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
    expect(await uploadsOf(website.project.uuid)).toBe(0);
  });

  it("goes back to the review when the agent leaves a revision while it waits", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId: first } = await draftAddingPricing(website, token);
    const second = await draftChangingCode(website, token);
    const repo = website.project.uuid;
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await called(repo, UPLOAD(repo));
    await publish(website, second, await previewOf(website, second));
    expect((await previewOf(website, second)).code).toMatchObject({ publishing: true });

    await changeCodeAgain(website, token, second);
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    await publishesEnd(publishes);

    expect((await previewOf(website, second)).code).toMatchObject({
      publishing: false,
      publishAborted: "revisionChanged",
    });
    // Only the first uploaded.
    expect(await uploadsOf(repo)).toBe(1);
  });

  it("runs a project's publishes one after the other, the second shipping its merge of the first", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId: first, file } = await draftAddingPricing(website, token);
    const second = await draftChangingCode(website, token);
    const changed = await fakes.readFile(website.project.uuid, second, "src/blocks/text.tsx");
    const repo = website.project.uuid;
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await called(repo, UPLOAD(repo));
    await publish(website, second, await previewOf(website, second));
    const mainBefore = await fakes.log(repo);
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));

    // The first lands, moving `main`: the second waits for the draft to merge it.
    await vi.waitFor(
      async () => expect(await fakes.log(repo)).toHaveLength(mainBefore.length + 1),
      {
        timeout: 10_000,
        interval: 50,
      },
    );
    expect(await uploadsOf(repo)).toBe(1);
    await deliverPushes(repo);
    await publishesEnd(publishes);

    // It shipped the merge revision's build: both drafts' code, on Live and on `main`.
    const [merge] = (await fakes.revisionBuilds(second)).slice(-1);
    expect(merge!.files).toMatchObject({
      "src/blocks/pricing.tsx": file,
      "src/blocks/text.tsx": changed,
    });
    expect(await served(website)).toMatchObject({ build: await lastBuildOf(second) });
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).toBe(file);
    expect(await fakes.readFile(repo, "main", "src/blocks/text.tsx")).toBe(changed);
    expect(await draftsOf(website)).toEqual([]);
    // The first's Worker is deleted: nothing rolls back to it anymore.
    expect(await fakes.userWorkersOf(repo)).toEqual([repo, (await served(website))!.name]);
  });

  it("goes back to the draft with the blocker when the merge it waits for clashes", async () => {
    const { website, token } = await websiteWithCode();
    // Both drafts change the text block's code: the second's merge of the first conflicts.
    const first = await draftChangingCode(website, token);
    const second = await draftChangingCode(website, token);
    const repo = website.project.uuid;
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await called(repo, UPLOAD(repo));
    await publish(website, second, await previewOf(website, second));
    const mainBefore = await fakes.log(repo);
    // Camox's reconcile turn starts, and is still working when the publish ends.
    holdNextAnswer("Reconciled.");
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    await vi.waitFor(
      async () => expect(await fakes.log(repo)).toHaveLength(mainBefore.length + 1),
      { timeout: 10_000, interval: 50 },
    );

    await deliverPushes(repo);
    await publishesEnd(publishes);

    const preview = await previewOf(website, second);
    expect(preview.code).toMatchObject({ publishing: false, publishAborted: "codeDoesNotMerge" });
    expect(preview.blockers).toEqual([
      expect.objectContaining({ entity: "code", code: "codeDoesNotMerge" }),
    ]);
    expect(await uploadsOf(repo)).toBe(1);
    expect((await draftsOf(website)).map(({ id }) => id)).toEqual([second]);
  });

  it("goes back to the review with the new conflicts when they change before promotion", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    await writeHello(website, "Hello there", draftId);
    const repo = website.project.uuid;
    const before = await served(website);
    const reviewed = await previewOf(website, draftId);
    expect(reviewed.conflicts).toEqual([]);
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, draftId, reviewed);
    await called(repo, UPLOAD(repo));

    await writeHello(website, "Hi");
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    await publishesEnd(publishes);

    expect(await served(website)).toEqual(before);
    // The publish's Worker, which never served, is deleted.
    expect(await fakes.userWorkersOf(repo)).toEqual([repo]);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ publishing: false, publishAborted: "conflictsChanged" });
    expect(preview.conflicts).toEqual([expect.objectContaining({ entity: "block" })]);
    expect(await pagesOf(website)).toEqual({ "/home": ["<!-- Text -->\nHi"] });
  });

  it("points Live back at the previous Worker when the batch aborts after promotion, and leaves main", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    await writeHello(website, "Hello there", draftId);
    const repo = website.project.uuid;
    const before = await served(website);
    const mainBefore = await fakes.log(repo);
    await using publishes = await watchPublishes({ sleeps: true });
    await publish(website, draftId, await previewOf(website, draftId));
    await promoted(website);

    await writeHello(website, "Hi");
    await publishesEnd(publishes);

    expect(await served(website)).toEqual(before);
    expect(await fakes.userWorkersOf(repo)).toEqual([repo]);
    expect(await fakes.log(repo)).toEqual(mainBefore);
    const preview = await previewOf(website, draftId);
    expect(preview.code).toMatchObject({ publishing: false, publishAborted: "conflictsChanged" });
    expect(preview.conflicts).toEqual([expect.objectContaining({ entity: "block" })]);
    expect(await pagesOf(website)).toEqual({ "/home": ["<!-- Text -->\nHi"] });
    expect(await liveBlockTypes(website)).toEqual(["text"]);
  });

  it("points Live back at the previous Worker when the publish fails after promotion", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    const before = await served(website);
    const mainBefore = await fakes.log(repo);
    // Every try of the batch fails, as when D1 is down.
    await using publishes = await watchPublishes({
      modify: (m) => m.mockStepError({ name: "run the publish batch" }, new Error("D1 is down")),
    });
    await publish(website, draftId, await previewOf(website, draftId));
    await publishesEnd(publishes, "errored");

    expect(await served(website)).toEqual(before);
    expect(await fakes.userWorkersOf(repo)).toEqual([repo]);
    expect(await fakes.log(repo)).toEqual(mainBefore);
    expect(await pagesOf(website)).toEqual({ "/home": [HELLO] });
    expect((await previewOf(website, draftId)).code).toMatchObject({
      publishing: false,
      publishAborted: "failed",
    });
  });

  it("keeps trying to point Live back at the previous Worker when the batch aborts", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    await writeHello(website, "Hello there", draftId);
    const before = await served(website);
    await using publishes = await watchPublishes({
      sleeps: true,
      modify: (m) =>
        m.mockStepError(
          { name: "point Live back at the previous script" },
          new Error("D1 is down"),
          STEP_ATTEMPTS,
        ),
    });
    await publish(website, draftId, await previewOf(website, draftId));
    await promoted(website);

    await writeHello(website, "Hi");
    await publishesEnd(publishes);

    expect(await served(website)).toEqual(before);
    expect((await previewOf(website, draftId)).code).toMatchObject({
      publishing: false,
      publishAborted: "conflictsChanged",
    });
  });

  it("publishes once when the upload's answer is lost", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    // The upload lands, but its answer is lost: the step uploads again.
    await fakes.failCloudflareCalls(repo, UPLOAD(repo), 1, true);
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await publishesEnd(publishes);

    expect(await uploadsOf(repo)).toBe(2);
    expect(await served(website)).toMatchObject({ build: await lastBuildOf(draftId) });
    expect(await fakes.userWorkersOf(repo)).toEqual([repo, (await served(website))!.name]);
  });

  it("pushes to main and deletes the draft's code once it published, however often that fails", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId, file } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    await fakes.failPushes(repo, "main", STEP_ATTEMPTS);
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await publishesEnd(publishes);

    expect(await pagesOf(website)).toEqual({ "/home": [HELLO, PRICING] });
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).toBe(file);
    expect(await fakes.branches(repo)).toEqual(["main"]);
    expect(await env.DRAFT_CODE.getByName(draftId).held()).toBe(false);
  });

  it("holds an Upgrade's push to main until the project's publish pushed, keeping both", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId, file } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await called(repo, UPLOAD(repo));

    await using upgrading = await startUpgrade(repo);
    await readyToPush(repo);
    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    await publishesEnd(publishes);
    await upgrading.waitForStatus("complete");

    const [upload] = (await fakes.cloudflareCalls(repo)).filter(({ call }) =>
      call.includes(UPLOAD(repo)),
    );
    expect(await upgradePushOrder(repo)).toBeGreaterThan(upload!.order);
    // The Upgrade's commit sits on the publish's: `main` has both changes.
    const [upgraded, publishedCommit] = await fakes.log(repo);
    expect(upgraded!.message).toBe("Upgrade Camox to 1.1.0");
    expect(publishedCommit!.message).toMatch(/^Publish/);
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).toBe(file);
    expect(await camoxOnMain(repo)).toBe("^1.1.0");
  });

  it("holds an Upgrade's push to main while the project's publish, batch committed, still pushes", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId, file } = await draftAddingPricing(website, token);
    const repo = website.project.uuid;
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await fakes.holdPushes(repo, "main");
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await called(repo, UPLOAD(repo));
    await using upgrading = await startUpgrade(repo);
    await readyToPush(repo);

    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    // The batch committed, and the publish's push to `main` waits: the Upgrade checks its turn
    // meanwhile.
    await vi.waitFor(async () => expect(await fakes.pushesWaiting(repo)).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });
    expect(await draftsOf(website)).toEqual([]);
    await new Promise((resolve) =>
      setTimeout(resolve, 2 * parseFloat(PUBLISHES_CHECKED_EVERY) * 1000),
    );
    await fakes.letGoPushes(repo, "main");
    await publishesEnd(publishes);
    await upgrading.waitForStatus("complete");

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
    await fakes.holdCloudflareCalls(repo, UPLOAD(repo));
    await using publishes = await watchPublishes();
    await publish(website, first, await previewOf(website, first));
    await called(repo, UPLOAD(repo));
    await using upgrading = await startUpgrade(repo);
    await readyToPush(repo);
    await publish(website, second, await previewOf(website, second));

    await fakes.letGoCloudflareCalls(repo, UPLOAD(repo));
    // The Upgrade pushes before the second publish does anything.
    await upgrading.waitForStatus("complete");
    expect(await uploadsOf(repo)).toBe(1);
    expect(await camoxOnMain(repo)).toBe("^1.1.0");

    // The second ships its merge of the upgraded `main`, once that released.
    await deliverPushes(repo);
    await publishesEnd(publishes);
    expect(await served(website)).toMatchObject({ build: await lastBuildOf(second) });
    expect(await fakes.readFile(repo, "main", "src/blocks/text.tsx")).toBe(changed);
    expect(await fakes.readFile(repo, "main", "src/blocks/pricing.tsx")).not.toBeNull();
    expect(await camoxOnMain(repo)).toBe("^1.1.0");
  });

  it("builds a head whose build is gone again in the draft's build queue, never beside another", async () => {
    const { website, token } = await websiteWithCode();
    const { draftId } = await draftAddingPricing(website, token);
    // The head's build is gone, as when its archive was lost.
    const head = await website.db
      .select({ id: revisions.id, archiveKey: revisions.archiveKey })
      .from(revisions)
      .innerJoin(drafts, eq(drafts.headRevisionId, revisions.id))
      .where(eq(drafts.id, draftId))
      .get();
    await env.REVISION_BUILDS.delete(head!.archiveKey!);
    await website.db.update(revisions).set({ archiveKey: null }).where(eq(revisions.id, head!.id));
    await fakes.holdBuilds(draftId);
    await using publishes = await watchPublishes();
    await publish(website, draftId, await previewOf(website, draftId));
    await vi.waitFor(async () => expect(await fakes.mostBuildsAtOnce(draftId)).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });

    // The agent builds a change while the publish's build runs.
    const thread = await connectDraftThread(website.project.id, draftId, token);
    answerWithToolCall("write", {
      path: "src/blocks/text.tsx",
      content: `export const text = "x";\n`,
    });
    answerWithToolCall("build", {});
    answerFrom(() => "Changed it.");
    const asked = ask(thread, "Change the text block's code");
    await expect(
      vi.waitFor(async () => expect(await fakes.mostBuildsAtOnce(draftId)).toBe(2), {
        timeout: 2_000,
        interval: 50,
      }),
    ).rejects.toThrow();
    await fakes.releaseBuilds(draftId);
    await asked;
    await publishesEnd(publishes);

    expect(await fakes.mostBuildsAtOnce(draftId)).toBe(1);
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
