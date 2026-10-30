import {
  CHECKS_RUNNING_ERROR,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  FINDINGS_OPEN_ERROR,
} from "@camox/api-contract/drafts";
import { generateUuidv7, PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  runChecks as runFixtureChecks,
} from "../../../test/fixtures";
import { forgetSent, refreshes, sentTo } from "../../../test/project-rooms";
import { router } from "../../router";
import { blockDefinitions } from "../../schema";

// Publishing waits for findings (ADR 0033): a draft's open findings, and its patrollers' checks at
// publish that haven't read its latest changes, hold its publish, with no way around them.

type Headers = Record<string, string>;
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

/** A project with a footer block holding a Link field, on Live's home page, linking to About. */
async function fixture() {
  const base = await createProjectFixture(`publish-findings-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await db.insert(blockDefinitions).values({
    projectId,
    blockId: "footer",
    title: "Footer",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        body: { type: "string", fieldType: "String", title: "Body" },
        link: {
          fieldType: "Link",
          title: "Link",
          type: "object",
          properties: {
            type: { type: "string", enum: ["external", "page"] },
            text: { type: "string" },
            href: { type: "string" },
            pageId: { type: "string" },
          },
          default: { type: "external", text: "", href: "" },
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const createPage = async (pathSegment: string, headers: Headers = {}) => {
    const { page } = await callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId, nickname: pathSegment || "Home" },
      member(headers),
    );
    // A manual meta title keeps its SEO out of publishing's checks.
    await callSeedingLive(
      router.pages.setSeo,
      { id: page.id, metaTitle: page.nickname },
      member(headers),
    );
    return page;
  };
  const home = await createPage("");
  const about = await createPage("about");
  const footer = await callSeedingLive(
    router.blocks.create,
    {
      pageId: home.id,
      type: "footer",
      content: { body: "Hello", link: { type: "page", text: "About", pageId: about.id } },
    },
    member(),
  );

  const runChecks = (draftId: string) => runFixtureChecks(db, draftId);
  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const publish = async (draftId: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(draftId)).token },
      member(inDraft(draftId)),
    );
  const aboutOnLive = async () =>
    (await call(router.pages.list, { projectId }, member())).some((page) => page.id === about.id);

  /** A draft deleting About, which the footer links to: the Link checker raises the link. */
  const deletingAbout = async () => {
    const draft = generateUuidv7();
    await call(router.pages.delete, { id: about.id }, member(startingDraft(draft)));
    return draft;
  };

  const findingOf = async (draftId: string) => (await preview(draftId)).findings[0]!;
  const apply = async (draftId: string) =>
    call(
      router.patrol.applyFix,
      { projectId, findingId: (await findingOf(draftId)).id },
      member(inDraft(draftId)),
    );
  const dismiss = async (draftId: string) =>
    call(
      router.patrol.dismissFinding,
      { projectId, findingId: (await findingOf(draftId)).id },
      member(inDraft(draftId)),
    );

  /** Camox's agent publishing the draft through its CLI tools, as coding agents do. */
  const publishAsAgent = async (draftId: string) => {
    const tool = async (name: string, args: Record<string, unknown>) => {
      const response = (await call(
        router.agent.callTool,
        { projectId, name, arguments: args },
        member(inDraft(draftId)),
      )) as { ok: true; result: any } | { ok: false; error: unknown };
      if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
      return response.result;
    };
    const { token } = await tool("previewPublish", {});
    return tool("publishDraft", { token });
  };

  return {
    ...base,
    projectId,
    member,
    home,
    about,
    footer,
    runChecks,
    preview,
    publish,
    aboutOnLive,
    deletingAbout,
    apply,
    dismiss,
    publishAsAgent,
  };
}

describe("the publish preview", () => {
  it("names the checks that haven't read the draft's latest changes, then lists what they found", async () => {
    const f = await fixture();
    const draft = await f.deletingAbout();

    const before = await f.preview(draft);
    expect(before.checking).toEqual([{ id: "linkChecker", role: "Link checker" }]);
    expect(before.findings).toEqual([]);

    await f.runChecks(draft);
    const after = await f.preview(draft);
    expect(after.checking).toEqual([]);
    expect(after.findings).toMatchObject([
      {
        about: { kind: "missingPage", url: `${PAGE_TEXT_LINK_PREFIX}${f.about.id}` },
        subject: { entity: "block", id: f.footer.id },
        field: "link",
        live: false,
      },
    ]);
  });
});

describe("a check settling", () => {
  it("refreshes the draft's publish preview, even having found nothing", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: f.footer.id, content: { body: "Goodbye" } },
      f.member(startingDraft(draft)),
    );
    forgetSent(f.projectId);

    await f.runChecks(draft);

    const preview = [...queryKeys.drafts.all, "previewPublish", draft];
    expect(refreshes(sentTo(f.projectId), draft, preview)).toBe(true);
  });
});

describe("publishing a draft with an open finding", () => {
  it("fails listing it, leaving Live as it was", async () => {
    const f = await fixture();
    const draft = await f.deletingAbout();
    await f.runChecks(draft);

    const refused = f.publish(draft);

    await expect(refused).rejects.toMatchObject({ code: FINDINGS_OPEN_ERROR });
    await expect(refused).rejects.toThrow(
      /“About” in footer links to about, which no longer exists/,
    );
    expect(await f.aboutOnLive()).toBe(true);
  });

  it("publishes once a member dismissed it", async () => {
    const f = await fixture();
    const draft = await f.deletingAbout();
    await f.runChecks(draft);

    await f.dismiss(draft);

    await f.publish(draft);
    expect(await f.aboutOnLive()).toBe(false);
  });

  it("publishes once its fix is applied and the check read the fixed content", async () => {
    const f = await fixture();
    const draft = await f.deletingAbout();
    await f.runChecks(draft);

    expect(await f.apply(draft)).toEqual({ applied: true });
    await expect(f.publish(draft)).rejects.toMatchObject({ code: CHECKS_RUNNING_ERROR });
    await f.runChecks(draft);

    await f.publish(draft);
    expect(await f.aboutOnLive()).toBe(false);
  });
});

describe("publishing a draft whose check hasn't read its latest changes", () => {
  it("fails naming the check, until it settles", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: f.footer.id, content: { body: "Goodbye" } },
      f.member(startingDraft(draft)),
    );

    const refused = f.publish(draft);

    await expect(refused).rejects.toMatchObject({ code: CHECKS_RUNNING_ERROR });
    await expect(refused).rejects.toThrow(/Link checker/);
    await f.runChecks(draft);
    await f.publish(draft);
    expect(
      (await call(router.blocks.get, { id: f.footer.id }, f.member())).block.content,
    ).toMatchObject({
      body: "Goodbye",
    });
  });
});

describe("Camox's agent publishing a draft the patrollers hold", () => {
  it("publishes nothing while a finding is open, and is told which", async () => {
    const f = await fixture();
    const draft = await f.deletingAbout();
    await f.runChecks(draft);

    const result = await f.publishAsAgent(draft);

    expect(result).toMatchObject({
      published: false,
      reason: "findings",
      preview: { findings: [{ field: "link", about: { kind: "missingPage" } }], checking: [] },
    });
    expect(result.message).toMatch(/“About” in footer/);
    expect(await f.aboutOnLive()).toBe(true);
  });

  it("publishes nothing while a check is running, and is told which", async () => {
    const f = await fixture();
    const draft = await f.deletingAbout();

    const result = await f.publishAsAgent(draft);

    expect(result).toMatchObject({
      published: false,
      reason: "checking",
      preview: { checking: [{ id: "linkChecker" }] },
    });
    expect(await f.aboutOnLive()).toBe(true);
  });
});
