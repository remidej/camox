import { err, type ExecutionEnv, FileError, ok } from "@earendil-works/pi-durable/env";

import { MemoryFs } from "../../lib/memory-fs";
import { codeEnv, resolvePath } from "../code/env";

/** Where an Artifact Agent finds its artifact's source, beside the website's code. */
export const ARTIFACT_PATH = "/artifact.html";

/**
 * One artifact's source, as an Artifact Agent reads and writes it. A write the content rules
 * refuse throws, with the reason the agent reads; one that goes through returns its warnings.
 */
export type ArtifactFile = {
  read: () => Promise<string>;
  write: (source: string) => Promise<{ warnings: string[] }>;
};

/** What the last write of the artifact's source through an environment came to. */
export type ArtifactWrite = { warnings: string[] } | { refused: string };

const writes = new WeakMap<ExecutionEnv, ArtifactWrite>();

/**
 * What the last write of the artifact's source through `env`, an environment `artifactEnv` made,
 * came to: Pi's `edit` reports a refused write by its code alone, and no tool reports warnings.
 */
export const artifactWriteOf = (env: ExecutionEnv | undefined) => env && writes.get(env);

const readOnly = (path: string) =>
  new FileError(
    "permission_denied",
    `${path} is part of the website's code, which you only read: you change ${ARTIFACT_PATH} alone.`,
    path,
  );

const wholeWritesOnly = (path: string) =>
  new FileError(
    "permission_denied",
    `Change ${path} with write or edit: it can't be moved, removed or appended to.`,
    path,
  );

/**
 * An Artifact Agent's environment: the website's code as `code` has it, which it only reads, and
 * its artifact's source at `ARTIFACT_PATH`, which `file` reads once the call first needs it and
 * writes as Pi's `write` and `edit` change it. A write lands in the draft before the file
 * changes, so a refused one leaves both as they were.
 */
export function artifactEnv(code: ExecutionEnv, file: ArtifactFile, id: string): ExecutionEnv {
  const cwd = code.cwd ?? "/";
  const isArtifact = (path: string) => resolvePath(cwd, path) === ARTIFACT_PATH;

  let loading: Promise<ExecutionEnv> | undefined;
  const source = () => {
    loading ??= (async () => {
      const fs = new MemoryFs();
      await fs.promises.writeFile(ARTIFACT_PATH, await file.read());
      return codeEnv(fs, {
        cwd,
        id,
        writable: (path) => (path === ARTIFACT_PATH ? undefined : readOnly(path)),
      });
    })().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };

  /** Where `path` is read from: the artifact's own file, or the code. */
  const holder = async (path: string) => (isArtifact(path) ? source() : code);

  /** Refuses a write of anything but the artifact's source as a whole. */
  const refusing = async (path: string) =>
    err<never, FileError>(
      isArtifact(path) ? wholeWritesOnly(path) : readOnly(resolvePath(cwd, path)),
    );

  const env: ExecutionEnv = {
    ...code,
    id,
    cwd,
    // Paths alone: resolving one never loads the code.
    absolutePath: async (path) => ok(resolvePath(cwd, path)),
    joinPath: async (parts) => ok(resolvePath("/", parts.join("/"))),
    readTextFile: async (path, context) => (await holder(path)).readTextFile(path, context),
    openTextLineReader: async (path, context) =>
      (await holder(path)).openTextLineReader(path, context),
    readTextLines: async (path, options, context) =>
      (await holder(path)).readTextLines(path, options, context),
    readBinaryFile: async (path, context) => (await holder(path)).readBinaryFile(path, context),
    openBinaryReader: async (path, options, context) =>
      (await holder(path)).openBinaryReader(path, options, context),
    flushFile: async (path, context) => (await holder(path)).flushFile(path, context),
    fileInfo: async (path, context) => (await holder(path)).fileInfo(path, context),
    canonicalPath: async (path, context) => (await holder(path)).canonicalPath(path, context),
    exists: async (path, context) => (await holder(path)).exists(path, context),
    listDir: async (path, context) => {
      const listed = await code.listDir(path, context);
      if (!listed.ok || resolvePath(cwd, path) !== "/") return listed;
      const found = await (await source()).fileInfo(ARTIFACT_PATH, context);
      return found.ok ? ok([found.value, ...listed.value]) : listed;
    },
    writeFile: async (path, content, context) => {
      if (!isArtifact(path)) return refusing(path);
      const text = typeof content === "string" ? content : new TextDecoder().decode(content);
      try {
        const { warnings } = await file.write(text);
        writes.set(env, { warnings });
      } catch (error) {
        const refused = error instanceof Error ? error.message : String(error);
        writes.set(env, { refused });
        return err(new FileError("invalid", refused, ARTIFACT_PATH));
      }
      return (await source()).writeFile(ARTIFACT_PATH, text, context);
    },
    appendFile: (path) => refusing(path),
    truncateFile: (path) => refusing(path),
    renameFile: (from) => refusing(from),
    createDir: (path) => refusing(path),
    remove: (path) => refusing(path),
  };
  return env;
}
