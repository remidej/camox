import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";

const { broadcastInvalidation, broadcastDraftEnded } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn(), broadcastDraftEnded: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation, broadcastDraftEnded }));

type Headers = Record<string, string>;
/** Headers naming a draft, creating it when missing. */
const startingDraft = (id: string) => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
/** Headers naming an existing draft. */
const inDraft = (id: string) => ({ [DRAFT_HEADER]: id });

async function fixture() {
  const base = await createProjectFixture(`synced-drafts-${crypto.randomUUID()}`);
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "navbar",
      title: "Navbar",
      description: "Navigation",
      synced: true,
      contentSchema: {
        type: "object",
        properties: {
          title: { fieldType: "String", type: "string" },
          links: {
            fieldType: "Repeater",
            type: "array",
            items: {
              type: "object",
              properties: { label: { fieldType: "String", type: "string" } },
            },
          },
        },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const now = Date.now();
  const createPage = (fullPath: string) =>
    base.db
      .insert(pages)
      .values({
        projectId: base.project.id,
        environmentId: base.environment.id,
        layoutId: base.layout.layoutId,
        pathSegment: fullPath.slice(1),
        fullPath,
        nickname: fullPath,
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  const home = await createPage("/");
  const about = await createPage("/about");
  const projectId = base.project.id;
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });

  const place = (pageId: string) =>
    call(router.blocks.create, { pageId, type: "navbar", content: { title: "Live" } }, member());
  const first = await place(home.id);
  const second = await place(about.id);

  const editTitle = (blockId: string, title: string, headers: Headers = {}) =>
    call(router.blocks.updateContent, { id: blockId, content: { title } }, member(headers));
  /** What a placement shows: its title and its links, as a scope reads them. */
  const shown = async (blockId: string, headers: Headers = {}) => {
    const { block, repeatableItems } = await call(
      router.blocks.get,
      { id: blockId },
      member(headers),
    );
    const labels = new Map(
      repeatableItems.map((item) => [item.id, (item.content as { label: string }).label]),
    );
    // The block's content holds markers naming its items in order.
    const content = block.content as { title: string; links?: { _itemId: string }[] };
    return {
      title: content.title,
      links: (content.links ?? []).map((link) => labels.get(link._itemId)),
    };
  };
  const syncedTitle = async (headers: Headers = {}) => {
    const synced = await call(
      router.blocks.getSyncedContent,
      { projectId, type: "navbar" },
      member(headers),
    );
    return (synced?.block.content as { title: string } | undefined)?.title;
  };

  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );

  return { ...base, member, first, second, editTitle, shown, syncedTitle, preview, publish };
}

describe("a synced block's shared content in a draft", () => {
  it("shows an edit made in a draft in every placement in that draft, and only there", async () => {
    const { editTitle, first, member, publish, second, shown, syncedTitle } = await fixture();
    const draft = generateUuidv7();
    const other = generateUuidv7();

    await editTitle(first.id, "Draft", startingDraft(draft));
    await call(
      router.repeatableItems.create,
      { blockId: second.id, fieldName: "links", content: { label: "Pricing" } },
      member(inDraft(draft)),
    );
    await editTitle(first.id, "Other", startingDraft(other));

    for (const placement of [first, second]) {
      expect(await shown(placement.id, inDraft(draft))).toEqual({
        title: "Draft",
        links: ["Pricing"],
      });
      expect(await shown(placement.id)).toEqual({ title: "Live", links: [] });
      expect(await shown(placement.id, inDraft(other))).toEqual({ title: "Other", links: [] });
    }
    expect(await syncedTitle(inDraft(draft))).toBe("Draft");
    expect(await syncedTitle()).toBe("Live");

    await publish(draft);
    for (const placement of [first, second]) {
      expect(await shown(placement.id)).toEqual({ title: "Draft", links: ["Pricing"] });
    }
  });

  it("lists shared content Live changed after the draft did as a conflict", async () => {
    const { editTitle, first, preview, publish, second, shown } = await fixture();
    const draft = generateUuidv7();
    await editTitle(first.id, "Mine", startingDraft(draft));
    const other = generateUuidv7();
    await editTitle(second.id, "Theirs", startingDraft(other));
    await publish(other);

    expect((await preview(draft)).conflicts).toEqual([
      expect.objectContaining({
        entity: "sharedContent",
        owner: expect.objectContaining({ kind: "syncedBlock", name: "navbar" }),
      }),
    ]);
    await publish(draft);
    expect((await shown(second.id)).title).toBe("Mine");
  });
});
