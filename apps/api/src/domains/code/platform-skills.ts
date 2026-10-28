import { type SkillFiles, skillsSection } from "./skills";

// The platform's skills (apps/api/skills/README.md): each file of `apps/api/skills/<skill>/`, by
// its path there, imported as text (the `Text` rule of wrangler.jsonc). platform-skills.test.ts
// fails while a file there is missing here. For example:
//
//   import copywriting from "../../../skills/copywriting/SKILL.md";
//
//   export const PLATFORM_SKILLS: SkillFiles = { "copywriting/SKILL.md": copywriting };

export const PLATFORM_SKILLS: SkillFiles = {};

/** The section of the agent's instructions listing the platform's skills. */
export const PLATFORM_SKILLS_SECTION = skillsSection(PLATFORM_SKILLS);
