import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  CODE_AGENT_SKILLS_SECTION,
  PLATFORM_SKILLS,
  THREAD_AGENT_SKILLS_SECTION,
} from "./platform-skills";

const API_ROOT = path.join(import.meta.dirname, "../../..");

/** Each file of each skill folder in `dir`, by its path there, to its text. */
function skillFiles(dir: string) {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
      .filter((file) => file.includes(path.sep))
      .map((file) => [file.split(path.sep).join("/"), readFileSync(path.join(dir, file), "utf-8")]),
  );
}

const skillNames = (files: Record<string, string>) =>
  [...new Set(Object.keys(files).map((file) => file.split("/")[0]))].sort();

describe("the platform's skills", () => {
  it("are every file of apps/api/skills", () => {
    expect(PLATFORM_SKILLS).toEqual(skillFiles(path.join(API_ROOT, "skills")));
  });

  it("each have a SKILL.md, and a name none of the SDK's skills has", () => {
    const names = skillNames(PLATFORM_SKILLS);
    for (const name of names) expect(PLATFORM_SKILLS).toHaveProperty([`${name}/SKILL.md`]);
    const sdk = skillNames(skillFiles(path.join(API_ROOT, "../../packages/sdk/skills")));
    expect(names.filter((name) => sdk.includes(name))).toEqual([]);
  });

  it("give the Code Agent the design skill, and the thread's agent the page composition skill", () => {
    expect(CODE_AGENT_SKILLS_SECTION).toContain("<name>website-design</name>");
    expect(CODE_AGENT_SKILLS_SECTION).not.toContain("page-composition");
    expect(THREAD_AGENT_SKILLS_SECTION).toContain(
      PLATFORM_SKILLS["page-composition/SKILL.md"].split("\n---\n")[1].trim(),
    );
    expect(THREAD_AGENT_SKILLS_SECTION).not.toContain("website-design");
  });
});
