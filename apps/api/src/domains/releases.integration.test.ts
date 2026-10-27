import {
  CAMOX_ACTOR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createRpcContext,
  callSeedingLive,
  syncDefinitionSet,
  type TestDefinitionSet,
} from "../../test/fixtures";
import { answerEvery, forgetScheduled, scheduled } from "../../test/generation";
import { isTranslationJob } from "../lib/ai-job-queue";
import { runAiJob } from "../lib/ai-jobs";
import { runService } from "../lib/run-service";
import { router } from "../router";
import { pages } from "../schema";
import * as overlay from "./drafts/overlay";
import { RELEASE } from "./drafts/scope";

// A release: the website's build syncing its definitions to Live with the deploy token
// (ADR 0006, ADR 0007).

const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

const titled = {
  type: "object",
  properties: {
    title: { type: "string", fieldType: "String" },
    cta: {
      type: "object",
      fieldType: "Link",
      properties: {
        type: { type: "string", enum: ["external", "page"] },
        text: { type: "string" },
        href: { type: "string" },
        pageId: { type: "string" },
        newTab: { type: "boolean" },
      },
    },
  },
  toMarkdown: ["# {{title}}"],
};

type BlockDefinition = { blockId: string; layoutOnly?: boolean; synced?: boolean };
type DeclaredBlock = { type: string; slot?: "before" | "after"; content?: unknown };

async function fixture() {
  const base = await createProjectFixture(`release-${crypto.randomUUID()}`);
  const { db, project } = base;
  // The website's code as last released: each release sends its whole Definition Set.
  const current: Required<Pick<TestDefinitionSet, "blocks" | "layouts">> = {
    blocks: [],
    layouts: [],
  };
  const release = () => syncDefinitionSet(db, project, current);

  const releaseDefinitions = (definitions: BlockDefinition[]) => {
    current.blocks = definitions.map((definition) => ({
      title: definition.blockId,
      description: definition.blockId,
      contentSchema: titled,
      ...definition,
    }));
    return release();
  };
  const releaseLayouts = (layouts: Record<string, DeclaredBlock[]>) => {
    current.layouts = Object.entries(layouts).map(([layoutId, blocks]) => ({
      layoutId,
      description: layoutId,
      blocks: blocks.map((block) => ({ content: { title: block.type }, ...block })),
    }));
    return release();
  };

  const now = Date.now();
  const createPage = (fullPath: string) =>
    db
      .insert(pages)
      .values({
        projectId: project.id,
        layoutId: "default",
        pathSegment: fullPath.slice(1),
        fullPath,
        nickname: fullPath,
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  const page = await createPage("/");

  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(db, base.memberUser, headers),
  });
  const layoutBlocks = async (layoutId: string, headers: Record<string, string> = {}) => {
    const layout = await call(
      router.layouts.get,
      { projectUuid: project.uuid, layoutId },
      member(headers),
    );
    return layout.blocks;
  };
  const createBlock = (title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "hero", content: { title } },
      member(headers),
    );
  const editTitle = (id: string, title: string, headers: Record<string, string> = {}) =>
    callSeedingLive(router.blocks.updateContent, { id, content: { title } }, member(headers));
  const titleIn = async (id: string, headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id }, member(headers))).block.content.title;
  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId: project.id }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId: project.id, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );

  /** Runs every translation job scheduled so far, as their alarms would, and forgets them. */
  const runTranslations = async () => {
    const jobs = scheduled().filter(isTranslationJob);
    forgetScheduled(...jobs.map((job) => job.entityId));
    const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
    for (const job of keyed.values()) await runService(runAiJob(db, job));
  };
  /** Takes German live, translated: the model says each text "auf Deutsch". */
  const publishGerman = async () => {
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, `${text} auf Deutsch`])),
    );
    const german = generateUuidv7();
    await call(
      router.locales.add,
      { projectId: project.id, tag: "de" },
      member(startingDraft(german)),
    );
    await runTranslations();
    await publish(german);
  };
  /** Camox's catch-up drafts among the project's open drafts. */
  const catchUpDrafts = async () =>
    (await call(router.drafts.list, { projectId: project.id }, member())).drafts.filter(
      (draft) => draft.createdBy.id === CAMOX_ACTOR,
    );

  return {
    ...base,
    page,
    runTranslations,
    publishGerman,
    catchUpDrafts,
    createPage,
    member,
    releaseDefinitions,
    releaseLayouts,
    layoutBlocks,
    createBlock,
    editTitle,
    titleIn,
    preview,
    publish,
  };
}

/** Lets the clock move on, so the next write is strictly later. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("a release", () => {
  it("adds the declared content of a new layout to Live, and deletes orphaned layout-only blocks", async () => {
    const { releaseDefinitions, releaseLayouts, layoutBlocks } = await fixture();
    await releaseDefinitions([
      { blockId: "navbar", layoutOnly: true },
      { blockId: "banner", layoutOnly: true },
    ]);
    await releaseLayouts({
      default: [
        { type: "navbar", slot: "before" },
        { type: "banner", slot: "after" },
      ],
    });
    const [navbar] = await layoutBlocks("default");
    await releaseLayouts({
      default: [{ type: "navbar", slot: "before" }],
      landing: [{ type: "navbar", slot: "before" }],
    });

    expect((await layoutBlocks("default")).map((block) => block.id)).toEqual([navbar.id]);
    expect(await layoutBlocks("landing")).toEqual([
      expect.objectContaining({
        type: "navbar",
        content: expect.objectContaining({ title: "navbar" }),
      }),
    ]);
  });

  it("making a definition synced builds Live's shared content from the most recently published placement, and a draft holding its own placement content sees a conflict by a release", async () => {
    const { createBlock, editTitle, titleIn, preview, publish, releaseDefinitions } =
      await fixture();
    await releaseDefinitions([{ blockId: "hero" }]);
    const first = await createBlock("First");
    const second = await createBlock("Second");
    // The second placement is changed first but published last.
    const publishedLast = generateUuidv7();
    await editTitle(second.id, "Published last", startingDraft(publishedLast));
    await tick();
    const publishedFirst = generateUuidv7();
    await editTitle(first.id, "Published first", startingDraft(publishedFirst));
    await publish(publishedFirst);
    await tick();
    await publish(publishedLast);
    const open = generateUuidv7();
    await editTitle(first.id, "Mine", startingDraft(open));
    const before = Date.now();

    await releaseDefinitions([{ blockId: "hero", synced: true }]);

    expect(await titleIn(first.id)).toBe("Published last");
    expect(await titleIn(second.id)).toBe("Published last");
    const { conflicts } = await preview(open);
    expect(conflicts).toEqual([
      expect.objectContaining({ id: first.id, release: true, publishedBy: null }),
    ]);
    expect(conflicts[0].publishedAt).toBeGreaterThanOrEqual(before);
  });

  it("making a definition no longer synced gives each Live placement a copy, and a draft that changed a placement sees a conflict", async () => {
    const { createBlock, editTitle, titleIn, member, preview, releaseDefinitions } =
      await fixture();
    await releaseDefinitions([{ blockId: "hero", synced: true }]);
    const first = await createBlock("Shared");
    const second = await createBlock("Ignored");
    const open = generateUuidv7();
    await callSeedingLive(
      router.blocks.updatePosition,
      { id: second.id, afterPosition: null },
      member(startingDraft(open)),
    );

    await releaseDefinitions([{ blockId: "hero", synced: false }]);

    expect(await titleIn(first.id)).toBe("Shared");
    expect(await titleIn(second.id)).toBe("Shared");
    expect((await preview(open)).conflicts).toEqual([
      expect.objectContaining({ id: second.id, release: true }),
    ]);
    await editTitle(second.id, "Own");
    expect(await titleIn(first.id)).toBe("Shared");
  });

  it("never fails because of content, such as a declared block linking a page Live deleted", async () => {
    const { db, createPage, releaseDefinitions, releaseLayouts, layoutBlocks } = await fixture();
    const about = await createPage("/about");
    await releaseDefinitions([{ blockId: "navbar", layoutOnly: true }]);
    const declared = {
      default: [
        {
          type: "navbar",
          slot: "before" as const,
          content: { title: "Nav", cta: { type: "page", text: "About", pageId: about.id } },
        },
      ],
    };
    await releaseLayouts(declared);
    // Publishing refuses to delete a page Live content links to, so Live loses it as a release
    // would write it.
    await runService(overlay.remove(db, RELEASE, pages, about.id));

    await releaseLayouts(declared);

    expect(await layoutBlocks("default")).toHaveLength(1);
  });
});

const inGerman = { [LOCALE_HEADER]: "de" };

describe("a release into a project with other locales", () => {
  it("translates everything its several syncs seed in one draft", async () => {
    const f = await fixture();
    await f.publishGerman();
    await f.releaseDefinitions([{ blockId: "navbar", layoutOnly: true }]);

    await f.releaseLayouts({ default: [{ type: "navbar", slot: "before" }] });
    await f.releaseLayouts({
      default: [{ type: "navbar", slot: "before" }],
      landing: [{ type: "navbar", slot: "after", content: { title: "Landing" } }],
    });
    expect(await f.catchUpDrafts()).toHaveLength(1);
    await f.runTranslations();

    const titles = async (layoutId: string) =>
      (await f.layoutBlocks(layoutId, inGerman)).map((block) => block.content.title);
    expect(await titles("default")).toEqual(["navbar auf Deutsch"]);
    expect(await titles("landing")).toEqual(["Landing auf Deutsch"]);
    expect(await f.catchUpDrafts()).toEqual([]);
  });

  it("translates the shared content making a definition synced builds", async () => {
    const f = await fixture();
    await f.releaseDefinitions([{ blockId: "hero" }]);
    const first = await f.createBlock("Hello");
    await tick();
    const second = await f.createBlock("Welcome");
    await f.publishGerman();

    await f.releaseDefinitions([{ blockId: "hero", synced: true }]);
    await f.runTranslations();

    // Both German placements show the shared content, built from the last published one.
    expect(await f.titleIn(first.id, inGerman)).toBe("Welcome auf Deutsch");
    expect(await f.titleIn(second.id, inGerman)).toBe("Welcome auf Deutsch");
    expect(await f.catchUpDrafts()).toEqual([]);
  });

  it("takes the localizations of the layout content it deletes along", async () => {
    const f = await fixture();
    await f.releaseDefinitions([
      { blockId: "navbar", layoutOnly: true },
      { blockId: "banner", layoutOnly: true },
    ]);
    await f.releaseLayouts({
      default: [
        { type: "navbar", slot: "before" },
        { type: "banner", slot: "after" },
      ],
    });
    await f.publishGerman();
    expect(await f.layoutBlocks("default", inGerman)).toHaveLength(2);

    await f.releaseLayouts({ default: [{ type: "navbar", slot: "before" }] });
    await f.runTranslations();

    expect((await f.layoutBlocks("default", inGerman)).map((block) => block.type)).toEqual([
      "navbar",
    ]);
    expect(await f.catchUpDrafts()).toEqual([]);
  });
});
