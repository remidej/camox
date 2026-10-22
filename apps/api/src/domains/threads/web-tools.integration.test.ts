import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { answerFrom, answerWithToolCall, forgetThreadModel } from "../../../test/thread-model";
import { ask, connectLiveThread, lastAnswer, signIn, websiteFixture } from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

describe("the agent reading the web", () => {
  it("reads a page an editor links to, marked as untrusted", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", { url: "https://website.camox.test/contact" });
    answerFrom(({ lastToolResult }) => lastToolResult);

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    const view = await ask(
      thread,
      "Copy the opening hours from https://website.camox.test/contact",
    );

    const page = lastAnswer(view)!;
    expect(page).toContain("<untrusted_web_content>");
    expect(page).toContain("Opening hours: 9am to 5pm.");
  });

  it("refuses to read the API's private network", async () => {
    const { db, memberUser, project } = await websiteFixture({ contact: "Call us." });
    answerWithToolCall("web_fetch", { url: "http://localhost:8787/" });
    answerFrom(({ lastToolResult }) => lastToolResult);

    const thread = await connectLiveThread(project.id, await signIn(db, memberUser.id));
    const view = await ask(thread, "Read http://localhost:8787/");

    expect(lastAnswer(view)).toContain("private or local address");
  });
});
