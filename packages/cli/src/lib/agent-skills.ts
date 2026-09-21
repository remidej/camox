import fs from "node:fs";
import path from "node:path";

export function createAgentSkillLinks(targetDir: string) {
  const agentsSkillsDir = path.join(targetDir, ".agents", "skills");
  const claudeSkillsDir = path.join(targetDir, ".claude", "skills");
  fs.mkdirSync(agentsSkillsDir, { recursive: true });
  fs.mkdirSync(claudeSkillsDir, { recursive: true });
  for (const skill of ["camox", "camoxify"]) {
    fs.symlinkSync(`../../node_modules/camox/skills/${skill}`, path.join(agentsSkillsDir, skill));
    fs.symlinkSync(`../../.agents/skills/${skill}`, path.join(claudeSkillsDir, skill));
  }
}
