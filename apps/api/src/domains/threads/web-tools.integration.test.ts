import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  answerFrom,
  answerWithMessages,
  answerWithToolCall,
  forgetThreadModel,
  threadModelCalls,
} from "../../../test/thread-model";
import { ask, connectLiveThread, lastAnswer, signIn, websiteFixture } from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter. It
// stands in for the page reader too, whose answer is scripted between the agent's call and its
// next answer.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** What the page reader was asked, the last time it read a page. */
const readerSaw = () => {
  let seen = "";
  answerFrom(({ editorMessages }) => {
    seen = editorMessages.join("\n");
    return "Monday to Friday, 9am to 5pm.";
  });
  return () => seen;
};

describe("the agent reading the web", () => {
  it("answers the agent's question from a page another model reads, marked as untrusted", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", {
      url: "https://website.camox.test/contact",
      prompt: "The opening hours, word for word",
    });
    const reader = readerSaw();
    answerFrom(({ lastToolResult }) => lastToolResult);

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    const view = await ask(
      thread,
      "Copy the opening hours from https://website.camox.test/contact",
    );

    expect(reader()).toContain("<untrusted_web_content>");
    expect(reader()).toContain("Opening hours: 9am to 5pm.");
    expect(reader()).toContain("The opening hours, word for word");
    const answer = lastAnswer(view)!;
    expect(answer).toContain("https://website.camox.test/contact");
    expect(answer).toContain("Monday to Friday, 9am to 5pm.");
  });

  it("keeps the page out of the agent's conversation", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", {
      url: "https://website.camox.test/contact",
      prompt: "The opening hours",
    });
    readerSaw();
    let conversation = "";
    answerWithMessages((messages) => {
      conversation = JSON.stringify(messages);
      return "Done.";
    });

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    await ask(thread, "What are the opening hours on https://website.camox.test/contact?");

    expect(conversation).toContain("Monday to Friday, 9am to 5pm.");
    expect(conversation).not.toContain("Opening hours: 9am to 5pm.");
    expect(conversation).not.toContain("untrusted_web_content");
  });

  it("counts the page reader's spend under web_fetch", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", {
      url: "https://website.camox.test/contact",
      prompt: "The opening hours",
    });
    readerSaw();
    answerFrom(() => "Done.");

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    await ask(thread, "What are the opening hours on https://website.camox.test/contact?", {
      keepOpen: true,
    });

    const spent = thread.frames
      .flatMap((frame) => (frame.type === "events" ? frame.events : []))
      .flatMap((event) => ("usage" in event && "tools" in event.usage ? [event.usage] : []))
      .at(-1);
    thread.close();
    expect(spent?.tools.web_fetch?.input).toBeGreaterThan(0);
  });

  it("refuses to read the API's private network, without asking the reader", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", { url: "http://localhost:8787/", prompt: "What's there?" });
    answerFrom(({ lastToolResult }) => lastToolResult);

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    const view = await ask(thread, "Read http://localhost:8787/");

    expect(lastAnswer(view)).toContain("private or local address");
    expect(threadModelCalls()).toBe(2);
  });
});
