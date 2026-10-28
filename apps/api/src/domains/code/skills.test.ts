import { describe, expect, it } from "vite-plus/test";

import { skillsSection } from "./skills";

const skill = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Skill\n`;

/** The skills `section` lists, by name, description and location. */
const listed = (section: string | undefined) =>
  [
    ...(section ?? "").matchAll(
      /<name>(.*)<\/name>\n.*<description>(.*)<\/description>\n.*<location>(.*)<\/location>/g,
    ),
  ].map(([, name, description, location]) => ({ name, description, location }));

describe("skillsSection", () => {
  it("lists each skill by its SKILL.md's frontmatter, however its YAML writes it", () => {
    expect(
      listed(
        skillsSection({
          "headlines/SKILL.md": skill(
            'name: headlines\ndescription: "Use when writing a headline."',
          ),
          "headlines/references/examples.md": skill("name: examples\ndescription: Not a skill."),
          "copywriting/SKILL.md": skill(
            "name: copywriting\ndescription: >\n  Use when writing\n  page copy.",
          ),
        }),
      ),
    ).toEqual([
      {
        name: "copywriting",
        description: "Use when writing page copy.",
        location: "/.camox/skills/copywriting/SKILL.md",
      },
      {
        name: "headlines",
        description: "Use when writing a headline.",
        location: "/.camox/skills/headlines/SKILL.md",
      },
    ]);
  });

  it("leaves out the skills the model shouldn't choose, or can't", () => {
    expect(
      skillsSection({
        "manual/SKILL.md": skill(
          "name: manual\ndescription: Only when asked.\ndisable-model-invocation: true",
        ),
        "unnamed/SKILL.md": skill("description: No name."),
        "undescribed/SKILL.md": skill("name: undescribed"),
        "plain/SKILL.md": "# No frontmatter\n",
      }),
    ).toBeUndefined();
  });
});
