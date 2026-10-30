import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { PATROLLER_IDS } from "@camox/api-contract/patrol";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callSeedingLive, createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { forgetScheduledChecks, scheduledChecks } from "../../../test/generation";
import { answerFrom, answerWithScript, forgetThreadModel } from "../../../test/thread-model";
import { ask, connectDraftThread, lastAnswer, signIn } from "../../../test/threads";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blockDefinitions } from "../../schema";

// Camox's agent and a draft's findings (ADR 0034), through a draft's thread: its tools read the
// draft's open findings and apply their fixes, as a member would, but only members dismiss.

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

type Headers = Record<string, string>;

/**
 * A footer on Live's home page linking to an About page, and a draft deleting About, checked once
 * idle: the Link checker found the footer's link to it.
 */
async function aboutDeleted() {
  const base = await createProjectFixture(`agent-findings-${crypto.randomUUID()}`);
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
  const createPage = async (pathSegment: string) => {
    const { page } = await callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId, nickname: pathSegment || "Home" },
      member(),
    );
    // A manual meta title keeps its SEO out of publishing's checks.
    await callSeedingLive(router.pages.setSeo, { id: page.id, metaTitle: page.nickname }, member());
    return page;
  };
  const home = await createPage("");
  const about = await createPage("about");
  const footer = await callSeedingLive(
    router.blocks.create,
    {
      pageId: home.id,
      type: "footer",
      content: { link: { type: "page", text: "About", pageId: about.id } },
    },
    member(),
  );
  const draftId = generateUuidv7();
  await call(
    router.pages.delete,
    { id: about.id },
    member({ [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
  );
  // The draft's checks run, as their alarms would once it's idle.
  const jobs = scheduledChecks(draftId);
  forgetScheduledChecks(draftId);
  for (const job of jobs) await runService(runAiJob(db, job));

  const inDraft = member({ [DRAFT_HEADER]: draftId });
  const linkChecker = async () =>
    (
      await call(router.patrol.get, { projectId, patrollers: [...PATROLLER_IDS] }, inDraft)
    ).patrollers.find((patroller) => patroller.id === "linkChecker")!;
  const footerLink = async () =>
    (
      (await call(router.blocks.get, { id: footer.id }, inDraft)).block.content as {
        link: unknown;
      }
    ).link;
  const thread = await connectDraftThread(projectId, draftId, await signIn(db, memberUser.id));
  return { ...base, draftId, footer, linkChecker, footerLink, thread };
}

describe("Camox's agent and a draft's findings", () => {
  it("reads the draft's open findings, with what each is about, where, and its fix", async () => {
    const { footer, thread } = await aboutDeleted();
    answerWithScript(`
      const { findings } = await tools.listFindings({});
      text(JSON.stringify(findings));
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "What's holding this draft?");

    expect(JSON.parse(lastAnswer(view)!)).toEqual([
      {
        id: expect.any(Number),
        patroller: "linkChecker",
        about: expect.objectContaining({ kind: "missingPage", text: "About" }),
        fix: { kind: "removeLink" },
        subject: { entity: "block", id: footer.id, name: expect.any(String) },
        locale: "en",
        field: "link",
      },
    ]);
  });

  it("applies a finding's fix in the draft, which resolves it", async () => {
    const { linkChecker, footerLink, thread } = await aboutDeleted();
    answerWithScript(`
      const { findings } = await tools.listFindings({});
      const { applied } = await tools.applyFindingFix({ findingId: findings[0].id });
      text(applied ? "applied" : "not applied");
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Fix the footer's link");

    expect(lastAnswer(view)).toBe("applied");
    expect(await footerLink()).toEqual({ type: "external", href: "", text: "About" });
    expect((await linkChecker()).findings).toEqual([]);
  });

  it("can't dismiss a finding: only members do", async () => {
    const { linkChecker, thread } = await aboutDeleted();
    answerWithScript(`
      const { findings } = await tools.listFindings({});
      const dismissing = Object.keys(tools).filter((name) => /dismiss/i.test(name));
      let outcome = "dismissFinding went through";
      try {
        await tools.dismissFinding({ findingId: findings[0].id });
      } catch {
        outcome = "dismissFinding failed";
      }
      text(JSON.stringify({ dismissing, outcome }));
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);

    const view = await ask(thread, "Dismiss the footer's finding");

    expect(JSON.parse(lastAnswer(view)!)).toEqual({
      dismissing: [],
      outcome: "dismissFinding failed",
    });
    const { findings, dismissals } = await linkChecker();
    expect(findings).toHaveLength(1);
    expect(dismissals).toEqual([]);
  });
});
