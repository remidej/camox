import {
  type BinaryReader,
  type DirReader,
  err,
  ExecutionError,
  type ExecutionEnv,
  FileError,
  type FileErrorCode,
  type FileInfo,
  LineScanner,
  ok,
  type Result,
  type TextLineReader,
} from "@earendil-works/pi-durable/env";

import type { MemoryFs } from "../../lib/memory-fs";

/** The context Pi passes every operation, which only says whether the call was aborted. */
type Context = Parameters<ExecutionEnv["readTextFile"]>[1];

/**
 * Whether a write may change the absolute path it names, which it makes a directory or a file:
 * undefined when it may, or the error refusing it, returned before anything is written.
 */
export type WritePolicy = (path: string, kind: "file" | "directory") => FileError | undefined;

export type CodeEnvOptions = {
  /** The directory relative paths start from. */
  cwd: string;
  /** Tells apart the trees environments see: equal ids see the same files. */
  id?: string;
  writable: WritePolicy;
};

/** The name Git's own directory has, which a code environment never shows. */
const GIT_DIR = ".git";

const decoder = () => new TextDecoder();

/** The absolute path `path` names from the directory `cwd`. */
export const resolvePath = (cwd: string, path: string) =>
  normalize(path.startsWith("/") ? path : `${cwd}/${path}`);

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const isHidden = (path: string) => path.split("/").includes(GIT_DIR);

const CODES: Record<string, FileErrorCode> = {
  ENOENT: "not_found",
  ENOTDIR: "not_directory",
  EISDIR: "is_directory",
  EINVAL: "invalid",
  ELOOP: "invalid",
  EEXIST: "invalid",
  ENOTEMPTY: "invalid",
};

function fileError(error: unknown, path: string) {
  if (error instanceof FileError) return error;
  const code = (error as { code?: string } | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return new FileError((code && CODES[code]) || "unknown", message, path);
}

const notFound = (path: string) => new FileError("not_found", `ENOENT: ${path}`, path);
const aborted = (path?: string) => err<never, FileError>(new FileError("aborted", "aborted", path));
const closed = (what: string, path: string) =>
  err<never, FileError>(new FileError("invalid", `${what} is closed`, path));

/**
 * A Pi `ExecutionEnv` over a tree held in memory: the agent's files as Pi's tools read them. It
 * has no shell and watches nothing. Git's own directory is never shown, and every write asks
 * `writable` first.
 */
export function codeEnv(fs: MemoryFs, options: CodeEnvOptions): ExecutionEnv {
  const absolute = (path: string) => resolvePath(options.cwd, path);

  /** Runs `operation` on the absolute path `path` names, as Pi's environments report failures. */
  const at = async <T>(
    path: string,
    context: Context,
    operation: (resolved: string) => Promise<Result<T, FileError>>,
  ): Promise<Result<T, FileError>> => {
    const resolved = absolute(path);
    if (context.abortSignal?.aborted) return aborted(resolved);
    if (isHidden(resolved)) return err(notFound(resolved));
    try {
      return await operation(resolved);
    } catch (error) {
      return err(fileError(error, resolved));
    }
  };

  /** Like `at`, for a write `writable` lets through. */
  const writing = <T>(
    path: string,
    context: Context,
    operation: (resolved: string) => Promise<Result<T, FileError>>,
    kind: "file" | "directory" = "file",
  ) =>
    at(path, context, async (resolved) => {
      const refused = options.writable(resolved, kind);
      return refused ? err<T, FileError>(refused) : operation(resolved);
    });

  const info = async (path: string): Promise<FileInfo> => {
    const stat = await fs.promises.lstat(path);
    return {
      name: basename(path),
      path,
      kind: stat.type === "dir" ? "directory" : stat.type === "symlink" ? "symlink" : "file",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  };

  const names = async (path: string) =>
    (await fs.promises.readdir(path)).filter((name) => name !== GIT_DIR);

  const createDirs = async (path: string) => {
    if (path === "/") return;
    const node = await fs.promises.stat(path).catch(() => undefined);
    if (node?.isDirectory()) return;
    if (node) throw new FileError("not_directory", `ENOTDIR: ${path}`, path);
    await createDirs(parentOf(path));
    await fs.promises.mkdir(path);
  };

  const readBytes = async (path: string) => {
    if ((await fs.promises.stat(path)).isDirectory()) {
      throw new FileError("is_directory", `EISDIR: ${path}`, path);
    }
    return (await fs.promises.readFile(path)) as Uint8Array;
  };

  const write = async (path: string, content: string | Uint8Array) => {
    await createDirs(parentOf(path));
    const mode = await fs.promises
      .stat(path)
      .then((stat) => stat.mode)
      .catch(() => undefined);
    await fs.promises.writeFile(path, content, mode ? { mode } : undefined);
    return ok<void, FileError>(undefined);
  };

  /** The refusal of the first of the directory `path`, or what's below it, a write may not change. */
  const refusedBelow = async (path: string): Promise<FileError | undefined> => {
    const refused = options.writable(path, "directory");
    if (refused) return refused;
    for (const name of await fs.promises.readdir(path)) {
      const child = normalize(`${path}/${name}`);
      const below = (await fs.promises.lstat(child)).type === "dir";
      const found = below ? await refusedBelow(child) : options.writable(child, "file");
      if (found) return found;
    }
    return undefined;
  };

  const removeTree = async (path: string) => {
    const stat = await fs.promises.lstat(path);
    if (stat.type !== "dir") return fs.promises.unlink(path);
    for (const name of await fs.promises.readdir(path)) await removeTree(`${path}/${name}`);
    await fs.promises.rmdir(path);
  };

  const env: ExecutionEnv = {
    id: options.id ?? "camox:code",
    cwd: options.cwd,

    absolutePath: async (path) => ok(absolute(path)),
    joinPath: async (parts) => ok(normalize(parts.join("/"))),

    readTextFile: (path, context) =>
      at(path, context, async (resolved) => ok(decoder().decode(await readBytes(resolved)))),

    openTextLineReader: (path, context) =>
      at(path, context, async (resolved) => {
        const lines = splitLines(decoder().decode(await readBytes(resolved)));
        let isClosed = false;
        const reader: TextLineReader = {
          readLine: async (lineContext) => {
            if (lineContext.abortSignal?.aborted) return aborted(resolved);
            if (isClosed) return closed("Text line reader", resolved);
            return ok(lines.shift());
          },
          close: async () => {
            isClosed = true;
          },
        };
        return ok(reader);
      }),

    readTextLines: (path, lineOptions, context) =>
      at(path, context, async (resolved) => {
        const lines = splitLines(decoder().decode(await readBytes(resolved)));
        return ok(lines.slice(0, lineOptions?.maxLines).map(({ text }) => text));
      }),

    readBinaryFile: (path, context) =>
      at(path, context, async (resolved) => ok((await readBytes(resolved)).slice())),

    openBinaryReader: (path, readerOptions, context) =>
      at(path, context, async (resolved) => {
        if (readerOptions?.noFollow && (await fs.promises.lstat(resolved)).isSymbolicLink()) {
          return err(new FileError("invalid", "Refusing to follow a symbolic link", resolved));
        }
        const stat = await fs.promises.stat(resolved);
        if (stat.isDirectory()) {
          return err(new FileError("is_directory", `EISDIR: ${resolved}`, resolved));
        }
        // The file as it is now: a later write or rename replaces the path's node, not this one.
        const data = (await fs.promises.readFile(resolved)) as Uint8Array;
        const opened: FileInfo = {
          name: basename(resolved),
          path: resolved,
          kind: "file",
          size: data.byteLength,
          mtimeMs: stat.mtimeMs,
        };
        return ok(binaryReader(data, opened));
      }),

    writeFile: (path, content, context) =>
      writing(path, context, (resolved) => write(resolved, content)),

    appendFile: (path, content, context) =>
      writing(path, context, async (resolved) => {
        const before = await readBytes(resolved).catch(() => new Uint8Array());
        const added = typeof content === "string" ? new TextEncoder().encode(content) : content;
        const after = new Uint8Array(before.byteLength + added.byteLength);
        after.set(before);
        after.set(added, before.byteLength);
        return write(resolved, after);
      }),

    truncateFile: (path, size, context) =>
      writing(path, context, async (resolved) => {
        if (!Number.isSafeInteger(size) || size < 0) {
          return err(new FileError("invalid", "File size must be a non-negative safe integer"));
        }
        const before = await readBytes(resolved);
        const after = new Uint8Array(size);
        after.set(before.subarray(0, size));
        return write(resolved, after);
      }),

    flushFile: (path, context) =>
      at(path, context, async (resolved) => {
        await readBytes(resolved);
        return ok(undefined);
      }),

    renameFile: (sourcePath, destinationPath, context) =>
      writing(sourcePath, context, (source) =>
        writing(destinationPath, context, async (destination) => {
          await fs.promises.rename(source, destination);
          return ok(undefined);
        }),
      ),

    fileInfo: (path, context) => at(path, context, async (resolved) => ok(await info(resolved))),

    listDir: (path, context) =>
      at(path, context, async (resolved) => {
        const entries: FileInfo[] = [];
        for (const name of await names(resolved)) {
          entries.push(await info(normalize(`${resolved}/${name}`)));
        }
        return ok(entries);
      }),

    openDirReader: (path, context) =>
      at(path, context, async (resolved) => {
        const pending = await names(resolved);
        let isClosed = false;
        const reader: DirReader = {
          next: async (maxEntries, nextContext) => {
            if (nextContext.abortSignal?.aborted) return aborted(resolved);
            if (isClosed) return closed("Directory reader", resolved);
            if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
              return err(new FileError("invalid", "maxEntries must be a positive safe integer"));
            }
            const entries: FileInfo[] = [];
            while (pending.length > 0 && entries.length < maxEntries) {
              const entry = normalize(`${resolved}/${pending.shift()}`);
              // Removed since the reader opened: no longer part of the listing.
              const found = await info(entry).catch(() => undefined);
              if (found) entries.push(found);
            }
            return ok({ entries, done: pending.length === 0 });
          },
          close: async () => {
            isClosed = true;
          },
        };
        return ok(reader);
      }),

    watch: async () => err(new FileError("not_supported", "This environment watches no files")),

    canonicalPath: (path, context) =>
      at(path, context, async (resolved) => {
        const stat = await fs.promises.lstat(resolved);
        if (!stat.isSymbolicLink()) return ok(resolved);
        const target = await fs.promises.readlink(resolved);
        await fs.promises.stat(resolved);
        return ok(normalize(target.startsWith("/") ? target : `${parentOf(resolved)}/${target}`));
      }),

    exists: async (path, context) => {
      const found = await env.fileInfo(path, context);
      if (found.ok) return ok(true);
      return found.error.code === "not_found" ? ok(false) : err(found.error);
    },

    createDir: (path, dirOptions, context) =>
      writing(
        path,
        context,
        async (resolved) => {
          if (dirOptions?.recursive === false) await fs.promises.mkdir(resolved);
          else await createDirs(resolved);
          return ok(undefined);
        },
        "directory",
      ),

    remove: (path, removeOptions, context) =>
      at(path, context, async (resolved) => {
        const stat = await fs.promises.lstat(resolved).catch(() => undefined);
        // A directory goes only if it and everything in it may.
        const refused =
          stat?.type === "dir" ? await refusedBelow(resolved) : options.writable(resolved, "file");
        if (refused) return err(refused);
        if (!stat) return removeOptions?.force ? ok(undefined) : err(notFound(resolved));
        if (stat.type === "dir" && !removeOptions?.recursive) {
          return err(new FileError("is_directory", `EISDIR: ${resolved}`, resolved));
        }
        await removeTree(resolved);
        return ok(undefined);
      }),

    createTempDir: async () =>
      err(new FileError("not_supported", "This environment has no temporary files")),
    createTempFile: async () =>
      err(new FileError("not_supported", "This environment has no temporary files")),

    exec: async () =>
      err(new ExecutionError("shell_unavailable", "This environment has no shell: use the tools")),

    cleanup: async () => undefined,
  };
  return env;
}

/** A text's lines as a line reader returns them: none for an empty text, no line after a last newline. */
export function splitLines(text: string) {
  if (text === "") return [];
  const parts = text.split("\n");
  const last = parts.pop()!;
  const lines = parts.map((line) => ({ text: line, terminated: true }));
  if (last !== "") lines.push({ text: last, terminated: false });
  return lines;
}

/** Positional reads of `data`, the bytes of the file `opened` describes. */
export function binaryReader(data: Uint8Array, opened: FileInfo): BinaryReader {
  let isClosed = false;
  const { path } = opened;
  return {
    info: async (context) => {
      if (context.abortSignal?.aborted) return aborted(path);
      return isClosed ? closed("Binary reader", path) : ok(opened);
    },
    read: async (offset, length, context) => {
      if (context.abortSignal?.aborted) return aborted(path);
      if (isClosed) return closed("Binary reader", path);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 0
      ) {
        return err(
          new FileError("invalid", "Offset and length must be non-negative safe integers"),
        );
      }
      return ok(data.slice(offset, offset + length));
    },
    scanLines: async ({ startLine, endLine }, context) => {
      if (context.abortSignal?.aborted) return aborted(path);
      if (isClosed) return closed("Binary reader", path);
      let scanner: LineScanner;
      try {
        scanner = new LineScanner(startLine, endLine);
      } catch {
        return err(new FileError("invalid", "Invalid line range", path));
      }
      scanner.push(data);
      return ok(scanner.finish());
    },
    close: async () => {
      isClosed = true;
    },
  };
}
