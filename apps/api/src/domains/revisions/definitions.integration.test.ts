import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
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
  lastAnswer,
  pagesOf,
  signIn,
  textDefinition,
  type ThreadClient,
  type Website,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";

// A revision's Definition Set becomes its draft's definitions, so the agent can write a block,
// build it and place it in the same turn. The fake revision sandbox builds a tree holding a
// scripted marker into a build whose Definition Set the test gives (test/release-fakes.js).

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type Fakes = {
  defineBuildsOf(marker: string, definitionSet: unknown): Promise<void>;
  failBuildsOf(marker: string, log: string): Promise<void>;
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

/** The website's Definition Set as its code gives it, with `blocks` beside the text block. */
const definitionSetWith = (website: Website, blocks: unknown[]) => ({
  blocks: [textDefinition, ...blocks],
  layouts: [{ layoutId: website.layout.layoutId, description: "Default", blocks: [] }],
  collections: [],
  homepage: null,
});

/** A block file the fake sandbox builds into the Definition Set scripted for `marker`. */
const blockFile = (marker: string) => `export const block = "built"; // ${marker}\n`;

/** The Live home page's text block, as the studio reads its Markdown. */
const HELLO = "<!-- Text -->\nHello";
/** A pricing block saying plans start at $9, as the studio reads its Markdown. */
const PRICING = "<!-- Pricing -->\nPlans start at $9";

const TEXT_BLOCK = `export const text = "text";\n`;

/** A website whose `main` holds its text block, and whose Live home page says "Hello". */
async function websiteWithCode() {
  const website = await websiteFixture({ home: "Hello" });
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
    "src/blocks/text.tsx": TEXT_BLOCK,
  });
  const token = await signIn(website.db, website.memberUser.id);
  return { website, token };
}

/** A script placing a pricing block saying `headline` on the home page. */
const placePricing = (headline: string) => `
  const [home] = await tools.listPages({});
  await tools.createBlock({ pageId: home.id, type: "pricing", content: { headline: ${JSON.stringify(headline)} } });
  text("placed");
`;

/** The block types a draft's studio reads, or Live's without a draft. */
async function blockTypesOf({ db, memberUser, project }: Website, draftId?: string) {
  const context = createRpcContext(db, memberUser, draftId ? { [DRAFT_HEADER]: draftId } : {});
  const definitions = await call(
    router.blockDefinitions.list,
    { projectId: project.id },
    { context },
  );
  return definitions.map(({ blockId }) => blockId).sort();
}

/** Has the agent call `build`, and returns its result. */
async function build(thread: ThreadClient) {
  answerWithToolCall("build", {});
  answerFrom(({ lastToolResult }) => lastToolResult);
  return JSON.parse(lastAnswer(await ask(thread, "Build", { keepOpen: true }))!) as {
    ok: boolean;
  };
}

describe("a revision's definitions", () => {
  it("let the agent place a block it wrote and built in the same turn", async () => {
    const { website, token } = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.defineBuildsOf(marker, definitionSetWith(website, [pricingDefinition]));
    const thread = await connectLiveThread(website.project.id, token);
    answerWithToolCall("write", { path: "src/blocks/pricing.tsx", content: blockFile(marker) });
    answerWithToolCall("build", {});
    answerWithScript(placePricing("Plans start at $9"));
    answerFrom(({ scriptOutput }) => `Done: ${scriptOutput}`);

    const view = await ask(thread, "Add a pricing section saying plans start at $9");

    expect(lastAnswer(view)).toBe("Done: placed");
    const [draft] = await draftsOf(website);
    expect(await pagesOf(website, draft!.id)).toEqual({ "/home": [HELLO, PRICING] });
    expect(await blockTypesOf(website, draft!.id)).toEqual(["pricing", "text"]);
    expect(await blockTypesOf(website)).toEqual(["text"]);
    expect(await pagesOf(website)).toEqual({ "/home": [HELLO] });
  });

  it("aren't the draft's until a build of its code passes", async () => {
    const { website, token } = await websiteWithCode();
    const marker = crypto.randomUUID();
    await fakes.failBuildsOf(marker, "error during build:\nBuild failed with 1 error\n");
    const live = await connectLiveThread(website.project.id, token);
    answerWithToolCall("write", { path: "src/blocks/pricing.tsx", content: blockFile(marker) });
    answerFrom(() => "Wrote it.");
    await ask(live, "Add a pricing section");
    const [draft] = await draftsOf(website);
    const thread = await connectDraftThread(website.project.id, draft!.id, token);

    expect(await blockTypesOf(website, draft!.id)).toEqual(["text"]);
    expect(await build(thread)).toMatchObject({ ok: false });
    thread.close();

    expect(await blockTypesOf(website, draft!.id)).toEqual(["text"]);
  });

  it("drop a block a later revision removes, its content coming back with it", async () => {
    const { website, token } = await websiteWithCode();
    const withPricing = crypto.randomUUID();
    const withoutPricing = crypto.randomUUID();
    await fakes.defineBuildsOf(withPricing, definitionSetWith(website, [pricingDefinition]));
    await fakes.defineBuildsOf(withoutPricing, definitionSetWith(website, []));
    const live = await connectLiveThread(website.project.id, token);
    answerWithToolCall("write", {
      path: "src/blocks/pricing.tsx",
      content: blockFile(withPricing),
    });
    answerWithToolCall("build", {});
    answerWithScript(placePricing("Plans start at $9"));
    answerFrom(() => "Added it.");
    await ask(live, "Add a pricing section");
    const [draft] = await draftsOf(website);
    const thread = await connectDraftThread(website.project.id, draft!.id, token);
    answerWithToolCall("rm", { path: "src/blocks/pricing.tsx" });
    answerWithToolCall("write", {
      path: "src/blocks/text.tsx",
      content: blockFile(withoutPricing),
    });
    answerFrom(() => "Removed it.");
    await ask(thread, "Remove the pricing block's code", { keepOpen: true });

    expect(await build(thread)).toMatchObject({ ok: true });

    expect(await blockTypesOf(website, draft!.id)).toEqual(["text"]);
    expect(await pagesOf(website, draft!.id)).toEqual({ "/home": [HELLO] });

    // Back to the first revision's code, which brings the block and its content back.
    answerWithToolCall("write", {
      path: "src/blocks/pricing.tsx",
      content: blockFile(withPricing),
    });
    answerWithToolCall("write", { path: "src/blocks/text.tsx", content: TEXT_BLOCK });
    answerFrom(() => "Restored it.");
    await ask(thread, "Bring the pricing block back", { keepOpen: true });

    expect(await build(thread)).toMatchObject({ ok: true });
    thread.close();

    expect(await blockTypesOf(website, draft!.id)).toEqual(["pricing", "text"]);
    expect(await pagesOf(website, draft!.id)).toEqual({ "/home": [HELLO, PRICING] });
  });
});
