import { LOOK_TOKEN_COOKIE, UNPLACED_BLOCK_ID } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { browserRunFakes } from "../../../test/browser-run";
import { createRpcContext, startDraft, syncDefinitionSet } from "../../../test/fixtures";
import { PRICING, revisionFakes, websiteWithCode } from "../../../test/revision-builds";
import {
  answerFrom,
  answerNext,
  answerWithToolCall,
  forgetThreadModel,
  type ModelRequest,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  lastAnswer,
  signIn,
  textDefinition,
  type ThreadClient,
  type Website,
} from "../../../test/threads";
import { verifyLookToken } from "../drafts/look-token";
import { layoutProcedures } from "../layouts/routes";
import { pageProcedures } from "../pages/routes";
import { END_OF_TURN_BUILD_FAILURES } from "../revisions/end-of-turn";
import { LOOK_IMAGE_CAP, LOOK_MAX_DELAY_MS, LOOK_MAX_URL_LENGTH } from "./look";

// The agent's `look`, driven through a draft thread's socket by the scripted model. Browser Run
// is the release fakes Worker's fake, which records each capture and answers it with one image.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

vi.mock("./browser-run", async () => {
  const { fakeBrowserRun } = await import("../../../test/browser-run");
  return { browserRun: fakeBrowserRun };
});

type DefinitionFakes = { defineBuildsOf(marker: string, definitionSet: unknown): Promise<void> };

const definitionFakes = (env as unknown as { RELEASE_FAKES: DefinitionFakes }).RELEASE_FAKES;

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** The website's Definition Set as its code gives it: the text block, and `blocks` if given. */
const definitionSetWith = (website: Website, blocks: unknown = []) => ({
  blocks: Array.isArray(blocks) ? [textDefinition, ...blocks] : blocks,
  layouts: [{ layoutId: website.layout.layoutId, description: "Default", blocks: [] }],
  collections: [],
  homepage: null,
});

/** A file the fake sandbox builds into the Definition Set a test scripted for `marker`. */
const markedFile = (marker: string) => `export const block = "built"; // ${marker}\n`;

/** A website with code on `main` and a draft of it, with the draft's thread open. */
async function draftThread() {
  const website = await websiteWithCode();
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(
    website.project.id,
    draftId,
    await signIn(website.db, website.memberUser.id),
  );
  return { website, draftId, thread, host: `${website.project.slug}.camox.site` };
}

/** What `look` answered the model: one entry per target and size, and the images it read. */
type Looked = { results: Record<string, unknown>[]; images: ModelRequest["lastToolImages"] };

/**
 * Has the agent call `look` with `args` after `before` scripted its earlier calls of the turn,
 * returning what `look` answered it. The agent then ends its turn, `after` scripting what it does
 * if the end of the turn sends it back to work.
 */
async function look(
  thread: ThreadClient,
  args: Parameters<typeof answerWithToolCall>[1],
  { before = () => {}, after = () => {} }: { before?: () => void; after?: () => void } = {},
): Promise<Looked & { text: string }> {
  let seen: ModelRequest | undefined;
  before();
  answerWithToolCall("look", args);
  answerFrom((request) => {
    seen = request;
    return "Done.";
  });
  after();
  await ask(thread, "Look at it", { keepOpen: true });
  const text = seen!.lastToolResult;
  return {
    text,
    results: text
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>),
    images: seen!.lastToolImages,
  };
}

/** The ID of the first Placement on the website's page at `path`, as the studio reads it. */
async function placementOn({ db, memberUser, project }: Website, path: string) {
  const { page } = await call(
    pageProcedures.getStructure,
    { projectUuid: project.uuid, path },
    { context: createRpcContext(db, memberUser) },
  );
  return page.blockIds[0]!;
}

const pathOf = (url: string) => new URL(url).searchParams.get("path");

/** A Block Definition with a Settings Schema, beside the website's text block. */
const heroDefinition = {
  blockId: "hero",
  title: "Hero",
  description: "A hero",
  contentSchema: {
    type: "object",
    properties: { title: { type: "string", fieldType: "String", default: "Welcome" } },
  },
  settingsSchema: {
    type: "object",
    properties: { colorScheme: { type: "string", enum: ["light", "dark"], default: "light" } },
  },
};

/** A draft thread of a website whose code defines `heroDefinition`, unplaced. */
async function draftThreadWithHero() {
  const opened = await draftThread();
  await syncDefinitionSet(opened.website.db, opened.website.project, {
    blocks: [textDefinition, heroDefinition],
  });
  return opened;
}

describe("the agent's look", () => {
  it("returns an image for each page target and size, which the model reads as image content", async () => {
    const { draftId, thread } = await draftThread();

    const { results, images } = await look(thread, {
      targets: [{ path: "/home" }, { path: "/home", sizes: ["mobile"] }],
    });
    thread.close();

    expect(results).toEqual([
      { path: "/home", size: "desktop" },
      { path: "/home", size: "mobile" },
      { path: "/home", size: "mobile" },
    ]);
    const image = { data: await browserRunFakes.capturedImage(), mimeType: "image/jpeg" };
    expect(images).toEqual([image, image, image]);
    const captures = await browserRunFakes.captures(draftId);
    expect(captures.map(({ url, size }) => [pathOf(url), size])).toEqual([
      ["/home", "desktop"],
      ["/home", "mobile"],
      ["/home", "mobile"],
    ]);
  });

  it("gives the browser a look token for the thread's draft, as a cookie for the website's host only", async () => {
    const { website, draftId, thread, host } = await draftThread();

    await look(thread, { targets: [{ path: "/home", sizes: ["desktop"] }] });
    thread.close();

    const [capture, ...others] = await browserRunFakes.captures(draftId);
    expect(others).toEqual([]);
    expect(new URL(capture!.url).host).toBe(host);
    expect(capture!.cookie).toEqual({ name: LOOK_TOKEN_COOKIE, value: expect.any(String), host });
    expect(await verifyLookToken(env, capture!.cookie.value)).toEqual({
      projectId: website.project.id,
      draftId,
    });
  });

  it("returns a failing target's own error, leaving the other targets' images", async () => {
    const { draftId, thread } = await draftThread();
    await browserRunFakes.failCapturesOf(draftId, "The page took too long.", "desktop");

    const { results, images } = await look(thread, {
      targets: [{ path: "/home" }, { path: "/missing", sizes: ["mobile"] }],
    });
    thread.close();

    expect(results).toEqual([
      { path: "/home", size: "desktop", error: "The page took too long." },
      { path: "/home", size: "mobile" },
      { path: "/missing", size: "mobile", error: expect.stringContaining("/missing") },
    ]);
    expect(images).toEqual([
      { data: await browserRunFakes.capturedImage(), mimeType: "image/jpeg" },
    ]);
  });

  it("gives the browser each target's delay", async () => {
    const { draftId, thread } = await draftThread();

    const { results } = await look(thread, {
      targets: [
        { path: "/home", sizes: ["desktop"], delay: LOOK_MAX_DELAY_MS },
        { path: "/home", sizes: ["mobile"] },
      ],
    });
    thread.close();

    expect(results).toEqual([
      { path: "/home", delay: LOOK_MAX_DELAY_MS, size: "desktop" },
      { path: "/home", size: "mobile" },
    ]);
    const captures = await browserRunFakes.captures(draftId);
    expect(captures.map(({ size, delayMs }) => [size, delayMs])).toEqual([
      ["desktop", LOOK_MAX_DELAY_MS],
      ["mobile", undefined],
    ]);
  });

  it("refuses a delay over the maximum for its own target, capturing the others", async () => {
    const { draftId, thread } = await draftThread();

    const { results, images } = await look(thread, {
      targets: [
        { path: "/home", sizes: ["desktop"], delay: LOOK_MAX_DELAY_MS + 1 },
        { path: "/home", sizes: ["mobile"] },
      ],
    });
    thread.close();

    expect(results).toEqual([
      {
        path: "/home",
        delay: LOOK_MAX_DELAY_MS + 1,
        size: "desktop",
        error: expect.stringContaining(`at most ${LOOK_MAX_DELAY_MS}`),
      },
      { path: "/home", size: "mobile" },
    ]);
    expect(images).toHaveLength(1);
    const captures = await browserRunFakes.captures(draftId);
    expect(captures.map(({ size }) => size)).toEqual(["mobile"]);
  });

  it("returns, as text with each image, the errors, failed requests and overflow its page reported, or says briefly there were none", async () => {
    const { draftId, thread, host } = await draftThread();
    await browserRunFakes.scriptChecksOf(
      draftId,
      {
        errors: ["Uncaught TypeError: price is undefined", "Minified React error #418"],
        failedRequests: [`404 https://${host}/hero.jpg`],
        overflow: true,
      },
      "mobile",
    );

    const { text, images } = await look(thread, { targets: [{ path: "/home" }] });
    thread.close();

    expect(text).toBe(
      [
        JSON.stringify({ path: "/home", size: "desktop" }),
        "No console or page errors, overflow or failed requests.",
        JSON.stringify({ path: "/home", size: "mobile" }),
        "Console and page errors:",
        "- Uncaught TypeError: price is undefined",
        "- Minified React error #418",
        "Content overflows horizontally at this width.",
        "Failed requests:",
        `- 404 https://${host}/hero.jpg`,
      ].join("\n"),
    );
    expect(images).toHaveLength(2);
  });

  it("refuses a call over the image cap, capturing nothing", async () => {
    const { draftId, thread } = await draftThread();
    const targets = Array.from({ length: LOOK_IMAGE_CAP / 2 + 1 }, () => ({ path: "/home" }));

    const { results, text } = await look(thread, { targets });
    thread.close();

    expect(results).toEqual([]);
    expect(text).toContain(`at most ${LOOK_IMAGE_CAP} images`);
    expect(await browserRunFakes.captures(draftId)).toEqual([]);
  });

  it("looks at a draft whose code no agent changed without any build", async () => {
    const { draftId, thread } = await draftThread();

    const { images } = await look(thread, { targets: [{ path: "/home" }] });
    thread.close();

    expect(images).toHaveLength(2);
    expect(await revisionFakes.revisionBuilds(draftId)).toEqual([]);
  });

  it("refuses a draft with code changes no build holds, telling the agent to call build", async () => {
    const { draftId, thread } = await draftThread();

    const { results, text } = await look(
      thread,
      { targets: [{ path: "/home" }] },
      {
        before: () =>
          answerWithToolCall("write", { path: "src/blocks/pricing.tsx", content: PRICING }),
      },
    );
    thread.close();

    expect(results).toEqual([]);
    expect(text).toContain("Call `build`");
    expect(await browserRunFakes.captures(draftId)).toEqual([]);
  });

  it("refuses a draft whose head revision isn't the previewed one, telling the agent to call build", async () => {
    const { website, draftId, thread } = await draftThread();
    const unusable = crypto.randomUUID();
    await definitionFakes.defineBuildsOf(unusable, definitionSetWith(website, "none"));

    const { results, text } = await look(
      thread,
      { targets: [{ path: "/home" }] },
      {
        before: () => {
          answerWithToolCall("write", {
            path: "src/blocks/pricing.tsx",
            content: markedFile(unusable),
          });
          answerWithToolCall("build", {});
        },
        // The end of the turn builds the head again, its definitions still refused, and gives up.
        after: () => {
          for (let failed = 0; failed < END_OF_TURN_BUILD_FAILURES; failed++) answerNext("Done.");
        },
      },
    );
    thread.close();

    expect(results).toEqual([]);
    expect(text).toContain("Call `build`");
    expect(await browserRunFakes.captures(draftId)).toEqual([]);
  });

  it("looks at a draft once its code changes built into its preview, and refuses again after a further unbuilt change", async () => {
    const { website, draftId, thread } = await draftThread();
    const [usable, further] = [crypto.randomUUID(), crypto.randomUUID()];
    await definitionFakes.defineBuildsOf(usable, definitionSetWith(website));
    await definitionFakes.defineBuildsOf(further, definitionSetWith(website));

    const built = await look(
      thread,
      { targets: [{ path: "/home" }] },
      {
        before: () => {
          answerWithToolCall("write", {
            path: "src/blocks/pricing.tsx",
            content: markedFile(usable),
          });
          answerWithToolCall("build", {});
        },
      },
    );
    expect(built.images).toHaveLength(2);
    expect(await browserRunFakes.captures(draftId)).toHaveLength(2);

    const unbuilt = await look(
      thread,
      { targets: [{ path: "/home" }] },
      {
        before: () =>
          answerWithToolCall("write", {
            path: "src/blocks/pricing.tsx",
            content: markedFile(further),
          }),
      },
    );
    thread.close();

    expect(unbuilt.results).toEqual([]);
    expect(unbuilt.text).toContain("Call `build`");
    expect(await browserRunFakes.captures(draftId)).toHaveLength(2);
  });

  it("fails the call with an error the agent acts on when the browser can't be reached, and the turn still ends", async () => {
    const { thread, host } = await draftThread();
    await browserRunFakes.takeBrowserRunDownFor(host);

    let told = "";
    answerWithToolCall("look", { targets: [{ path: "/home" }] });
    answerFrom(({ lastToolResult }) => {
      told = lastToolResult;
      return "I couldn't check the design.";
    });
    const view = await ask(thread, "Look at it");

    expect(told).toContain("can't be reached");
    expect(told).toContain("Carry on without looking");
    expect(lastAnswer(view)).toBe("I couldn't check the design.");
    expect(view.running).toBe(false);
  });

  describe("a Placement target", () => {
    it("captures the block's element from its whole page, at each size", async () => {
      const { website, draftId, thread } = await draftThread();
      const block = await placementOn(website, "/home");

      const { results, images } = await look(thread, { targets: [{ path: "/home", block }] });
      thread.close();

      expect(results).toEqual([
        { path: "/home", block, size: "desktop" },
        { path: "/home", block, size: "mobile" },
      ]);
      expect(images).toHaveLength(2);
      const captures = await browserRunFakes.captures(draftId);
      expect(captures.map(({ url, size, element }) => [pathOf(url), size, element])).toEqual([
        ["/home", "desktop", `[data-camox-viewport-block="${block}"]`],
        ["/home", "mobile", `[data-camox-viewport-block="${block}"]`],
      ]);
    });

    it("tells the model when the browser cut the block's image", async () => {
      const { website, thread } = await draftThread();
      const block = await placementOn(website, "/home");
      await browserRunFakes.cutCapturesOf(block, "mobile");

      const { results, images } = await look(thread, { targets: [{ path: "/home", block }] });
      thread.close();

      expect(results).toEqual([
        { path: "/home", block, size: "desktop" },
        { path: "/home", block, size: "mobile", cut: true },
      ]);
      expect(images).toHaveLength(2);
    });

    it("fails alone when the block isn't on that page, leaving the other targets' images", async () => {
      const { draftId, thread } = await draftThread();
      const elsewhere = crypto.randomUUID();

      const { results, images } = await look(thread, {
        targets: [
          { path: "/home", block: elsewhere, sizes: ["desktop"] },
          { path: "/home", sizes: ["desktop"] },
        ],
      });
      thread.close();

      expect(results).toEqual([
        {
          path: "/home",
          block: elsewhere,
          size: "desktop",
          error: expect.stringContaining(elsewhere),
        },
        { path: "/home", size: "desktop" },
      ]);
      expect(images).toHaveLength(1);
      expect((await browserRunFakes.captures(draftId)).map(({ element }) => element)).toEqual([
        undefined,
      ]);
    });
  });
});

/**
 * A draft thread of a website whose code adds a Singleton Layout at `/offers` and a Derived
 * Layout at `/articles/$slug`, each placing a text block before its page.
 */
async function draftThreadWithLayoutPages() {
  const opened = await draftThread();
  const { website } = opened;
  const before = (body: string) => [{ type: "text", content: { body }, slot: "before" as const }];
  await syncDefinitionSet(website.db, website.project, {
    blocks: [textDefinition],
    layouts: [
      { layoutId: website.layout.layoutId, description: "Default", blocks: [] },
      { layoutId: "offers", kind: "singleton", description: "", blocks: before("Offers") },
      { layoutId: "articles.$slug", kind: "derived", description: "", blocks: before("Blog") },
    ],
  });
  return opened;
}

/** The ID of the first block a layout places, as the studio reads it. */
async function layoutBlockOf({ db, memberUser, project }: Website, layoutId: string) {
  const { layout } = await call(
    layoutProcedures.get,
    { projectUuid: project.uuid, layoutId },
    { context: createRpcContext(db, memberUser) },
  );
  return layout.beforeBlockIds[0]!;
}

describe("the agent's look at a page of a Singleton or Derived Layout", () => {
  it("captures a Singleton Layout's page and a Derived Layout's, whose loader the website runs", async () => {
    const { draftId, thread } = await draftThreadWithLayoutPages();

    const { results } = await look(thread, {
      targets: [
        { path: "/offers", sizes: ["desktop"] },
        { path: "/articles/hello", sizes: ["desktop"] },
      ],
    });
    thread.close();

    expect(results).toEqual([
      { path: "/offers", size: "desktop" },
      { path: "/articles/hello", size: "desktop" },
    ]);
    const captures = await browserRunFakes.captures(draftId);
    expect(captures.map(({ url }) => pathOf(url))).toEqual(["/offers", "/articles/hello"]);
  });

  it("captures a block its layout places, and fails alone a block that isn't on the page", async () => {
    const { website, draftId, thread } = await draftThreadWithLayoutPages();
    const offer = await layoutBlockOf(website, "offers");
    const blog = await layoutBlockOf(website, "articles.$slug");

    const { results } = await look(thread, {
      targets: [
        { path: "/offers", block: offer, sizes: ["desktop"] },
        { path: "/articles/hello", block: blog, sizes: ["desktop"] },
        { path: "/offers", block: blog, sizes: ["desktop"] },
      ],
    });
    thread.close();

    expect(results).toEqual([
      { path: "/offers", block: offer, size: "desktop" },
      { path: "/articles/hello", block: blog, size: "desktop" },
      { path: "/offers", block: blog, size: "desktop", error: expect.stringContaining(blog) },
    ]);
    expect((await browserRunFakes.captures(draftId)).map(({ element }) => element)).toEqual([
      `[data-camox-viewport-block="${offer}"]`,
      `[data-camox-viewport-block="${blog}"]`,
    ]);
  });

  it("fails a path no layout's route and no page matches", async () => {
    const { draftId, thread } = await draftThreadWithLayoutPages();

    const { results } = await look(thread, {
      targets: [{ path: "/articles/hello/comments", sizes: ["desktop"] }],
    });
    thread.close();

    expect(results).toEqual([
      {
        path: "/articles/hello/comments",
        size: "desktop",
        error: expect.stringContaining("/articles/hello/comments"),
      },
    ]);
    expect(await browserRunFakes.captures(draftId)).toEqual([]);
  });
});

describe("the agent's look at a Block Definition", () => {
  it("captures the block alone, with its overrides, cut at the block's element", async () => {
    const { draftId, thread } = await draftThreadWithHero();
    const target = {
      blockDefinition: "hero",
      content: { title: "Spring sale" },
      settings: { colorScheme: "dark" },
    };

    const { results, images } = await look(thread, {
      targets: [{ ...target, sizes: ["desktop", "mobile"] }],
    });
    thread.close();

    expect(results).toEqual([
      { ...target, size: "desktop" },
      { ...target, size: "mobile" },
    ]);
    expect(images).toHaveLength(2);
    const captures = await browserRunFakes.captures(draftId);
    expect(captures.map(({ size }) => size)).toEqual(["desktop", "mobile"]);
    for (const capture of captures) {
      const params = new URL(capture.url).searchParams;
      expect(params.get("blockDefinition")).toBe("hero");
      expect(JSON.parse(params.get("content")!)).toEqual(target.content);
      expect(JSON.parse(params.get("settings")!)).toEqual(target.settings);
      expect(capture.element).toBe(`[data-camox-viewport-block="${UNPLACED_BLOCK_ID}"]`);
    }
  });

  it("fails a target whose overrides make its URL too long, telling the agent to shorten them, and captures the others", async () => {
    const { draftId, thread } = await draftThreadWithHero();
    const long = { title: "x".repeat(LOOK_MAX_URL_LENGTH) };

    const { results, images } = await look(thread, {
      targets: [
        { blockDefinition: "hero", content: long, sizes: ["desktop"] },
        { blockDefinition: "hero", sizes: ["mobile"] },
      ],
    });
    thread.close();

    expect(results).toEqual([
      {
        blockDefinition: "hero",
        content: long,
        size: "desktop",
        error: expect.stringMatching(/shorten/i),
      },
      { blockDefinition: "hero", size: "mobile" },
    ]);
    expect(images).toHaveLength(1);
    expect((await browserRunFakes.captures(draftId)).map(({ size }) => size)).toEqual(["mobile"]);
  });

  it("fails a target with an override its schema refuses, or an unknown Block Definition, with the schema's error, and captures the others", async () => {
    const { draftId, thread } = await draftThreadWithHero();

    const { results, images } = await look(thread, {
      targets: [
        { blockDefinition: "hero", settings: { colorScheme: "purple" }, sizes: ["desktop"] },
        { blockDefinition: "pricing", sizes: ["desktop"] },
        { blockDefinition: "hero", sizes: ["mobile"] },
      ],
    });
    thread.close();

    expect(results).toEqual([
      {
        blockDefinition: "hero",
        settings: { colorScheme: "purple" },
        size: "desktop",
        error: expect.stringContaining("colorScheme"),
      },
      { blockDefinition: "pricing", size: "desktop", error: expect.stringContaining("pricing") },
      { blockDefinition: "hero", size: "mobile" },
    ]);
    expect(images).toHaveLength(1);
    const captures = await browserRunFakes.captures(draftId);
    expect(
      captures.map(({ url, size }) => [new URL(url).searchParams.get("blockDefinition"), size]),
    ).toEqual([["hero", "mobile"]]);
  });
});
