import { DEVELOPMENT_DRAFT, DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  openDevelopmentDraft,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { upsertBlockDefinition } from "../block-definitions/service";

// The AI tools that publish and discard the session's draft (ADR 0009), as the CLI calls them
// through the agent procedures in the caller's development draft (ADR 0010).

const development = { [DRAFT_HEADER]: DEVELOPMENT_DRAFT };

type ToolResponse = { ok: true; result: any } | { ok: false; error: { code: string } };

async function fixture() {
  const base = await createProjectFixture(`tools-${crypto.randomUUID()}`);
  const projectId = base.project.id;
  await runService(
    upsertBlockDefinition(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: base.project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: { title: { fieldType: "String", type: "string" } },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
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
  await openDevelopmentDraft(base.db, projectId, base.memberUser.id);

  const callTool = async (name: string, args: unknown = {}) =>
    (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(development),
    )) as ToolResponse;
  const result = async (name: string, args: unknown = {}) => {
    const response = await callTool(name, args);
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

  return { block, callTool, result, editTitle, titleIn, publishedOnLive };
}

describe("draft AI tools", () => {
  it("previewPublish lists the development draft's changes with a token, and publishDraft with it publishes to Live", async () => {
    const f = await fixture();
    await f.editTitle("Mine", development);

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
    expect((await f.result("previewPublish")).changes).toEqual([]);
  });

  it("publishDraft with a stale token publishes nothing and returns the new list with a fresh token", async () => {
    const f = await fixture();
    await f.editTitle("Mine", development);
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

  it("discardDraft empties the development draft and leaves Live untouched", async () => {
    const f = await fixture();
    await f.editTitle("Discarded", development);
    expect(await f.titleIn(development)).toBe("Discarded");

    await f.result("discardDraft");

    expect((await f.result("previewPublish")).changes).toEqual([]);
    expect(await f.titleIn(development)).toBe("Live");
    expect(await f.titleIn()).toBe("Live");
  });

  it("no longer offers the environment tools", async () => {
    const f = await fixture();
    for (const name of ["checkEnvironmentCompatibility", "replicateEnvironment"]) {
      expect(await f.callTool(name, { direction: "push" })).toMatchObject({
        ok: false,
        error: { code: "UNKNOWN_TOOL" },
      });
    }
  });
});
