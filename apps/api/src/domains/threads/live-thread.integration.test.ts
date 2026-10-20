import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { addMember, createProjectFixture } from "../../../test/fixtures";
import {
  answerNext,
  forgetThreadModel,
  holdNextAnswer,
  threadModelCalls,
} from "../../../test/thread-model";
import { connectLiveThread, requestLiveThread, said, signIn } from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

describe("an editor's Live thread", () => {
  it("answers a member's message, without showing the agent's thinking", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);
    answerNext("Your website has **three** pages.", { thinking: "Let me count the pages." });

    const thread = await connectLiveThread(project.id, token);
    expect(thread.view()).toEqual({ messages: [], running: false });

    thread.send({
      type: "send",
      operationId: crypto.randomUUID(),
      text: "How many pages are there?",
    });
    await thread.until(() => thread.view().messages.some((message) => message.from === "agent"));
    await thread.untilIdle();

    expect(thread.view().messages).toEqual([
      {
        id: expect.any(String),
        from: "editor",
        sender: { id: memberUser.id, name: memberUser.name, image: null },
        text: "How many pages are there?",
      },
      { id: expect.any(String), from: "agent", text: "Your website has **three** pages." },
    ]);
    thread.close();
  });

  it("shows a reconnecting editor where the thread is, agent still working", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);
    const release = holdNextAnswer("Done thinking.");
    const first = await connectLiveThread(project.id, token);
    first.send({ type: "send", operationId: crypto.randomUUID(), text: "Take your time" });
    await first.until(() => first.view().running);
    first.close();

    const again = await connectLiveThread(project.id, token);

    expect(again.view()).toEqual({
      messages: [expect.objectContaining({ from: "editor", text: "Take your time" })],
      running: true,
    });
    release();
    await again.untilIdle();
    expect(again.view().messages.at(-1)).toMatchObject({ from: "agent", text: "Done thinking." });
    again.close();
  });

  it("takes a message resent with the same operation id once", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);
    answerNext("First answer.");
    answerNext("Second answer.");
    const first = await connectLiveThread(project.id, token);
    const operationId = crypto.randomUUID();
    first.send({ type: "send", operationId, text: "Only once" });
    await first.until(() => first.frames.some((frame) => frame.type === "accepted"));
    first.close();

    // The studio lost the connection before it knew, and resends on reconnecting.
    const again = await connectLiveThread(project.id, token);
    again.send({ type: "send", operationId, text: "Only once" });
    await again.until(() => again.frames.some((frame) => frame.type === "accepted"));
    await again.until(
      () => !again.view().running && again.view().messages.some((m) => m.from === "agent"),
    );

    expect(said(again.view())).toEqual([
      { from: "editor", text: "Only once" },
      { from: "agent", text: "First answer." },
    ]);
    expect(threadModelCalls()).toBe(1);
    again.close();
  });

  it("shows an answer cut short as a turn the agent couldn't finish", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);
    answerNext("Your website has thr", { stopReason: "length" });
    const thread = await connectLiveThread(project.id, token);

    thread.send({ type: "send", operationId: crypto.randomUUID(), text: "How many pages?" });
    await thread.until(() =>
      thread.frames.some(
        (frame) => frame.type === "events" && frame.events.some((e) => e.type === "run_end"),
      ),
    );

    expect(thread.view().messages.map(({ from }) => from)).toEqual(["editor", "failed"]);
    thread.close();
  });

  it("turns down a malformed message, and still takes the next one", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, memberUser.id);
    answerNext("Got it.");
    const thread = await connectLiveThread(project.id, token);

    thread.send({ type: "send", text: "No operation id" } as never);
    await thread.until(() => thread.frames.some((frame) => frame.type === "error"));
    const operationId = crypto.randomUUID();
    thread.send({ type: "send", operationId, text: "Hello" });
    await thread.untilIdle(2);

    expect(
      thread.frames.filter((frame) => frame.type === "error" || frame.type === "accepted"),
    ).toEqual([
      { type: "error", message: expect.any(String) },
      { type: "accepted", operationId },
    ]);
    expect(threadModelCalls()).toBe(1);
    thread.close();
  });

  it("refuses someone who isn't a project member", async () => {
    const { db, outsiderUser, project } = await createProjectFixture(crypto.randomUUID());
    const token = await signIn(db, outsiderUser.id);

    const response = await requestLiveThread(project.id, token);

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it("refuses someone signed out", async () => {
    const { project } = await createProjectFixture(crypto.randomUUID());

    const response = await requestLiveThread(project.id, null);

    expect(response.status).toBe(401);
    expect(response.webSocket).toBeNull();
  });

  it("is private to its editor", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const teammate = await addMember(db, project.organizationId);
    answerNext("Hello!");
    const own = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    own.send({ type: "send", operationId: crypto.randomUUID(), text: "Hi" });
    await own.untilIdle(2);

    const theirs = await connectLiveThread(project.id, await signIn(db, teammate.id));

    expect(theirs.view().messages).toEqual([]);
    own.close();
    theirs.close();
  });
});
