import { LOOK_TOKEN_COOKIE } from "@camox/api-contract/drafts";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { browserRunFakes } from "../../../test/browser-run";
import { startDraft } from "../../../test/fixtures";
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
import { END_OF_TURN_BUILD_FAILURES } from "../revisions/end-of-turn";
import { LOOK_IMAGE_CAP, LOOK_MAX_DELAY_MS } from "./look";

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

const pathOf = (url: string) => new URL(url).searchParams.get("path");

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

  it("has the browser wait each target's delay before it captures", async () => {
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

  it("looks at a draft once its code changes built into its preview", async () => {
    const { website, thread } = await draftThread();
    const usable = crypto.randomUUID();
    await definitionFakes.defineBuildsOf(usable, definitionSetWith(website));

    const { images } = await look(
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
    thread.close();

    expect(images).toHaveLength(2);
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
});
