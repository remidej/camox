import { env } from "cloudflare:workers";

import { skillsKey } from "../src/domains/code/skills";

// The skills each `camox` version ships, as the SDK's publish uploads them to `SKILLS`
// (scripts/upload-skills.mjs): fixtures of their own, so tests show which version's the agent
// reads.

/** A version's skills, `camox` and the CLI's, each SKILL.md naming the version. */
export const skillsOf = (version: string) => ({
  "camox/SKILL.md": `# Camox ${version}\n\nRead [Block Definitions](references/block-definitions.md).\n`,
  "camox/references/block-definitions.md": `# Block Definitions of ${version}\n\nUse createBlock.\n`,
  "camox-cli/SKILL.md": `# Camox CLI ${version}\n`,
});

/** Uploads `skillsOf(version)` as the publish of `version` does. */
export async function publishSkills(version: string) {
  await env.SKILLS.put(skillsKey(version), JSON.stringify(skillsOf(version)));
}
