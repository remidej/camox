import {
  type DirReader,
  err,
  ExecutionError,
  type ExecutionEnv,
  FileError,
  type FileErrorCode,
  type FileInfo,
  ok,
  type Result,
  type TextLineReader,
} from "@earendil-works/pi-durable/env";

import { binaryReader, splitLines } from "./env";

// A code environment held in another object, reached over RPC: Durable Object RPC carries plain
// data, so each operation goes as its name and arguments, and comes back as a plain result whose
// error the caller makes a `FileError` again. Readers are opened from one read of what they
// read, the way a code environment's readers hold what they opened.

/** The context Pi passes every operation, which only says whether the call was aborted. */
type Context = Parameters<ExecutionEnv["readTextFile"]>[1];

/** The operations sent as they are: every argument but the context is plain data. */
const SENT = [
  "absolutePath",
  "joinPath",
  "readTextFile",
  "readTextLines",
  "readBinaryFile",
  "writeFile",
  "appendFile",
  "truncateFile",
  "flushFile",
  "renameFile",
  "fileInfo",
  "listDir",
  "canonicalPath",
  "exists",
  "createDir",
  "remove",
] as const satisfies (keyof ExecutionEnv)[];

/** What a remote environment asks of the one it reaches. */
export type EnvCall =
  | { operation: (typeof SENT)[number]; args: unknown[] }
  /** Opens a binary reader there and reads the whole file it opened. */
  | { operation: "openBinaryReader"; args: [path: string, options?: { noFollow?: boolean }] };

/** An operation's result as it crosses: its value, or its error as plain data. */
export type EnvAnswer =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: FileErrorCode; message: string; path?: string } };

/** A call nothing aborts, as the environment answering a call runs it. */
const BACKGROUND = { abortSignal: undefined, value: () => undefined } as unknown as Context;

/** Runs `call` on `env`, for a remote environment: see `remoteEnv`. */
export async function answerEnvCall(env: ExecutionEnv, call: EnvCall): Promise<EnvAnswer> {
  const answer = (result: Result<unknown, FileError>): EnvAnswer =>
    result.ok
      ? { ok: true, value: result.value }
      : {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            path: result.error.path,
          },
        };
  if (call.operation === "openBinaryReader") {
    const [path, options] = call.args;
    const opened = await env.openBinaryReader(path, options, BACKGROUND);
    if (!opened.ok) return answer(opened);
    const reader = opened.value;
    try {
      const info = await reader.info(BACKGROUND);
      if (!info.ok) return answer(info);
      const data = await reader.read(0, info.value.size, BACKGROUND);
      return data.ok ? { ok: true, value: { info: info.value, data: data.value } } : answer(data);
    } finally {
      await reader.close(BACKGROUND);
    }
  }
  const operation = env[call.operation] as (
    ...args: unknown[]
  ) => Promise<Result<unknown, FileError>>;
  return answer(await operation(...call.args, BACKGROUND));
}

const aborted = (path?: string) => err<never, FileError>(new FileError("aborted", "aborted", path));
const closed = (what: string, path: string) =>
  err<never, FileError>(new FileError("invalid", `${what} is closed`, path));

/**
 * A Pi `ExecutionEnv` whose operations `call` runs in another environment, `answerEnvCall`
 * answering them there. Like a code environment, it has no shell and watches nothing.
 */
export function remoteEnv(
  call: (call: EnvCall) => Promise<EnvAnswer>,
  { id, cwd }: Pick<ExecutionEnv, "id" | "cwd">,
): ExecutionEnv {
  const send = async <T>(
    context: Context,
    sent: EnvCall,
    path?: string,
  ): Promise<Result<T, FileError>> => {
    if (context.abortSignal?.aborted) return aborted(path);
    const answered = await call(sent);
    if (answered.ok) return ok(answered.value as T);
    const { code, message, path: errorPath } = answered.error;
    return err(new FileError(code, message, errorPath));
  };
  const sent =
    <T>(operation: (typeof SENT)[number]) =>
    (...args: unknown[]) => {
      const context = args.pop() as Context;
      return send<T>(
        context,
        { operation, args },
        typeof args[0] === "string" ? args[0] : undefined,
      );
    };

  const env: ExecutionEnv = {
    id,
    cwd,
    absolutePath: sent("absolutePath"),
    joinPath: sent("joinPath"),
    readTextFile: sent("readTextFile"),
    readTextLines: sent("readTextLines"),
    readBinaryFile: sent("readBinaryFile"),
    writeFile: sent("writeFile"),
    appendFile: sent("appendFile"),
    truncateFile: sent("truncateFile"),
    flushFile: sent("flushFile"),
    renameFile: sent("renameFile"),
    fileInfo: sent("fileInfo"),
    listDir: sent("listDir"),
    canonicalPath: sent("canonicalPath"),
    exists: sent("exists"),
    createDir: sent("createDir"),
    remove: sent("remove"),

    openTextLineReader: async (path, context) => {
      const text = await env.readTextFile(path, context);
      if (!text.ok) return text;
      const lines = splitLines(text.value);
      let isClosed = false;
      const reader: TextLineReader = {
        readLine: async (lineContext) => {
          if (lineContext.abortSignal?.aborted) return aborted(path);
          if (isClosed) return closed("Text line reader", path);
          return ok(lines.shift());
        },
        close: async () => {
          isClosed = true;
        },
      };
      return ok(reader);
    },

    openBinaryReader: async (path, options, context) => {
      const opened = await send<{ info: FileInfo; data: Uint8Array }>(
        context,
        { operation: "openBinaryReader", args: [path, options] },
        path,
      );
      return opened.ok ? ok(binaryReader(opened.value.data, opened.value.info)) : opened;
    },

    openDirReader: async (path, context) => {
      const listed = await env.listDir(path, context);
      if (!listed.ok) return listed;
      const pending = listed.value.map((entry) => entry.path);
      let isClosed = false;
      const reader: DirReader = {
        next: async (maxEntries, nextContext) => {
          if (nextContext.abortSignal?.aborted) return aborted(path);
          if (isClosed) return closed("Directory reader", path);
          if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
            return err(new FileError("invalid", "maxEntries must be a positive safe integer"));
          }
          const entries: FileInfo[] = [];
          while (pending.length > 0 && entries.length < maxEntries) {
            // Removed since the reader opened: no longer part of the listing.
            const found = await env.fileInfo(pending.shift()!, nextContext);
            if (found.ok) entries.push(found.value);
            else if (found.error.code !== "not_found") return found;
          }
          return ok({ entries, done: pending.length === 0 });
        },
        close: async () => {
          isClosed = true;
        },
      };
      return ok(reader);
    },

    watch: async () => err(new FileError("not_supported", "This environment watches no files")),
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
