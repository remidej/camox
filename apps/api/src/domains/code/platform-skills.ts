import websiteDesign from "../../../skills/website-design/SKILL.md";
import { type SkillFiles, skillsSection } from "./skills";

// The platform's skills (apps/api/skills/README.md): each file of `apps/api/skills/<skill>/`, by
// its path there, imported as text (the `Text` rule of wrangler.jsonc). platform-skills.test.ts
// fails while a file there is missing here.

export const PLATFORM_SKILLS: SkillFiles = { "website-design/SKILL.md": websiteDesign };

/** The section of the agent's instructions listing the platform's skills. */
export const PLATFORM_SKILLS_SECTION = skillsSection(PLATFORM_SKILLS);
