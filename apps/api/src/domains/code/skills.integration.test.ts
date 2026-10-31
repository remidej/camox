import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startDraft } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import { HERO, websiteWithCode } from "../../../test/revision-builds";
import { skillsOf } from "../../../test/skills";
import {
  answerFrom,
  answerWithCodeRequest,
  answerWithToolCall,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  lastAnswer,
  signIn,
  type ThreadClient,
  type Website,
} from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** The thread of a new draft of `website`, as its member, open. */
async function draftThreadOf({ db, project, memberUser }: Website) {
  const draftId = await startDraft(db, project.id, memberUser.id);
  return connectDraftThread(project.id, draftId, await signIn(db, memberUser.id));
}

/** The skills section of the instructions the Code Agent answers `message` with. */
async function listedSkills(thread: ThreadClient, message: string) {
  let instructions = "";
  answerWithCodeRequest(message);
  answerFrom((request) => {
    instructions = request.instructions;
    return "Noted.";
  });
  await ask(thread, message, { keepOpen: true });
  return instructions.slice(instructions.indexOf("The following skills"));
}

/** The instructions the thread's agent answers `message` with. */
async function threadAgentInstructions(thread: ThreadClient, message: string) {
  let instructions = "";
  answerFrom((request) => {
    instructions = request.instructions;
    return "Noted.";
  });
  await ask(thread, message, { keepOpen: true });
  return instructions;
}

/** Has the Code Agent read `path`, and returns what it read, without a last newline. */
async function read(thread: ThreadClient, path: string) {
  answerWithCodeRequest();
  answerWithToolCall("read", { path });
  answerFrom(({ lastToolResult }) => lastToolResult);
  return lastAnswer(await ask(thread, `Read ${path}`, { keepOpen: true }));
}

describe("the platform's skills", () => {
  it("give the Code Agent the design skill, listed by its frontmatter and read beside the camox version's", async () => {
    const website = await websiteWithCode();
    const thread = await draftThreadOf(website);

    const listed = await listedSkills(thread, "Rewrite the hero");
    expect(listed).toMatch(
      /<name>website-design<\/name>\n {4}<description>.+<\/description>\n {4}<location>\/\.camox\/skills\/website-design\/SKILL\.md<\/location>/,
    );
    expect(listed).not.toContain("page-composition");
    expect(await read(thread, "/.camox/skills/website-design/SKILL.md")).toMatch(
      /^---\nname: website-design\n/,
    );
    expect(await read(thread, "/.camox/skills/camox/SKILL.md")).toBe(
      skillsOf("1.0.0")["camox/SKILL.md"].trimEnd(),
    );
    thread.close();
  });

  it("give the thread's agent the page composition skill, whole in its instructions, which the Code Agent never reads", async () => {
    const website = await websiteWithCode();
    const thread = await draftThreadOf(website);

    const instructions = await threadAgentInstructions(thread, "Add a block to the home page");
    expect(instructions).toMatch(
      /<skill>\n<name>page-composition<\/name>\n<description>.+<\/description>\n\n# Page composition\n/,
    );
    expect(instructions).not.toContain("website-design");
    expect(await read(thread, "/.camox/skills/page-composition/SKILL.md")).toContain("ENOENT");
    thread.close();
  });

  it("are read when the code installs no camox", async () => {
    const website = await websiteWithCode();
    await pushToMain(website.project.uuid, { "src/blocks/hero.tsx": HERO });
    const thread = await draftThreadOf(website);

    expect(await read(thread, "/.camox/skills/website-design/SKILL.md")).toMatch(
      /^---\nname: website-design\n/,
    );
    thread.close();
  });
});
