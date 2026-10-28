import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";

// The AI tools that publish and delete the request's draft (ADR 0009), called through the agent
// procedures.

type ToolResponse = { ok: true; result: any } | { ok: false; error: { code: string } };

async function fixture() {
  const base = await createProjectFixture(`tools-${crypto.randomUUID()}`);
  const projectId = base.project.id;
  await syncDefinitionSet(base.db, base.project, {
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "Hero",
        contentSchema: {
          type: "object",
          properties: { title: { fieldType: "String", type: "string" } },
          toMarkdown: ["# {{title}}"],
        },
      },
    ],
  });
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });

  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "home", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "Live" } },
    member(),
  );
  const draft = await call(router.drafts.create, { projectId }, member());
  const inDraft = { [DRAFT_HEADER]: draft.id };

  const callTool = async (name: string, args: unknown = {}, headers = inDraft) =>
    (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as ToolResponse;
  const result = async (name: string, args: unknown = {}, headers = inDraft) => {
    const response = await callTool(name, args, headers);
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  const editTitle = (title: string, headers: Record<string, string>) =>
    call(router.blocks.updateContent, { id: block.id, content: { title } }, member(headers));
  const titleIn = async (headers: Record<string, string> = {}) =>
    (await call(router.blocks.get, { id: block.id }, member(headers))).block.content.title;

  /** Another member's draft changing the block and publishing it to Live. */
  const publishedOnLive = async (title: string) => {
    const other = generateUuidv7();
    await editTitle(title, { [DRAFT_HEADER]: other, [DRAFT_CREATE_HEADER]: "1" });
    const inOther = member({ [DRAFT_HEADER]: other });
    const { token } = await call(router.drafts.previewPublish, { projectId }, inOther);
    await call(router.drafts.publish, { projectId, token }, inOther);
  };

  return { block, inDraft, callTool, result, editTitle, titleIn, publishedOnLive };
}

describe("draft AI tools", () => {
  it("previewPublish lists the draft's changes with a token, and publishDraft with it publishes to Live", async () => {
    const f = await fixture();
    await f.editTitle("Mine", f.inDraft);

    const preview = await f.result("previewPublish");
    expect(preview).toMatchObject({ blockers: [], conflicts: [], lost: [], warnings: [] });
    expect(preview.changes).toEqual([
      expect.objectContaining({ entity: "block", id: f.block.id, change: "changed" }),
    ]);
    expect(preview.token).toEqual(expect.any(String));

    expect(await f.result("publishDraft", { token: preview.token })).toMatchObject({
      published: true,
    });
    expect(await f.titleIn()).toBe("Mine");
  });

  it("publishDraft with a stale token publishes nothing and returns the new list with a fresh token", async () => {
    const f = await fixture();
    await f.editTitle("Mine", f.inDraft);
    const { token, conflicts } = await f.result("previewPublish");
    expect(conflicts).toEqual([]);

    await f.publishedOnLive("Theirs");
    const stale = await f.result("publishDraft", { token });

    expect(stale).toMatchObject({ published: false, reason: "conflictsChanged" });
    expect(stale.preview.conflicts).toEqual([
      expect.objectContaining({ entity: "block", id: f.block.id }),
    ]);
    expect(stale.preview.token).not.toBe(token);
    expect(await f.titleIn()).toBe("Theirs");

    expect(await f.result("publishDraft", { token: stale.preview.token })).toMatchObject({
      published: true,
    });
    expect(await f.titleIn()).toBe("Mine");
  });

  it("publishDraft on a draft without changes says there is nothing to publish", async () => {
    const f = await fixture();
    const { token } = await f.result("previewPublish");

    expect(await f.result("publishDraft", { token })).toMatchObject({
      published: false,
      reason: "empty",
    });
    expect(await f.titleIn()).toBe("Live");
  });

  it("publishDraft on a draft an earlier attempt deleted says it was deleted, not published", async () => {
    const f = await fixture();
    await f.editTitle("Deleted", f.inDraft);
    const { token } = await f.result("previewPublish");
    await f.result("deleteDraft");

    expect(await f.result("publishDraft", { token })).toMatchObject({
      published: false,
      reason: "deleted",
      ended: { outcome: "deleted" },
    });
    expect(await f.titleIn()).toBe("Live");
  });

  it("deleteDraft ends the draft and leaves Live untouched", async () => {
    const f = await fixture();
    await f.editTitle("Deleted", f.inDraft);
    expect(await f.titleIn(f.inDraft)).toBe("Deleted");

    expect(await f.result("deleteDraft")).toMatchObject({ ended: { outcome: "deleted" } });

    expect(await f.titleIn()).toBe("Live");
  });

  it("answers a tool it doesn't offer as unknown, naming the ones it does", async () => {
    const f = await fixture();

    expect(await f.callTool("notATool")).toMatchObject({
      ok: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: expect.stringContaining("notATool"),
        details: { available: expect.arrayContaining(["previewPublish", "deleteDraft"]) },
      },
    });
  });
});
