import {
  CONFLICTS_CHANGED_ERROR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  runAllChecks,
  syncDefinitionSet,
} from "../../../test/fixtures";
import {
  answerEvery,
  forgetScheduled,
  scheduled,
  scheduledOverviews,
} from "../../../test/generation";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { locales } from "../locales/schema";

// "Use Live's version instead" on a conflict (#530): the draft drops its copy of the entity in
// every locale, so it reads Live's again and the conflict is gone.

type Headers = Record<string, string>;
type ToolResponse =
  | { ok: true; result: any }
  | { ok: false; error: { code: string; message: string } };

/** The model translates into German with this dictionary, keeping words it doesn't know. */
const GERMAN: Record<string, string> = {
  Hello: "Hallo",
  Welcome: "Willkommen",
  Prices: "Preise",
  Other: "Andere",
};

/** A project whose Live holds a page with a hero block, in English and German. */
async function fixture() {
  const base = await createProjectFixture(`revert-to-live-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await syncDefinitionSet(db, project, {
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "Hero",
        contentSchema: {
          type: "object",
          properties: { title: { type: "string", fieldType: "String" } },
          toMarkdown: ["# {{title}}"],
        },
      },
    ],
  });
  answerEvery("translate", ({ texts }) =>
    Object.fromEntries(texts.map(({ key, text }) => [key, GERMAN[text] ?? text])),
  );

  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "pricing", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Hello" } },
    member(),
  );

  const tool = async (name: string, args: Record<string, unknown>, headers: Headers) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  /** Runs every translation job scheduled so far, as their alarms would, and forgets them. */
  const runTranslations = async () => {
    const jobs = scheduled().filter(isTranslationJob);
    forgetScheduled(...jobs.map((job) => job.entityId));
    const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
    for (const job of keyed.values()) await runService(runAiJob(db, job));
    // A catch-up draft is published once its checks ran too (ADR 0033).
    await runAllChecks(db);
  };
  /** Opens a draft, which `run` writes in, and returns its headers. */
  const draft = async (run: (starting: Headers) => Promise<unknown>) => {
    const id = generateUuidv7();
    await run({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
    return { id, headers: { [DRAFT_HEADER]: id } };
  };
  const preview = (headers: Headers) =>
    call(router.drafts.previewPublish, { projectId }, member(headers));
  const publish = async (headers: Headers) => {
    await runTranslations();
    const { token } = await reviewed(db, headers[DRAFT_HEADER]!, preview(headers));
    return call(router.drafts.publish, { projectId, token }, member(headers));
  };
  const revertToLive = (
    headers: Headers,
    target: { entity: "page" | "block" | "locale"; id: string },
  ) => call(router.drafts.revertToLive, { projectId, ...target }, member(headers));
  const editTitle = (id: string, title: string) => (headers: Headers) =>
    tool("editBlock", { id, content: { title } }, headers);
  /** The block's title in a locale, on Live or in a draft. */
  const titleIn = async (locale: string, headers: Headers = {}) =>
    (await tool("getBlock", { id: block.id, locale }, headers)).block.content.title;

  // German goes live, translated.
  const german = await draft((starting) => tool("addLocale", { tag: "de" }, starting));
  await publish(german.headers);

  /**
   * A draft that changed the block, in English and in its German translation, after which
   * another draft published a change to it.
   */
  const conflicting = async () => {
    const mine = await draft(editTitle(block.id, "Welcome"));
    await runTranslations();
    const theirs = await draft(editTitle(block.id, "Prices"));
    await publish(theirs.headers);
    await runTranslations();
    return mine;
  };

  return {
    ...base,
    projectId,
    page,
    block,
    tool,
    draft,
    preview,
    publish,
    revertToLive,
    editTitle,
    runTranslations,
    titleIn,
    conflicting,
  };
}

describe("using Live's version of a conflict", () => {
  it("drops the draft's copy in every locale, so the draft reads Live's and the conflict is gone", async () => {
    const f = await fixture();
    const mine = await f.conflicting();
    expect((await f.preview(mine.headers)).conflicts).toContainEqual(
      expect.objectContaining({ entity: "block", id: f.block.id, revertible: true }),
    );

    await f.revertToLive(mine.headers, { entity: "block", id: f.block.id });

    expect(await f.titleIn("en", mine.headers)).toBe("Prices");
    expect(await f.titleIn("de", mine.headers)).toBe("Preise");
    // Translating what the draft now reads from Live changes nothing.
    await f.runTranslations();
    const after = await f.preview(mine.headers);
    expect(after.conflicts).toEqual([]);
    expect(after.changes.filter((change) => change.id === f.block.id)).toEqual([]);
    expect(await f.titleIn("en", mine.headers)).toBe("Prices");
    expect(await f.titleIn("de", mine.headers)).toBe("Preise");
  });

  it("changes the preview's token, so publishing with an earlier one fails", async () => {
    const f = await fixture();
    const mine = await f.conflicting();
    // Something else the draft still publishes.
    await f.tool(
      "createBlock",
      { pageId: f.page.id, type: "hero", content: { title: "Other" } },
      mine.headers,
    );
    await f.runTranslations();
    const before = await f.preview(mine.headers);

    await f.revertToLive(mine.headers, { entity: "block", id: f.block.id });
    await f.runTranslations();

    expect((await f.preview(mine.headers)).token).not.toBe(before.token);
    await runAllChecks(f.db);
    await expect(
      call(
        router.drafts.publish,
        { projectId: f.projectId, token: before.token },
        { context: createRpcContext(f.db, f.memberUser, mine.headers) },
      ),
    ).rejects.toMatchObject({ code: CONFLICTS_CHANGED_ERROR });
  });

  it("requests a new overview of the draft, which no longer changes the block", async () => {
    const f = await fixture();
    const mine = await f.conflicting();
    // Something else the draft still publishes.
    await f.tool(
      "createBlock",
      { pageId: f.page.id, type: "hero", content: { title: "Other" } },
      mine.headers,
    );
    const draftId = mine.id;
    const before = scheduledOverviews(draftId).length;

    await f.revertToLive(mine.headers, { entity: "block", id: f.block.id });

    expect(scheduledOverviews(draftId).length).toBeGreaterThan(before);
    expect((await f.preview(mine.headers)).overview).toEqual({ status: "pending" });
  });

  it("is rejected for a page, whose copy spreads to the pages beneath it", async () => {
    const f = await fixture();
    const renamePage = (pathSegment: string) => (headers: Headers) =>
      f.tool("updatePage", { id: f.page.id, pathSegment }, headers);
    const mine = await f.draft(renamePage("prices"));
    const theirs = await f.draft(renamePage("plans"));
    await f.publish(theirs.headers);
    await f.runTranslations();
    const pageConflict = (await f.preview(mine.headers)).conflicts.find(
      (conflict) => conflict.id === f.page.id,
    );
    expect(pageConflict).toMatchObject({ entity: "page", revertible: false });

    await expect(
      f.revertToLive(mine.headers, { entity: "page", id: f.page.id }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await f.preview(mine.headers)).conflicts).toContainEqual(
      expect.objectContaining({ id: f.page.id }),
    );
  });

  it("is rejected for a locale", async () => {
    const f = await fixture();
    const mine = await f.conflicting();
    const german = await f.db
      .select()
      .from(locales)
      .where(
        and(eq(locales.projectId, f.projectId), eq(locales.tag, "de"), isNull(locales.draftId)),
      )
      .get();

    await expect(
      f.revertToLive(mine.headers, { entity: "locale", id: german!.id }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("can't use Live's version alone"),
    });
  });

  it("is rejected for an entity the draft changed that isn't in conflict, and keeps the change", async () => {
    const f = await fixture();
    const mine = await f.draft(f.editTitle(f.block.id, "Welcome"));
    await f.runTranslations();

    await expect(
      f.revertToLive(mine.headers, { entity: "block", id: f.block.id }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await f.titleIn("en", mine.headers)).toBe("Welcome");
  });
});
