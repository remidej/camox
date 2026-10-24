import { type ExecutionEnv, FileError } from "@earendil-works/pi-durable/env";

import { MemoryFs } from "../../lib/memory-fs";
import { codeEnv } from "./env";
import { SKILL_REFERENCES, SKILL_REFERENCES_DIR } from "./skills";

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
 * the SDK's code references mounted under `SKILL_REFERENCES_DIR`. Nothing in it can be written.
 */
export async function mainCopyFs(copy: MainCopy) {
  const fs = new MemoryFs();
  await writeFiles(fs, copy.files);
  await mountSkills(fs);
  return fs;
}

/** Where the SDK's code references are, which no write line lets the agent change. */
export const SKILLS_ROOT = SKILL_REFERENCES_DIR.split("/").slice(0, 2).join("/");

/** Writes the SDK's code references into `fs`, under `SKILL_REFERENCES_DIR`. */
export async function mountSkills(fs: MemoryFs) {
  await createDirs(fs, SKILL_REFERENCES_DIR);
  for (const { file, text } of SKILL_REFERENCES) {
    await fs.promises.writeFile(`${SKILL_REFERENCES_DIR}/${file}`, text);
  }
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

/** The agent's environment over `copy`, built on first use: see `mainCopyFs`. */
export function mainCopyEnv(copy: MainCopy): ExecutionEnv {
  return lazyEnv(async () => mainCopyFsEnv(await mainCopyFs(copy)), {
    id: `camox:main:${copy.commit}`,
    cwd: CODE_ROOT,
  });
}

/** Every operation of an `ExecutionEnv` a code environment has. */
const OPERATIONS = Object.keys(codeEnv(new MemoryFs(), { cwd: "/", writable: readOnly })).filter(
  (key) => key !== "id" && key !== "cwd",
) as (keyof ExecutionEnv)[];

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
  const env: Record<string, unknown> = { id, cwd };
  for (const operation of OPERATIONS) {
    env[operation] = async (...args: unknown[]) =>
      ((await loaded())[operation] as (...args: unknown[]) => unknown)(...args);
  }
  return env as unknown as ExecutionEnv;
}
