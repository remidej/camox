import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { callTool, connectAgent } from "../../../test/connected-agents";
import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  seedLive,
  startDraft,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { textDefinition } from "../../../test/threads";
import { router } from "../../router";
import { blocks, locales, member, pages } from "../../schema";

/** A member's one website, with a pricing page on Live holding one paragraph. */
async function website() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const { db, memberUser, project, layout } = fixture;
  await syncDefinitionSet(db, project, { blocks: [textDefinition] });
  const asMember = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId: project.id, pathSegment: "pricing", layoutId: layout.layoutId },
    asMember(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "text", content: { body: "Plans start at $9." } } as never,
    asMember(),
  );
  /** Starts a draft that changes the pricing page's paragraph to `body`. Returns its id. */
  const draftChangingPrice = async (body: string) => {
    const draftId = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: block.id, content: { body } },
      asMember({ [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    );
    return draftId;
  };
  /** Adds French to Live, with the pricing page translated at `/fr/tarifs`. */
  const translateIntoFrench = async () => {
    const now = Date.now();
    await seedLive(db, locales, {
      projectId: project.id,
      tag: "fr",
      createdAt: now,
      updatedAt: now,
    });
    // Live's French rows, as publishing a translation leaves them: same ids, in the locale.
    const liveRow = { draftId: null, locale: "fr" } as const;
    const { rowId: _page, ...pageRow } = (await db
      .select()
      .from(pages)
      .where(and(eq(pages.id, page.id), isNull(pages.draftId)))
      .get())!;
    await db
      .insert(pages)
      .values({ ...pageRow, ...liveRow, pathSegment: "tarifs", fullPath: "/tarifs" });
    const { rowId: _block, ...blockRow } = (await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.id, block.id), isNull(blocks.draftId)))
      .get())!;
    await db
      .insert(blocks)
      .values({ ...blockRow, ...liveRow, content: { body: "Les offres commencent à 9 $." } });
  };
  const inDraft = (draftId: string) => asMember({ [DRAFT_HEADER]: draftId });
  const publish = async (draftId: string) => {
    const input = { projectId: project.id };
    const { token } = await call(router.drafts.previewPublish, input, inDraft(draftId));
    await call(router.drafts.publish, { ...input, token }, inDraft(draftId));
  };
  const deleteDraft = (draftId: string) =>
    call(router.drafts.delete, { projectId: project.id }, inDraft(draftId));
  return {
    ...fixture,
    page,
    block,
    asMember,
    draftChangingPrice,
    translateIntoFrench,
    publish,
    deleteDraft,
  };
}

/** Why `read_page` refused. */
async function refusalOf(accessToken: string, args: Record<string, unknown>) {
  const result = await callTool(accessToken, "read_page", args);
  expect(result.isError, result.content[0]?.text).toBe(true);
  return result.content[0]!.text;
}

/** What `read_page` answered, once it answered. */
async function readPage(accessToken: string, args: Record<string, unknown>) {
  const result = await callTool(accessToken, "read_page", args);
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return JSON.parse(result.content[0]!.text) as { path: string; locale: string; markdown: string };
}

describe("read_page", () => {
  it("reads a page on Live as its Markdown Representation, in the Default Locale", async () => {
    const { memberUser } = await website();
    const { accessToken } = await connectAgent(memberUser.id);

    expect(await readPage(accessToken, { path: "/pricing" })).toEqual({
      path: "/pricing",
      locale: "en",
      markdown: expect.stringContaining("Plans start at $9."),
    });
  });

  it("reads a page as a draft has it, the draft named by its id or by a studio link", async () => {
    const { memberUser, project, draftChangingPrice } = await website();
    const draftId = await draftChangingPrice("Plans start at $12.");
    const { accessToken } = await connectAgent(memberUser.id);
    const studioLink = `https://${project.slug}.camox.site/pricing?camox-draft=${draftId}`;

    for (const draft of [draftId, studioLink]) {
      const read = await readPage(accessToken, { path: "/pricing", draft });
      expect(read.markdown, draft).toContain("Plans start at $12.");
    }
    // Live is as it was.
    expect((await readPage(accessToken, { path: "/pricing" })).markdown).toContain(
      "Plans start at $9.",
    );
  });

  it("reads a page in the locale it's given", async () => {
    const { memberUser, translateIntoFrench } = await website();
    await translateIntoFrench();
    const { accessToken } = await connectAgent(memberUser.id);

    expect(await readPage(accessToken, { path: "/tarifs", locale: "fr" })).toEqual({
      path: "/fr/tarifs",
      locale: "fr",
      markdown: expect.stringContaining("Les offres commencent à 9 $."),
    });
  });

  it("refuses a path with no page", async () => {
    const { memberUser } = await website();
    const { accessToken } = await connectAgent(memberUser.id);

    expect(await refusalOf(accessToken, { path: "/careers" })).toContain("/careers");
  });

  it("refuses a locale the website doesn't have, naming its locales", async () => {
    const { memberUser } = await website();
    const { accessToken } = await connectAgent(memberUser.id);

    expect(await refusalOf(accessToken, { path: "/pricing", locale: "de" })).toMatch(/\ben\b/);
  });

  it("refuses a draft the member can't see as it refuses a draft that doesn't exist", async () => {
    const { memberUser } = await website();
    const otherWebsite = await createProjectFixture(crypto.randomUUID());
    const theirs = await startDraft(
      otherWebsite.db,
      otherWebsite.project.id,
      otherWebsite.memberUser.id,
    );
    const unknown = generateUuidv7();
    const { accessToken } = await connectAgent(memberUser.id);

    const refusedTheirs = await refusalOf(accessToken, { path: "/pricing", draft: theirs });
    const refusedUnknown = await refusalOf(accessToken, { path: "/pricing", draft: unknown });

    expect(refusedTheirs.replace(theirs, "<id>")).toBe(refusedUnknown.replace(unknown, "<id>"));
  });

  it("refuses what names no draft", async () => {
    const { memberUser, project } = await website();
    const { accessToken } = await connectAgent(memberUser.id);

    for (const draft of ["the pricing draft", `https://${project.slug}.camox.site/pricing`]) {
      expect(await refusalOf(accessToken, { path: "/pricing", draft }), draft).toContain(
        "camox-draft",
      );
    }
  });

  it("refuses a draft that ended, saying whether it was published or deleted, and by whom", async () => {
    const { memberUser, draftChangingPrice, publish, deleteDraft } = await website();
    const published = await draftChangingPrice("Plans start at $12.");
    await publish(published);
    const deleted = await draftChangingPrice("Plans start at $15.");
    await deleteDraft(deleted);
    const { accessToken } = await connectAgent(memberUser.id);

    const refusedPublished = await refusalOf(accessToken, { path: "/pricing", draft: published });
    expect(refusedPublished).toContain("published");
    expect(refusedPublished).toContain(memberUser.name);
    const refusedDeleted = await refusalOf(accessToken, { path: "/pricing", draft: deleted });
    expect(refusedDeleted).toContain("deleted");
    expect(refusedDeleted).toContain(memberUser.name);
  });

  it("refuses a draft of another of the member's projects than the one it names, naming the draft's", async () => {
    const pricingSite = await website();
    const otherSite = await createProjectFixture(crypto.randomUUID());
    await otherSite.db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: otherSite.project.organizationId,
      userId: pricingSite.memberUser.id,
      role: "member",
      createdAt: new Date(),
    });
    const draft = await pricingSite.draftChangingPrice("Plans start at $12.");
    const { accessToken } = await connectAgent(pricingSite.memberUser.id);

    const refused = await refusalOf(accessToken, {
      path: "/pricing",
      draft,
      project: otherSite.project.slug,
    });
    expect(refused).toContain(pricingSite.project.slug);
    // Named in its own project, the draft reads.
    const read = await readPage(accessToken, {
      path: "/pricing",
      draft,
      project: pricingSite.project.slug,
    });
    expect(read.markdown).toContain("Plans start at $12.");
  });
});
