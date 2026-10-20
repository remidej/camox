import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture } from "../../../test/fixtures";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  failNext,
  forgetThreadModel,
  holdNextAnswer,
  holdNextScript,
} from "../../../test/thread-model";
import { connectLiveThread, said, signIn, type ThreadClient } from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** The fixture member's Live thread, opened as their studio does. */
async function openThread() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const thread = await connectLiveThread(
    fixture.project.id,
    await signIn(fixture.db, fixture.memberUser.id),
  );
  return { ...fixture, thread };
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
    const { thread, project, db, memberUser } = await openThread();
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

    const again = await connectLiveThread(project.id, await signIn(db, memberUser.id));
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
    });
    await thread.untilIdle();

    expect(thread.view().messages.map(({ from }) => from)).toEqual(["editor", "agent"]);
    thread.close();
  });

  it("still shows a failed turn to an editor connecting afterwards", async () => {
    const { thread, project, db, memberUser } = await openThread();
    failNext();
    send(thread, "Rewrite the home page");
    await thread.untilIdle(2);
    thread.close();

    const again = await connectLiveThread(project.id, await signIn(db, memberUser.id));

    expect(again.view()).toEqual(thread.view());
    again.close();
  });
});
