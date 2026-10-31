import { abortAllDurableObjects } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture, startDraft } from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  answerWithToolCall,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  signIn,
  threadIdOf,
  websiteFixture,
} from "../../../test/threads";
import type { createDb } from "../../db";
import { aiUsageRecords } from "../ai-usage/schema";

// The AI usage records of a thread's agent (ADR 0031): one per step it takes, and one per call
// its web tools make. Threads run on pi-ai's fake provider, scripted per test, which reports
// tokens but no cost: what OpenRouter bills is read from its stream (`usage.test.ts`).
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** The records naming the project `projectId`, once `count` were written in the background. */
async function recordsOf(db: ReturnType<typeof createDb>, projectId: number, count: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const records = await db
      .select()
      .from(aiUsageRecords)
      .where(eq(aiUsageRecords.projectId, projectId))
      .orderBy(asc(aiUsageRecords.createdAt), asc(aiUsageRecords.step));
    if (records.length >= count || Date.now() > deadline) return records;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("a thread's AI usage records", () => {
  it("record each step of the agent's turn, with the tools it called and the size of their results", async () => {
    const fixture = await createProjectFixture(crypto.randomUUID());
    const { db, project, memberUser } = fixture;
    const draftId = await startDraft(db, project.id, memberUser.id);
    answerWithScript(`text("Three pages.");`);
    answerNext("You have three pages.");

    const thread = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    await ask(thread, "How many pages do we have?");

    const records = await recordsOf(db, project.id, 2);
    expect(
      records.map(({ purpose, step, toolCalls, toolKind }) => ({
        purpose,
        step,
        toolCalls,
        toolKind,
      })),
    ).toEqual([
      { purpose: "agent_step", step: 1, toolCalls: ["codemode"], toolKind: "content" },
      { purpose: "agent_step", step: 2, toolCalls: [], toolKind: "reply" },
    ]);
    const [script, reply] = records;
    expect(script!.turnId).not.toBeNull();
    expect(reply!.turnId).toBe(script!.turnId);
    expect(script!.toolResultBytes).toHaveLength(1);
    expect(script!.toolResultBytes![0]).toBeGreaterThan("Three pages.".length);
    expect(reply!.toolResultBytes).toBeNull();
    for (const record of records) {
      expect(record).toMatchObject({
        organizationId: project.organizationId,
        draftId,
        threadId: await threadIdOf(db, draftId),
        initiator: "member",
        memberId: memberUser.id,
        status: "ok",
        costSource: "estimated",
      });
      expect(record.inputTokens).toBeGreaterThan(0);
      expect(record.outputTokens).toBeGreaterThan(0);
    }
  });

  it("number the steps of each turn afresh", async () => {
    const { db, project, memberUser } = await createProjectFixture(crypto.randomUUID());
    const draftId = await startDraft(db, project.id, memberUser.id);
    answerNext("Hello.");
    answerNext("Hello again.");

    const thread = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    await ask(thread, "Hi", { keepOpen: true });
    await ask(thread, "Hi again");

    const records = await recordsOf(db, project.id, 2);
    expect(records.map(({ step }) => step)).toEqual([1, 1]);
    expect(records[0]!.turnId).not.toBe(records[1]!.turnId);
  });

  it("record what web_fetch's page reader spent, on Live", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", {
      url: "https://website.camox.test/contact",
      prompt: "The opening hours",
    });
    answerFrom(() => "Monday to Friday, 9am to 5pm.");
    answerNext("Monday to Friday.");

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    await ask(thread, "What are the opening hours on https://website.camox.test/contact?");

    const records = await recordsOf(db, project.id, 3);
    expect(records.map(({ purpose, toolKind }) => ({ purpose, toolKind }))).toEqual(
      expect.arrayContaining([
        { purpose: "agent_step", toolKind: "web" },
        { purpose: "web_fetch", toolKind: null },
        { purpose: "agent_step", toolKind: "reply" },
      ]),
    );
    expect(records).toHaveLength(3);
    const read = records.find(({ purpose }) => purpose === "web_fetch")!;
    expect(read).toMatchObject({ draftId: null, initiator: "member", memberId: memberUser.id });
    expect(read.inputTokens).toBeGreaterThan(0);
  });
});
