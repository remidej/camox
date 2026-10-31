import { parse as parseYaml } from "yaml";

// The agent's skills, mounted read-only beside the code, each a folder with its `SKILL.md`:
//
// - Camox's, as the `camox` version a project installs ships them: each SDK publish uploads its
//   `skills/` to `SKILLS` under its version (apps/api/scripts/upload-skills.mjs), and the agent
//   reads the version the project's lockfile installs, as a local agent reads them through
//   `node_modules`. The API never holds a copy of its own, so it can't drift from the SDK's.
// - The platform's, which the API ships for tasks beyond the code, such as writing copy
//   (apps/api/skills/README.md).
//
// The Code Agent's instructions list its platform skills by their frontmatter (`skillsSection`),
// and it reads one when a task matches it, as Pi's coding agent does. The thread's agent, which
// can't read files, has its platform skills held whole in its instructions
// (`inlinedSkillsSection`). Camox's skill isn't listed: the
// instructions for the code tell the agent to read it before any change (prompt.ts).

/** The skills the agent reads: the others drive the CLI, which it works without. */
export const HOSTED_SKILLS = ["camox"] as const;

/** Where the skills are mounted in the agent's environment, read-only, beside the code. */
export const SKILLS_ROOT = "/.camox/skills";

/** Skills' files: each one's path under `skills/`, such as `camox/SKILL.md`, to its text. */
export type SkillFiles = Record<string, string>;

/** The object of `SKILLS` holding the skills `camox` `version` ships. */
export const skillsKey = (version: string) => `${version}.json`;

/** The skills of each version read so far: a published version's never change. */
const read = new Map<string, Promise<SkillFiles>>();

/**
 * The hosted skills `camox` `version` ships, or null when `bucket` has none for it, as for a
 * version published before they were uploaded.
 */
export async function skillsAt(bucket: R2Bucket, version: string): Promise<SkillFiles | null> {
  const known = read.get(version);
  if (known) return known;
  const object = await bucket.get(skillsKey(version));
  if (!object) return null;
  const files = object
    .json<SkillFiles>()
    .then((all) =>
      Object.fromEntries(
        Object.entries(all).filter(([path]) =>
          HOSTED_SKILLS.some((skill) => path.startsWith(`${skill}/`)),
        ),
      ),
    );
  read.set(version, files);
  files.catch(() => read.delete(version));
  return files;
}

/**
 * The section of the agent's instructions listing the skills in `files`, by the name and
 * description each `SKILL.md`'s frontmatter gives, where they're mounted, or undefined when none
 * is listed. Its wording and format are Pi's coding agent's, `@earendil-works/pi-coding-agent`
 * 1.3.0 (`formatSkillsForPrompt` in `dist/core/skills.js`), which isn't installed: models know it.
 */
export function skillsSection(files: SkillFiles) {
  const skills = Object.entries(files)
    .filter(([path]) => /^[^/]+\/SKILL\.md$/.test(path))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, text]) => {
      const location = `${SKILLS_ROOT}/${path}`;
      const data = frontmatterOf(text);
      const { name, description } = data;
      if (data["disable-model-invocation"] === true) return [];
      if (typeof name !== "string" || typeof description !== "string" || !description.trim()) {
        console.error(`The skill in ${location} has no name or description: it isn't listed`);
        return [];
      }
      return [{ name: name.trim(), description: description.trim(), location }];
    });
  if (skills.length === 0) return undefined;
  return [
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
    ...skills.flatMap((skill) => [
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.location)}</location>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n");
}

/**
 * The section of the instructions of an agent that can't read files, holding each skill of
 * `files` whole: its name and description, then its `SKILL.md` past the frontmatter. Such a skill
 * is its `SKILL.md` alone, since the agent couldn't follow a link to another file.
 */
export function inlinedSkillsSection(files: SkillFiles) {
  const skills = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => {
      if (!/^[^/]+\/SKILL\.md$/.test(path)) {
        throw new Error(`An inlined skill is its SKILL.md alone, but it has ${path}`);
      }
      const { name, description } = frontmatterOf(text);
      if (typeof name !== "string" || typeof description !== "string" || !description.trim()) {
        throw new Error(`The skill in ${path} has no name or description`);
      }
      return [
        "<skill>",
        `<name>${escapeXml(name.trim())}</name>`,
        `<description>${escapeXml(description.trim())}</description>`,
        "",
        bodyOf(text).trim(),
        "</skill>",
      ].join("\n");
    });
  if (skills.length === 0) return undefined;
  return [
    "The following skills provide specialized instructions for specific tasks. Follow a skill when the task matches its description.",
    "",
    ...skills,
  ].join("\n");
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** `markdown` past its YAML frontmatter, if any. */
const bodyOf = (markdown: string) => markdown.replace(FRONTMATTER, "");

/** The fields of the YAML frontmatter `markdown` starts with, or none. */
function frontmatterOf(markdown: string): Record<string, unknown> {
  const yaml = FRONTMATTER.exec(markdown)?.[1];
  if (yaml === undefined) return {};
  try {
    const data: unknown = parseYaml(yaml);
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
