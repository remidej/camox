// Camox's skills, as the `camox` version a project installs ships them: each SDK publish uploads
// its `skills/` to `SKILLS` under its version (apps/api/scripts/upload-skills.mjs), and the
// agent reads the version the project's lockfile installs, as a local agent reads them through
// `node_modules`. The API never holds a copy of its own, so it can't drift from the SDK's.

/** The skills the agent reads: the others drive the CLI, which it works without. */
export const HOSTED_SKILLS = ["camox"] as const;

/** Where the skills are mounted in the agent's environment, read-only, beside the code. */
export const SKILLS_ROOT = "/.camox/skills";

/** A version's skills: each file's path under `skills/`, such as `camox/SKILL.md`, to its text. */
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
