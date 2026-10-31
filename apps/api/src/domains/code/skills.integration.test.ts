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

// Platform skills of the tests' own, one per agent, as apps/api/skills would ship them.
const { COPYWRITING, PAGE_RHYTHM } = vi.hoisted(() => ({
  COPYWRITING: {
    "copywriting/SKILL.md":
      "---\nname: copywriting\ndescription: Use when writing headlines & page copy.\n---\n\n# Copywriting\n\nRead [Headlines](references/headlines.md).\n",
    "copywriting/references/headlines.md": "# Headlines\n\nLead with the benefit.\n",
  },
  PAGE_RHYTHM: {
    "page-rhythm/SKILL.md":
      "---\nname: page-rhythm\ndescription: Use when composing a page.\n---\n\n# Page rhythm\n\nAlternate light & dark blocks.\n",
  },
}));
vi.mock("./platform-skills", async () => {
  const { inlinedSkillsSection, skillsSection } = await import("./skills");
  return {
    PLATFORM_SKILLS: { ...COPYWRITING, ...PAGE_RHYTHM },
    CODE_AGENT_SKILLS: COPYWRITING,
    CODE_AGENT_SKILLS_SECTION: skillsSection(COPYWRITING),
    THREAD_AGENT_SKILLS_SECTION: inlinedSkillsSection(PAGE_RHYTHM),
  };
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
  it("are listed by their frontmatter, and read beside the camox version's", async () => {
    const website = await websiteWithCode();
    const thread = await draftThreadOf(website);

    expect(await listedSkills(thread, "Rewrite the hero")).toBe(
      [
        "The following skills provide specialized instructions for specific tasks.",
        "Use the read tool to load a skill's file when the task matches its description.",
        "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
        "",
        "<available_skills>",
        "  <skill>",
        "    <name>copywriting</name>",
        "    <description>Use when writing headlines &amp; page copy.</description>",
        "    <location>/.camox/skills/copywriting/SKILL.md</location>",
        "  </skill>",
        "</available_skills>",
      ].join("\n"),
    );
    expect(await read(thread, "/.camox/skills/copywriting/references/headlines.md")).toBe(
      COPYWRITING["copywriting/references/headlines.md"].trimEnd(),
    );
    expect(await read(thread, "/.camox/skills/camox/SKILL.md")).toBe(
      skillsOf("1.0.0")["camox/SKILL.md"].trimEnd(),
    );
    thread.close();
  });

  it("are the Code Agent's or the thread's agent's, which follows its own in its instructions", async () => {
    const website = await websiteWithCode();
    const thread = await draftThreadOf(website);

    const instructions = await threadAgentInstructions(thread, "Add a section to the home page");
    expect(instructions).toContain(
      [
        "<skill>",
        "<name>page-rhythm</name>",
        "<description>Use when composing a page.</description>",
        "",
        "# Page rhythm",
        "",
        "Alternate light & dark blocks.",
        "</skill>",
      ].join("\n"),
    );
    expect(instructions).not.toContain("copywriting");
    expect(await listedSkills(thread, "Add a hero block")).not.toContain("page-rhythm");
    expect(await read(thread, "/.camox/skills/page-rhythm/SKILL.md")).toContain("ENOENT");
    thread.close();
  });

  it("are read when the code installs no camox", async () => {
    const website = await websiteWithCode();
    await pushToMain(website.project.uuid, { "src/blocks/hero.tsx": HERO });
    const thread = await draftThreadOf(website);

    expect(await read(thread, "/.camox/skills/copywriting/SKILL.md")).toBe(
      COPYWRITING["copywriting/SKILL.md"].trimEnd(),
    );
    thread.close();
  });
});
