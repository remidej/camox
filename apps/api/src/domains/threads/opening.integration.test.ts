import type { ThreadSender } from "@camox/api-contract/threads";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { addMember, startDraft } from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  connectDraftThread,
  pagesOf,
  said,
  signIn,
  threadIdOf,
  type Website,
  websiteFixture,
} from "../../../test/threads";

// The API opens a draft's thread itself, with no studio connected: as a Live thread handing a
// request off to a draft does (ADR 0025), with a Brief from Camox, then the editor's messages, or
// with messages alone, each under its own sender.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const BRIEF = "The editor wants a launch page. The website's pricing page is at /pricing.";

/** A script creating a page at `/launch`, printing who created it. */
const CREATE_LAUNCH_PAGE = `
  const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
  const { page: created } = await tools.getPage({ id: page.id });
  text(created.createdBy);
`;

/**
 * A draft of the website, started by the fixture member, whose thread's id is set aside as when
 * a studio glanced at it, with no socket left open.
 */
async function draftWithThread(website: Website) {
  const { db, memberUser, project } = website;
  const draftId = await startDraft(db, project.id, memberUser.id);
  const glance = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
  glance.close();
  const threadId = await threadIdOf(db, draftId);
  if (!threadId) throw new Error("The draft's thread wasn't set aside");
  return { draftId, threadId };
}

/** An editor, as an opening message names its sender. */
const editorOf = (editor: { id: string; name: string; image: string | null }) => ({
  kind: "editor" as const,
  editor: { id: editor.id, name: editor.name, image: editor.image } satisfies ThreadSender,
});

describe("a draft's thread the API opens", () => {
  it("shows Camox's message, then the editor's, and runs the agent as them with no studio connected", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, project } = website;
    const teammate = await addMember(db, project.organizationId);
    const { draftId, threadId } = await draftWithThread(website);
    answerWithScript(CREATE_LAUNCH_PAGE);
    answerFrom(
      ({ editorMessages, scriptOutput }) =>
        `Saw: ${editorMessages.join(" | ")}. By ${scriptOutput}.`,
    );

    await env.THREAD.getByName(threadId).open({
      identity: { projectId: project.id, draftId, ownerId: null },
      apiOrigin: "http://api.camox.test",
      brief: BRIEF,
      messages: [
        { operationId: crypto.randomUUID(), text: "Add a launch page", from: editorOf(teammate) },
        {
          operationId: crypto.randomUUID(),
          text: "Link it from pricing",
          from: editorOf(teammate),
        },
      ],
    });

    const member = await connectDraftThread(
      project.id,
      draftId,
      await signIn(db, website.memberUser.id),
    );
    await member.untilIdle(4);
    expect(said(member.view())).toEqual([
      { from: "camox", text: BRIEF },
      { from: "editor", text: "Add a launch page" },
      { from: "editor", text: "Link it from pricing" },
      {
        from: "agent",
        text: `Saw: ${BRIEF} | Add a launch page | Link it from pricing. By ${teammate.name}.`,
      },
    ]);
    const senders = member
      .view()
      .messages.flatMap((message) => (message.from === "editor" ? [message.sender.name] : []));
    expect(senders).toEqual([teammate.name, teammate.name]);
    expect(Object.keys(await pagesOf(website, draftId))).toEqual(["/pricing", "/launch"]);
    expect(Object.keys(await pagesOf(website))).toEqual(["/pricing"]);
    member.close();
  });

  it("opens without a Brief, each message under its own sender, the run acting as the last's", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const teammate = await addMember(db, project.organizationId);
    const { draftId, threadId } = await draftWithThread(website);
    answerWithScript(CREATE_LAUNCH_PAGE);
    answerFrom(
      ({ editorMessages, scriptOutput }) =>
        `Saw: ${editorMessages.join(" | ")}. By ${scriptOutput}.`,
    );

    await env.THREAD.getByName(threadId).open({
      identity: { projectId: project.id, draftId, ownerId: null },
      apiOrigin: "http://api.camox.test",
      messages: [
        { operationId: crypto.randomUUID(), text: "Add a launch page", from: editorOf(memberUser) },
        { operationId: crypto.randomUUID(), text: "Call it Launch", from: editorOf(teammate) },
      ],
    });

    const member = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    await member.untilIdle(3);
    expect(said(member.view())).toEqual([
      { from: "editor", text: "Add a launch page" },
      { from: "editor", text: "Call it Launch" },
      { from: "agent", text: `Saw: Add a launch page | Call it Launch. By ${teammate.name}.` },
    ]);
    const senders = member
      .view()
      .messages.flatMap((message) => (message.from === "editor" ? [message.sender.name] : []));
    expect(senders).toEqual([memberUser.name, teammate.name]);
    member.close();
  });

  it("changes nothing when opened again", async () => {
    const website = await websiteFixture({ pricing: "Plans start at $9." });
    const { db, memberUser, project } = website;
    const { draftId, threadId } = await draftWithThread(website);
    answerNext("On it.");
    const opening = {
      identity: { projectId: project.id, draftId, ownerId: null },
      apiOrigin: "http://api.camox.test",
      brief: BRIEF,
      messages: [
        { operationId: crypto.randomUUID(), text: "Add a launch page", from: editorOf(memberUser) },
        {
          operationId: crypto.randomUUID(),
          text: "Link it from pricing",
          from: editorOf(memberUser),
        },
      ],
    };
    const thread = env.THREAD.getByName(threadId);

    await thread.open(opening);
    const member = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    await member.untilIdle(4);
    // Unscripted, a second run's model call would fail, showing a failed line.
    await thread.open(opening);
    await member.untilIdle();
    member.close();

    const reopened = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    expect(said(reopened.view())).toEqual([
      { from: "camox", text: BRIEF },
      { from: "editor", text: "Add a launch page" },
      { from: "editor", text: "Link it from pricing" },
      { from: "agent", text: "On it." },
    ]);
    reopened.close();
  });
});
