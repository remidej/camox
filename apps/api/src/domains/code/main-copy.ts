import { type ExecutionEnv, FileError } from "@earendil-works/pi-durable/env";

import { MemoryFs } from "../../lib/memory-fs";
import { camoxVersionInLockfile } from "../releases/lockfile";
import { codeEnv } from "./env";
import { type SkillFiles, SKILLS_ROOT, skillsAt } from "./skills";

/** A file of a project's code: its content, or where a symlink points. */
export type CodeFile = { path: string; content: Uint8Array } | { path: string; symlink: string };

/** A project's code at a commit of its `main`: every file but Git's own. */
export type MainCopy = { commit: string; files: CodeFile[] };

/** Where the project's files are in the agent's environment. */
export const CODE_ROOT = "/";

async function createDirs(fs: MemoryFs, path: string) {
  const parts = path.split("/").filter(Boolean);
  for (let depth = 1; depth <= parts.length; depth++) {
    await fs.promises.mkdir(`/${parts.slice(0, depth).join("/")}`).catch(() => undefined);
  }
}

/** Writes `files` into `fs`, creating their directories. */
export async function writeFiles(fs: MemoryFs, files: CodeFile[]) {
  for (const file of files) {
    const path = `/${file.path}`;
    await createDirs(fs, path.slice(0, path.lastIndexOf("/")));
    if ("symlink" in file) await fs.promises.symlink(file.symlink, path);
    else await fs.promises.writeFile(path, file.content);
  }
}

/**
 * The tree the agent reads on Live, and in a draft without code: `main` as `copy` holds it, with
 * the skills of its `camox` version mounted from `skills` (`mountSkills`). Nothing in it can be
 * written.
 */
export async function mainCopyFs(copy: MainCopy, skills: R2Bucket) {
  const fs = new MemoryFs();
  await writeFiles(fs, copy.files);
  await mountSkills(fs, skills);
  return fs;
}

/** The `camox` version the lockfile in `fs` installs, or null if it installs none. */
export async function lockedCamoxVersion(fs: MemoryFs) {
  const lockfile = await fs.promises.readFile("/pnpm-lock.yaml", "utf8").catch(() => null);
  return typeof lockfile === "string" ? camoxVersionInLockfile(lockfile) : null;
}

/**
 * Mounts under `SKILLS_ROOT` the skills of the `camox` version the lockfile in `fs` installs, from
 * `skills`, in place of any mounted before. Returns the version mounted, which is the lockfile's
 * even when `skills` has none for it, or undefined when they couldn't be read, to try again.
 */
export async function mountSkills(fs: MemoryFs, skills: R2Bucket) {
  const version = await lockedCamoxVersion(fs);
  const mounted = fs
    .entries()
    .filter(({ path }) => path === SKILLS_ROOT || path.startsWith(`${SKILLS_ROOT}/`))
    .sort((a, b) => b.path.length - a.path.length);
  for (const { path, kind } of mounted) {
    await (kind === "dir" ? fs.promises.rmdir(path) : fs.promises.unlink(path));
  }
  if (!version) return version;
  let files: SkillFiles | null;
  try {
    files = await skillsAt(skills, version);
  } catch (error) {
    console.error(`Camox couldn't read the skills of camox ${version}`, error);
    return undefined;
  }
  if (!files) console.error(`Camox has no skills for camox ${version}`);
  for (const [path, text] of Object.entries(files ?? {})) {
    const at = `${SKILLS_ROOT}/${path}`;
    await createDirs(fs, at.slice(0, at.lastIndexOf("/")));
    await fs.promises.writeFile(at, text);
  }
  return version;
}

const readOnly = (path: string) =>
  new FileError(
    "permission_denied",
    `${path} is in a read-only copy of the website's code: you can't change code yet.`,
    path,
  );

/** The agent's environment over `fs`, a tree `mainCopyFs` made. */
export const mainCopyFsEnv = (fs: MemoryFs, id?: string) =>
  codeEnv(fs, { cwd: CODE_ROOT, id, writable: readOnly });

/**
 * An environment whose tree is loaded on its first operation, once: Pi builds an environment for
 * every call that may use one, most of which never do.
 */
export function lazyEnv(
  load: () => Promise<ExecutionEnv>,
  { id, cwd }: Pick<ExecutionEnv, "id" | "cwd">,
): ExecutionEnv {
  let loading: Promise<ExecutionEnv> | undefined;
  const loaded = () => {
    loading ??= load().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
  // Every operation a code environment has, as it runs on the loaded one.
  return {
    id,
    cwd,
    absolutePath: async (...args) => (await loaded()).absolutePath(...args),
    joinPath: async (...args) => (await loaded()).joinPath(...args),
    readTextFile: async (...args) => (await loaded()).readTextFile(...args),
    openTextLineReader: async (...args) => (await loaded()).openTextLineReader(...args),
    readTextLines: async (...args) => (await loaded()).readTextLines(...args),
    readBinaryFile: async (...args) => (await loaded()).readBinaryFile(...args),
    openBinaryReader: async (...args) => (await loaded()).openBinaryReader(...args),
    writeFile: async (...args) => (await loaded()).writeFile(...args),
    appendFile: async (...args) => (await loaded()).appendFile(...args),
    truncateFile: async (...args) => (await loaded()).truncateFile(...args),
    flushFile: async (...args) => (await loaded()).flushFile(...args),
    renameFile: async (...args) => (await loaded()).renameFile(...args),
    fileInfo: async (...args) => (await loaded()).fileInfo(...args),
    listDir: async (...args) => (await loaded()).listDir(...args),
    openDirReader: async (...args) => (await loaded()).openDirReader(...args),
    watch: async (...args) => (await loaded()).watch(...args),
    canonicalPath: async (...args) => (await loaded()).canonicalPath(...args),
    exists: async (...args) => (await loaded()).exists(...args),
    createDir: async (...args) => (await loaded()).createDir(...args),
    remove: async (...args) => (await loaded()).remove(...args),
    createTempDir: async (...args) => (await loaded()).createTempDir(...args),
    createTempFile: async (...args) => (await loaded()).createTempFile(...args),
    exec: async (...args) => (await loaded()).exec(...args),
    cleanup: async (...args) => (await loaded()).cleanup(...args),
  };
}
