import pageComposition from "../../../skills/page-composition/SKILL.md";
import websiteDesign from "../../../skills/website-design/SKILL.md";
import { inlinedSkillsSection, type SkillFiles, skillsSection } from "./skills";

// The platform's skills (apps/api/skills/README.md): each file of `apps/api/skills/<skill>/`, by
// its path there, imported as text (the `Text` rule of wrangler.jsonc). Each skill is one agent's,
// so each reads only its own job's. platform-skills.test.ts fails while a file there is missing
// here.

/** The Code Agent's: mounted beside the code, listed in its instructions, read when they match. */
export const CODE_AGENT_SKILLS: SkillFiles = { "website-design/SKILL.md": websiteDesign };

/** The thread's agent's, which can't read files: held whole in its instructions. */
export const THREAD_AGENT_SKILLS: SkillFiles = { "page-composition/SKILL.md": pageComposition };

export const PLATFORM_SKILLS: SkillFiles = { ...CODE_AGENT_SKILLS, ...THREAD_AGENT_SKILLS };

/** The section of the Code Agent's instructions listing its platform skills. */
export const CODE_AGENT_SKILLS_SECTION = skillsSection(CODE_AGENT_SKILLS);

/** The section of the thread's agent's instructions holding its platform skills. */
export const THREAD_AGENT_SKILLS_SECTION = inlinedSkillsSection(THREAD_AGENT_SKILLS);
