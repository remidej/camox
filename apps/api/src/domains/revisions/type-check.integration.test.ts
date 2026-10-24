import { DRAFT_HEADER, PUBLISH_BLOCKED_ERROR } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext } from "../../../test/fixtures";
import {
  type FakeTypeError,
  PRICING,
  revisionFakes as fakes,
  typeErrorsMarker,
  websiteWithCode,
} from "../../../test/revision-builds";
import {
  answerFrom,
  answerNext,
  answerWithToolCall,
  answerWithToolCallFrom,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  said,
  signIn,
  type ThreadClient,
  type Website,
} from "../../../test/threads";
import { router } from "../../router";
import { END_OF_TURN_BUILD_FAILURES } from "./end-of-turn";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const PRICING_FILE = "src/blocks/pricing.tsx";

/** Who reviews a draft in the studio: the website's member, in the draft. */
const reviewer = ({ db, memberUser }: Website, draftId: string) => ({
  context: createRpcContext(db, memberUser, { [DRAFT_HEADER]: draftId }),
});

const previewOf = (website: Website, draftId: string) =>
  call(router.drafts.previewPublish, { projectId: website.project.id }, reviewer(website, draftId));

/** A draft whose agent added a pricing section that built, with its thread open. */
async function draftWithPricing() {
  const website = await websiteWithCode();
  const token = await signIn(website.db, website.memberUser.id);
  const live = await connectLiveThread(website.project.id, token);
  answerWithToolCall("write", { path: PRICING_FILE, content: PRICING });
  answerNext("I added a pricing section.");
  await ask(live, "Add a pricing section");
  const [draft] = await draftsOf(website);
  const thread = await connectDraftThread(website.project.id, draft!.id, token);
  return { website, draft: draft!, thread };
}

/** The pricing section, marked so the fake sandbox's type check of a tree holding it fails. */
const mistyped = (marker: string) => `${PRICING}// ${marker}\n`;

const NOT_A_STRING: FakeTypeError = {
  file: PRICING_FILE,
  line: 2,
  column: 7,
  code: "TS2322",
  message: "Type 'number' is not assignable to type 'string'.",
};

/**
 * Has the agent write `content` to `path` and build it, then end its turn without fixing anything
 * each time the end of the turn sends it back, until it explains. Returns what `build` answered,
 * what the agent was last told, and the thread.
 */
async function keepTypeErrors(thread: ThreadClient, content: string, path = PRICING_FILE) {
  let result: string | undefined;
  answerWithToolCall("write", { path, content });
  answerWithToolCall("build", {});
  answerFrom(({ lastToolResult }) => {
    result = lastToolResult;
    return "Done.";
  });
  for (let failed = 1; failed < END_OF_TURN_BUILD_FAILURES; failed++) answerNext("Done.");
  let told = "";
  answerFrom(({ editorMessages }) => {
    told = editorMessages.at(-1)!;
    return EXPLAINED;
  });
  const view = await ask(thread, "Change the plans");
  return { result: JSON.parse(result!) as Record<string, unknown>, told, view };
}

const EXPLAINED = "The new plans show, but there's a mistake left in them I couldn't fix.";

describe("a revision's type check", () => {
  it("returns the type errors of a build that passes, which still commits and is previewed", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = await typeErrorsMarker([NOT_A_STRING]);

    const { result } = await keepTypeErrors(thread, mistyped(marker));

    expect(result).toEqual({
      ok: false,
      revision: expect.any(String),
      build: [],
      types: [
        {
          file: PRICING_FILE,
          line: 2,
          code: "TS2322",
          message: "Type 'number' is not assignable to type 'string'.",
        },
      ],
      lint: [],
    });
    expect(await fakes.readFile(website.project.uuid, draft.id, PRICING_FILE)).toBe(
      mistyped(marker),
    );
    expect((await previewOf(website, draft.id)).code).toMatchObject({
      revision: result.revision,
    });
  });

  it("doesn't hold back the preview of a revision that built", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const before = (await previewOf(website, draft.id)).code!.revision;
    await fakes.holdTypeChecks(draft.id);
    try {
      answerWithToolCall("write", { path: PRICING_FILE, content: `${PRICING}// Yearly plans\n` });
      answerNext("I added yearly plans.");
      thread.send({ type: "send", operationId: crypto.randomUUID(), text: "Add yearly plans" });

      // The type check is still running.
      await vi.waitFor(
        async () => expect((await previewOf(website, draft.id)).code!.revision).not.toBe(before),
        { timeout: 10_000, interval: 50 },
      );
    } finally {
      await fakes.releaseTypeChecks(draft.id);
    }
    await thread.untilIdle();
    thread.close();
  });

  it("hands the agent the type errors as its turn ends, and it fixes them", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = await typeErrorsMarker([NOT_A_STRING]);
    answerWithToolCall("write", { path: PRICING_FILE, content: mistyped(marker) });
    answerNext("I changed the plans.");
    let told = "";
    answerWithToolCallFrom("write", ({ editorMessages }) => {
      told = editorMessages.at(-1)!;
      return { path: PRICING_FILE, content: PRICING };
    });
    answerNext("I changed the plans, and fixed a mistake.");

    const view = await ask(thread, "Change the plans");

    expect(told).toContain("Type 'number' is not assignable to type 'string'.");
    expect(told).toContain("TS2322");
    expect(said(view).at(-1)).toEqual({
      from: "agent",
      text: "I changed the plans, and fixed a mistake.",
    });
    expect((await previewOf(website, draft.id)).blockers).toEqual([]);
  });

  it("keeps type errors once the end of the turn found them too often, and the agent explains", async () => {
    const { website, draft, thread } = await draftWithPricing();
    const marker = await typeErrorsMarker([NOT_A_STRING]);

    // The agent's own build doesn't count: the end of the turn finds the errors the limit's
    // number of times before the agent is told to explain.
    const { told, view } = await keepTypeErrors(thread, mistyped(marker));

    expect(told).toContain("preview");
    expect(told).not.toContain("TS2322");
    expect(said(view).at(-1)).toEqual({ from: "agent", text: EXPLAINED });
    expect((await previewOf(website, draft.id)).blockers).toEqual([
      expect.objectContaining({ entity: "code", code: "codeDoesNotTypeCheck" }),
    ]);
  });

  it("refuses to publish a draft whose code doesn't type check", async () => {
    const { website, draft, thread } = await draftWithPricing();
    await keepTypeErrors(thread, mistyped(await typeErrorsMarker([NOT_A_STRING])));
    // Content changes too, so the draft has something to publish.
    const [page] = await call(
      router.pages.list,
      { projectId: website.project.id },
      reviewer(website, draft.id),
    );
    await call(
      router.blocks.create,
      { pageId: page!.id, type: "text", content: { body: "Plans" } } as never,
      reviewer(website, draft.id),
    );

    const { token } = await previewOf(website, draft.id);

    await expect(
      call(
        router.drafts.publish,
        { projectId: website.project.id, token },
        reviewer(website, draft.id),
      ),
    ).rejects.toMatchObject({ code: PUBLISH_BLOCKED_ERROR });
  });

  it("reports what a change breaks in a file the agent didn't touch", async () => {
    const { thread } = await draftWithPricing();
    // The hero imports a heading component, which imports the heading's props: the agent only
    // changes the props.
    const brokenHero: FakeTypeError = {
      file: "src/blocks/hero.tsx",
      line: 12,
      column: 9,
      code: "TS2741",
      message: "Property 'level' is missing in type '{ title: string; }'.",
    };
    const marker = await typeErrorsMarker([brokenHero]);

    const { result } = await keepTypeErrors(
      thread,
      `export type HeadingProps = { title: string; level: 1 | 2 }; // ${marker}\n`,
      "src/lib/heading-props.ts",
    );

    expect(result.types).toEqual([
      {
        file: "src/blocks/hero.tsx",
        line: 12,
        code: "TS2741",
        message: "Property 'level' is missing in type '{ title: string; }'.",
      },
    ]);
  });
});
