import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { pushToMain } from "../../../test/pushes";
import { HERO, LOCKFILE, websiteWithCode } from "../../../test/revision-builds";
import { publishSkills, skillsOf } from "../../../test/skills";
import { answerFrom, answerWithToolCall, forgetThreadModel } from "../../../test/thread-model";
import {
  ask,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  signIn,
  type ThreadClient,
} from "../../../test/threads";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

// No platform skills, so the tree shows only what the camox version main installs mounts.
vi.mock("./platform-skills", async () => {
  const { skillsSection } = await import("./skills");
  return { PLATFORM_SKILLS: {}, PLATFORM_SKILLS_SECTION: skillsSection({}) };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** A lockfile installing `camox` `version`. */
const lockfileOf = (version: string) => LOCKFILE.replaceAll("1.0.0", version);

/**
 * Has the agent call the tool `name` with `args`, and returns what the tool answered it, as the
 * agent's answer shows it: without a last newline.
 */
async function toolResult(
  thread: ThreadClient,
  name: string,
  args: Parameters<typeof answerWithToolCall>[1],
) {
  answerWithToolCall(name, args);
  answerFrom(({ lastToolResult }) => lastToolResult);
  return lastAnswer(await ask(thread, `Call ${name}`, { keepOpen: true }));
}

describe("the agent reading the website's code", () => {
  it("lists, finds, searches and reads the files of Live's code, in a Live thread", async () => {
    const website = await websiteWithCode();
    const thread = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );

    // Git's own directory isn't shown; Camox's skills are.
    expect(await toolResult(thread, "ls", {})).toBe(".camox/\npackage.json\npnpm-lock.yaml\nsrc/");
    expect(await toolResult(thread, "ls", { path: "src/blocks" })).toBe("hero.tsx");
    expect(await toolResult(thread, "find", { pattern: "*.tsx", path: "src" })).toBe(
      "blocks/hero.tsx",
    );
    expect(await toolResult(thread, "grep", { pattern: "Welcome", path: "src" })).toBe(
      `blocks/hero.tsx:1: ${HERO.trimEnd()}`,
    );
    expect(await toolResult(thread, "read", { path: "src/blocks/hero.tsx" })).toBe(HERO.trimEnd());
    // Platform-owned files are readable too.
    expect(await toolResult(thread, "read", { path: "package.json" })).toContain(`"camox"`);
    thread.close();

    expect(await draftsOf(website)).toEqual([]);
  });

  it("reads the new contents once a push moved main", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectLiveThread(website.project.id, token);
    expect(await toolResult(thread, "read", { path: "src/blocks/hero.tsx" })).toBe(HERO.trimEnd());

    const changed = `export const hero = "Welcome back";\n`;
    await pushToMain(website.project.uuid, { "src/blocks/hero.tsx": changed });

    expect(await toolResult(thread, "read", { path: "src/blocks/hero.tsx" })).toBe(
      changed.trimEnd(),
    );
    // The tree no longer installs `camox`: no skills are mounted.
    expect(await toolResult(thread, "ls", {})).toBe("src/");
    thread.close();
  });

  it("is told the hosted website's rules, and where Camox's skill is", async () => {
    const website = await websiteWithCode();
    const thread = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );
    let instructions = "";
    answerFrom((request) => {
      instructions = request.instructions;
      return "Noted.";
    });
    await ask(thread, "How do I add tabs?");
    thread.close();

    // The rules the spec lists for a hosted website (spec #560, section 16).
    expect(instructions).toContain("Google Fonts");
    expect(instructions).toContain("SEO links belong to Camox");
    expect(instructions).toContain("You can't add a dependency");
    expect(instructions).toContain("A block's file name is its id");
    expect(instructions).toContain("`/.camox/skills/camox/`");
    expect(instructions).toContain("Read its `SKILL.md`");
  });

  it("reads the skills of the camox version main installs, the CLI's left out", async () => {
    const website = await websiteWithCode();
    const thread = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );

    const skills = skillsOf("1.0.0");
    expect(await toolResult(thread, "ls", { path: ".camox/skills" })).toBe("camox/");
    expect(await toolResult(thread, "read", { path: ".camox/skills/camox/SKILL.md" })).toBe(
      skills["camox/SKILL.md"].trimEnd(),
    );
    expect(
      await toolResult(thread, "read", {
        path: ".camox/skills/camox/references/block-definitions.md",
      }),
    ).toBe(skills["camox/references/block-definitions.md"].trimEnd());
    thread.close();
  });

  it("reads the skills of the camox version an Upgrade moved main to", async () => {
    const website = await websiteWithCode();
    const thread = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );
    const read = () => toolResult(thread, "read", { path: ".camox/skills/camox/SKILL.md" });
    expect(await read()).toBe(skillsOf("1.0.0")["camox/SKILL.md"].trimEnd());

    const version = `1.0.0-${crypto.randomUUID()}`;
    await publishSkills(version);
    await pushToMain(website.project.uuid, { "pnpm-lock.yaml": lockfileOf(version) });

    expect(await read()).toBe(skillsOf(version)["camox/SKILL.md"].trimEnd());
    thread.close();
  });

  it("reads the code without skills when its camox version has none", async () => {
    const website = await websiteWithCode();
    const version = `1.0.0-${crypto.randomUUID()}`;
    await pushToMain(website.project.uuid, {
      "pnpm-lock.yaml": lockfileOf(version),
      "src/blocks/hero.tsx": HERO,
    });
    const thread = await connectLiveThread(
      website.project.id,
      await signIn(website.db, website.memberUser.id),
    );

    expect(await toolResult(thread, "ls", {})).toBe("pnpm-lock.yaml\nsrc/");
    expect(await toolResult(thread, "read", { path: "src/blocks/hero.tsx" })).toBe(HERO.trimEnd());
    thread.close();
  });
});
