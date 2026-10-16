import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../test/fixtures";
import { runService } from "../lib/run-service";
import { router } from "../router";
import { pages } from "../schema";
import { syncBlockDefinitions } from "./block-definitions/service";
import { syncLayouts } from "./layouts/service";

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
  const build = createServiceContext(db, null);
  const token = { projectSlug: project.slug, deployToken: project.deployToken, autoCreate: false };

  const releaseDefinitions = (definitions: BlockDefinition[]) =>
    runService(
      syncBlockDefinitions(build, {
        ...token,
        definitions: definitions.map((definition) => ({
          title: definition.blockId,
          description: definition.blockId,
          contentSchema: titled,
          ...definition,
        })),
      }),
    );
  const releaseLayouts = (layouts: Record<string, DeclaredBlock[]>) =>
    runService(
      syncLayouts(build, {
        ...token,
        layouts: Object.entries(layouts).map(([layoutId, blocks]) => ({
          layoutId,
          description: layoutId,
          blocks: blocks.map((block) => ({ content: { title: block.type }, ...block })),
        })),
      }),
    );

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
  const layoutBlocks = async (layoutId: string) => {
    const layout = await call(
      router.layouts.get,
      { projectSlug: project.slug, layoutId },
      member(),
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

  return {
    ...base,
    page,
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
  it("adds the declared content of a new layout to Live, and deletes orphaned layout-only blocks with their comments", async () => {
    const { member, page, releaseDefinitions, releaseLayouts, layoutBlocks } = await fixture();
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
    const [navbar, banner] = await layoutBlocks("default");
    const comment = (blockId: string, message: string, headers: Record<string, string> = {}) =>
      call(
        router.comments.create,
        { pageId: page.id, message, target: { kind: "block", blockId } },
        member(headers),
      );
    await comment(navbar.id, "On the navbar");
    await comment(banner.id, "On the banner");
    const draft = generateUuidv7();
    await comment(banner.id, "On the banner, in a draft", startingDraft(draft));

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
    const comments = await call(router.comments.list, { pageId: page.id }, member());
    expect(comments.map((c) => c.message)).toEqual(["On the navbar"]);
    // A release writes Live only: the draft keeps its comment, unavailable with its block gone.
    const inTheDraft = await call(
      router.comments.list,
      { pageId: page.id },
      member(inDraft(draft)),
    );
    expect(inTheDraft).toEqual([
      expect.objectContaining({ message: "On the navbar" }),
      expect.objectContaining({ message: "On the banner, in a draft", target: null }),
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
    const { createPage, member, releaseDefinitions, releaseLayouts, layoutBlocks } =
      await fixture();
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
    await callSeedingLive(router.pages.delete, { id: about.id }, member());

    await releaseLayouts(declared);

    expect(await layoutBlocks("default")).toHaveLength(1);
  });
});
