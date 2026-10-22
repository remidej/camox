import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { MemoryFs } from "../../lib/memory-fs";

const DIR = "/repo";
const MAIN = "main";
const AUTHOR = { name: "Camox", email: "noreply@camox.dev" };

type NewProject = { projectId: string; name: string; slug: string };

/**
 * Names the Template's copy in a new project's repo after the project: it clones the repo in
 * memory, gives it the project's Project ID, name and slug, commits "Create <name>" and pushes it
 * to `main`. Does nothing when an earlier attempt already pushed it, which the Project ID in
 * `wrangler.jsonc` tells.
 */
export async function copyTemplate(repo: ArtifactsRepo, project: NewProject) {
  const config = await repo.readFile({ ref: MAIN, path: "wrangler.jsonc" });
  if (config && (await config.text()).includes(project.projectId)) return;

  const { remote } = await repo.info();
  const token = await repo.createToken("write", 600);
  try {
    const fs = new MemoryFs();
    const remoteOptions = {
      fs,
      http,
      dir: DIR,
      url: remote,
      headers: { Authorization: `Bearer ${token.plaintext}` },
    };
    await git.clone({ ...remoteOptions, ref: MAIN, singleBranch: true });
    for (const filepath of await git.listFiles({ fs, dir: DIR })) {
      const path = `${DIR}/${filepath}`;
      // A link names no project, and its target may not be in the repo.
      if ((await fs.promises.lstat(path)).isSymbolicLink()) continue;
      const before = (await fs.promises.readFile(path, { encoding: "utf8" })) as string;
      const after = personalize(filepath, before, project);
      if (after === before) continue;
      await fs.promises.writeFile(path, after);
      await git.add({ fs, dir: DIR, filepath });
    }
    await git.commit({ fs, dir: DIR, message: `Create ${project.name}`, author: AUTHOR });
    await git.push({ ...remoteOptions, ref: MAIN, remoteRef: MAIN });
  } finally {
    await repo.revokeToken(token.id).catch(() => false);
  }
}

/**
 * One of the Template's files, given the project's values: what the CLI's `camox init` did to its
 * copy (`personalize()` and the `{{projectName}}` placeholders, packages/cli/src/lib/template.ts).
 */
export function personalize(filepath: string, source: string, project: NewProject) {
  if (filepath === "package.json") {
    const pkg = JSON.parse(source) as Record<string, unknown>;
    return `${JSON.stringify({ ...pkg, name: project.slug }, null, 2)}\n`;
  }
  // Every placeholder sits in a double-quoted string, which the name mustn't end.
  const quotedName = JSON.stringify(project.name).slice(1, -1);
  return replaceProjectId(source, project.projectId).replaceAll("{{projectName}}", quotedName);
}

/**
 * Replaces the Template's placeholder Project ID, marked by a comment this drops. Mirrors
 * `replaceProjectId()` in packages/cli/src/lib/template.ts, which the API can't import.
 */
function replaceProjectId(source: string, projectId: string) {
  return source.replace(
    /"[^"]*"(,?)[ \t]*\/\/[ \t]*camox-cli:replace-project-id.*$/gm,
    `"${projectId}"$1`,
  );
}
