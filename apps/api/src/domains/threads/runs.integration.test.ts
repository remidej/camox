import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture, startDraft } from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  failNext,
  forgetThreadModel,
  holdNextAnswer,
  holdNextScript,
} from "../../../test/thread-model";
import {
  connectDraftThread,
  lastAnswer,
  pagesOf,
  said,
  signIn,
  storedThreadOf,
  type ThreadClient,
  touchedOf,
} from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

/** Tool calls the test holds by tool name, until it lets them go. */
const held = vi.hoisted(() => new Map<string, Promise<void>>());

// A held tool call waits before it runs, so a script can be stopped mid-way.
vi.mock("../agent/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/service")>();
  const { Effect } = await import("effect");
  const dispatchTool: typeof actual.dispatchTool = (ctx, call) =>
    Effect.promise(() => held.get(call.name) ?? Promise.resolve()).pipe(
      Effect.andThen(actual.dispatchTool(ctx, call)),
    );
  return { ...actual, dispatchTool };
});

/** Holds the next calls to the tool `name` until the returned function is called. */
const holdTool = (name: string) => {
  let release!: () => void;
  held.set(
    name,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return () => {
    held.delete(name);
    release();
  };
};

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** The thread of a draft the fixture member started, opened as their studio does in it. */
async function openThread() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const draftId = await startDraft(fixture.db, fixture.project.id, fixture.memberUser.id);
  const thread = await connectDraftThread(
    fixture.project.id,
    draftId,
    await signIn(fixture.db, fixture.memberUser.id),
  );
  return { ...fixture, draftId, thread };
}

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

type Fakes = { emailsSent(): Promise<{ subject: string; text: string }[]> };

/** The emails about a project: every alert names its Project ID. */
async function emailsAbout(projectId: string) {
  return (await fakes.emailsSent()).filter(({ text }) => text.includes(projectId));
}

/** Waits until the draft `draftId` has a page at `/launch`, as a script's write made it. */
async function untilLaunched(fixture: Parameters<typeof pagesOf>[0], draftId: string) {
  const deadline = Date.now() + 10_000;
  while (!("/launch" in (await pagesOf(fixture, draftId)))) {
    if (Date.now() > deadline) throw new Error("The launch page never appeared");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Sends `text` in `thread`, returning its operation id. */
const send = (thread: ThreadClient, text: string) => {
  const operationId = crypto.randomUUID();
  thread.send({ type: "send", operationId, text });
  return operationId;
};

describe("a run in a thread", () => {
  it("takes a message sent while the agent works into that run's final message", async () => {
    const { thread } = await openThread();
    const release = holdNextScript(`text((await tools.listPages({})).length);`);
    answerFrom(({ editorMessages }) =>
      editorMessages.includes("Only the blog, actually")
        ? "I looked at the blog only."
        : "I looked at every page.",
    );
    send(thread, "Review our pages");
    await thread.until(() => thread.view().running);

    const steer = send(thread, "Only the blog, actually");
    await thread.until(() =>
      thread.frames.some((frame) => frame.type === "accepted" && frame.operationId === steer),
    );
    release();
    await thread.untilIdle();

    expect(said(thread.view())).toEqual([
      { from: "editor", text: "Review our pages" },
      { from: "editor", text: "Only the blog, actually" },
      { from: "agent", text: "I looked at the blog only." },
    ]);
    thread.close();
  });

  it("reports what each writing script of a run touched as it ends", async () => {
    const { thread } = await openThread();
    answerWithScript(`
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      text(page.id);
    `);
    answerWithScript(`
      const { page } = await tools.createPage({ pathSegment: "about", layoutId: "default" });
      text(page.id);
    `);
    answerFrom(({ scriptOutput }) => scriptOutput);
    const operationId = send(thread, "Add a launch page, then an about page");
    await thread.untilIdle(2);

    const pagesCreated = touchedOf(thread).map(({ operationIds, touches }) => ({
      operationIds,
      pages: touches.map((touch) => touch.entity === "page" && touch.pageId),
    }));
    expect(pagesCreated).toEqual([
      { operationIds: [operationId], pages: [expect.any(String)] },
      { operationIds: [operationId], pages: [lastAnswer(thread.view())] },
    ]);
    expect(pagesCreated[0]?.pages).not.toEqual(pagesCreated[1]?.pages);
    thread.close();
  });

  it("gives a reconnecting socket no touches from before", async () => {
    const { thread, project, db, memberUser, draftId } = await openThread();
    answerWithScript(`await tools.createPage({ pathSegment: "launch", layoutId: "default" });`);
    answerNext("Added a launch page.");
    send(thread, "Add a launch page");
    await thread.untilIdle(2);
    expect(touchedOf(thread)).toHaveLength(1);
    thread.close();

    const again = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    await again.untilIdle(2);

    expect(touchedOf(again)).toEqual([]);
    again.close();
  });

  it("reports the writes of a script an editor stops, keeping none of them", async () => {
    const fixture = await openThread();
    const { thread, db, draftId } = fixture;
    const release = holdTool("listPages");
    answerWithScript(`
      await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      await tools.listPages({});
    `);
    const operationId = send(thread, "Add a launch page, then check every page");
    try {
      // The write went through; the script waits on its read.
      await untilLaunched(fixture, draftId);
      thread.send({ type: "stop" });
      // The run ends once the call it waits on returns.
      await thread.until(() => thread.view().messages.some(({ from }) => from === "stopped"));
    } finally {
      release();
    }
    await thread.untilIdle(2);

    expect(touchedOf(thread)).toEqual([
      {
        operationIds: [operationId],
        touches: [expect.objectContaining({ entity: "page", kind: "created" })],
      },
    ]);
    const { keys } = await storedThreadOf(db, draftId);
    expect(keys.filter((key) => key.startsWith("camox.touches:"))).toEqual([]);
    thread.close();
  });

  it("reports a write that goes through after its script was stopped, keeping none of it", async () => {
    const fixture = await openThread();
    const { thread, db, draftId } = fixture;
    const release = holdTool("createBlock");
    answerWithScript(`
      const { page } = await tools.createPage({ pathSegment: "launch", layoutId: "default" });
      await tools.createBlock({ pageId: page.id, type: "text", content: { body: "Hi" } });
    `);
    const operationId = send(thread, "Add a launch page with an intro");
    try {
      await untilLaunched(fixture, draftId);
      thread.send({ type: "stop" });
      // The run ends once the call it waits on returns.
      await thread.until(() => thread.view().messages.some(({ from }) => from === "stopped"));
    } finally {
      release();
    }
    await thread.untilIdle(2);
    await thread.until(() => touchedOf(thread).flatMap(({ touches }) => touches).length === 2);

    expect(touchedOf(thread)).toEqual([
      {
        operationIds: [operationId],
        touches: [expect.objectContaining({ entity: "page", kind: "created" })],
      },
      {
        operationIds: [operationId],
        touches: [expect.objectContaining({ entity: "page", blockId: expect.any(String) })],
      },
    ]);
    const { keys } = await storedThreadOf(db, draftId);
    expect(keys.filter((key) => key.startsWith("camox.touches:"))).toEqual([]);
    thread.close();
  });

  it("ends a run an editor stops, saying who stopped it", async () => {
    const { thread, memberUser } = await openThread();
    holdNextAnswer("I rewrote every page.");
    send(thread, "Rewrite every page");
    await thread.until(() => thread.view().running);

    thread.send({ type: "stop" });
    await thread.untilIdle(2);

    expect(thread.view().messages).toEqual([
      expect.objectContaining({ from: "editor", text: "Rewrite every page" }),
      {
        id: expect.any(String),
        from: "stopped",
        sender: { id: memberUser.id, name: memberUser.name, image: null },
      },
    ]);
    thread.close();
  });

  it("keeps what the agent did before a stop", async () => {
    const { thread, project, db, memberUser, draftId } = await openThread();
    answerNext("You have no pages yet.");
    send(thread, "Which pages do we have?");
    await thread.untilIdle(2);
    answerWithScript(`text("Counted 0 pages");`);
    holdNextAnswer("Here's the full audit.");
    send(thread, "Audit every page");
    await thread.until(() => thread.view().running);
    thread.send({ type: "stop" });
    await thread.untilIdle(4);
    thread.close();

    const again = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
    answerFrom(({ scriptOutput }) => `Before you stopped me: ${scriptOutput}`);
    send(again, "What did you find?");
    await again.untilIdle(6);

    expect(again.view().messages.map(({ from }) => from)).toEqual([
      "editor",
      "agent",
      "editor",
      "stopped",
      "editor",
      "agent",
    ]);
    expect(again.view().messages.at(-1)).toMatchObject({
      text: "Before you stopped me: Counted 0 pages",
    });
    again.close();
  });

  it("changes nothing when stopped with no run going", async () => {
    const { thread } = await openThread();
    answerNext("Hello!");
    send(thread, "Hi");
    await thread.untilIdle(2);

    thread.send({ type: "stop" });
    answerNext("Still here.");
    send(thread, "Are you there?");
    await thread.untilIdle(4);

    expect(thread.view().messages.map(({ from }) => from)).toEqual([
      "editor",
      "agent",
      "editor",
      "agent",
    ]);
    thread.close();
  });

  it("says when the agent couldn't finish a turn", async () => {
    const { thread } = await openThread();
    failNext();

    send(thread, "Rewrite the home page");
    await thread.untilIdle(2);

    expect(thread.view().messages).toEqual([
      expect.objectContaining({ from: "editor", text: "Rewrite the home page" }),
      { id: expect.any(String), from: "failed" },
    ]);
    thread.close();
  });

  it("alerts once when OpenRouter turns the agent down for lack of credit", async () => {
    const { thread, project } = await openThread();
    const outOfCredit =
      '402 {"type":"error","error":{"type":"billing_error","message":"This request requires more credits, or fewer max_tokens."}}';
    failNext({ errorMessage: outOfCredit });
    send(thread, "Rewrite the home page");
    await thread.untilIdle(2);
    failNext({ errorMessage: outOfCredit });

    send(thread, "Rewrite the home page");
    await thread.untilIdle(4);

    expect(await emailsAbout(project.uuid)).toEqual([
      expect.objectContaining({
        subject: "Camox's agent is out of OpenRouter credit",
        text: expect.stringContaining("This request requires more credits"),
      }),
    ]);
    thread.close();
  });

  it("doesn't alert when a model call fails for a reason of its own", async () => {
    const { thread, project } = await openThread();
    failNext();

    send(thread, "Rewrite the home page");
    await thread.untilIdle(2);

    expect(await emailsAbout(project.uuid)).toEqual([]);
    thread.close();
  });

  it("answers a message sent again after a failed turn, still showing the failure", async () => {
    const { thread } = await openThread();
    failNext();
    send(thread, "Rewrite the home page");
    await thread.untilIdle(2);
    answerNext("Done.");

    send(thread, "Rewrite the home page");
    await thread.untilIdle(4);

    expect(thread.view().messages.map(({ from }) => from)).toEqual([
      "editor",
      "failed",
      "editor",
      "agent",
    ]);
    thread.close();
  });

  it("keeps working while Pi retries a failed model call", async () => {
    const { thread } = await openThread();
    failNext({ retryable: true });
    answerNext("Done, on the second try.");

    send(thread, "Rewrite the home page");
    await thread.until(() =>
      thread.frames.some(
        (frame) =>
          frame.type === "events" && frame.events.some((e) => e.type === "auto_retry_start"),
      ),
    );
    expect(thread.view()).toEqual({
      messages: [expect.objectContaining({ from: "editor" })],
      running: true,
      activity: "thinking",
    });
    await thread.untilIdle();

    expect(thread.view().messages.map(({ from }) => from)).toEqual(["editor", "agent"]);
    thread.close();
  });

  it("still shows a failed turn to an editor connecting afterwards", async () => {
    const { thread, project, db, memberUser, draftId } = await openThread();
    failNext();
    send(thread, "Rewrite the home page");
    await thread.untilIdle(2);
    thread.close();

    const again = await connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));

    expect(again.view()).toEqual(thread.view());
    again.close();
  });
});
