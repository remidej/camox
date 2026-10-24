import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { type ExecutionEnv, type FileInfo, getOrThrow } from "@earendil-works/pi-durable/env";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";

// The agent's tools for reading code. `read` is Pi Durable's own. `grep`, `find` and `ls` copy the
// schemas, descriptions and output of Pi's coding agent, `@earendil-works/pi-coding-agent` 1.3.0
// (`dist/core/tools/{grep,find,ls}.js`), which isn't installed: it runs ripgrep and fd, and these
// walk the environment's tree instead.

type Context = Parameters<ExecutionEnv["readTextFile"]>[1];

/** pi-coding-agent's output limits (`dist/core/tools/truncate.js`). */
const DEFAULT_MAX_BYTES = 50 * 1024;
const GREP_MAX_LINE_LENGTH = 500;
const GREP_LIMIT = 100;
const FIND_LIMIT = 1000;
const LS_LIMIT = 500;

/** Directories never searched, as pi-coding-agent's `find` ignores them. */
const IGNORED = new Set(["node_modules", ".git"]);

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes}B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)}KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

/** The first whole lines of `text` within `DEFAULT_MAX_BYTES`, and whether any were cut. */
function truncateHead(text: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= DEFAULT_MAX_BYTES) return { text, truncated: false };
  const kept: string[] = [];
  let bytes = 0;
  for (const line of text.split("\n")) {
    const size = encoder.encode(line).byteLength + (kept.length > 0 ? 1 : 0);
    if (bytes + size > DEFAULT_MAX_BYTES) break;
    kept.push(line);
    bytes += size;
  }
  return { text: kept.join("\n"), truncated: true };
}

/** `output` with pi-coding-agent's notices, the byte limit's last. */
function withNotices(output: string, notices: string[]) {
  const truncation = truncateHead(output);
  const all = [...notices];
  if (truncation.truncated) all.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  return all.length > 0 ? `${truncation.text}\n\n[${all.join(". ")}]` : truncation.text;
}

const text = (output: string) => ({ output: [{ type: "text" as const, text: output }] });

function envOf(api: ToolExecutionApi) {
  if (!api.env) throw new Error("No execution environment is configured");
  return api.env;
}

async function resolve(env: ExecutionEnv, path: string | undefined, context: Context) {
  return getOrThrow(await env.absolutePath(path || ".", context));
}

/** What's at `path`, or undefined when nothing is. */
async function infoOf(env: ExecutionEnv, path: string, context: Context) {
  const info = await env.fileInfo(path, context);
  if (info.ok) return info.value;
  if (info.error.code === "not_found") return undefined;
  throw info.error;
}

/** Every file and directory below `dir`, depth first, in name order. */
async function walk(env: ExecutionEnv, dir: string, context: Context): Promise<FileInfo[]> {
  const entries = getOrThrow(await env.listDir(dir, context)).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const found: FileInfo[] = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    found.push(entry);
    if (entry.kind === "directory") found.push(...(await walk(env, entry.path, context)));
  }
  return found;
}

const relativeTo = (root: string, path: string) =>
  path === root ? "" : path.slice(root === "/" ? 1 : root.length + 1);

/** A glob as a regular expression: `**` any path, `*` and `?` within a name, `{a,b}`, `[ab]`. */
function globExpression(glob: string) {
  let source = "";
  for (let at = 0; at < glob.length; at++) {
    const char = glob[at]!;
    if (char === "*" && glob[at + 1] === "*") {
      at++;
      if (glob[at + 1] === "/") {
        at++;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "{") {
      const end = glob.indexOf("}", at);
      if (end === -1) source += "\\{";
      else {
        const options = glob.slice(at + 1, end).split(",");
        source += `(?:${options.map((option) => globExpression(option).source.slice(1, -1)).join("|")})`;
        at = end;
      }
    } else if (char === "[") {
      const end = glob.indexOf("]", at);
      if (end === -1) source += "\\[";
      else {
        source += `[${glob.slice(at + 1, end).replace(/^!/, "^")}]`;
        at = end;
      }
    } else source += char.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * Whether a path relative to the search matches `glob`, as fd and ripgrep match one: a glob without
 * a `/` matches a name at any depth, one with a `/` the whole relative path.
 */
function globMatcher(glob: string) {
  const pattern = glob.replace(/^\//, "");
  if (!pattern.includes("/")) {
    const expression = globExpression(pattern);
    return (path: string) => expression.test(path.slice(path.lastIndexOf("/") + 1));
  }
  const expression = globExpression(pattern.startsWith("**/") ? pattern : `**/${pattern}`);
  return (path: string) => expression.test(path);
}

function truncateLine(line: string) {
  return line.length > GREP_MAX_LINE_LENGTH
    ? { text: `${line.slice(0, GREP_MAX_LINE_LENGTH)}... [truncated]`, wasTruncated: true }
    : { text: line, wasTruncated: false };
}

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as literal string instead of regex (default: false)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
});

export const grepTool = defineTool({
  name: "grep",
  description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${GREP_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
  parameters: grepSchema,
  replay: "safe",
  async execute(
    { pattern, path, glob, ignoreCase, literal, context: around, limit },
    api,
    context,
  ) {
    const env = envOf(api);
    const searchPath = await resolve(env, path, context);
    const searched = await infoOf(env, searchPath, context);
    if (!searched) throw new Error(`Path not found: ${searchPath}`);
    const isDirectory = searched.kind === "directory";
    const expression = new RegExp(
      literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern,
      ignoreCase ? "i" : "",
    );
    const matchesGlob = glob ? globMatcher(glob) : () => true;
    const contextLines = around && around > 0 ? around : 0;
    const effectiveLimit = Math.max(1, limit ?? GREP_LIMIT);
    const files = isDirectory
      ? (await walk(env, searchPath, context)).filter(({ kind }) => kind === "file")
      : [searched];

    const output: string[] = [];
    let matchCount = 0;
    let linesTruncated = false;
    for (const file of files) {
      const shown = isDirectory ? relativeTo(searchPath, file.path) : file.name;
      if (isDirectory && !matchesGlob(shown)) continue;
      const bytes = getOrThrow(await env.readBinaryFile(file.path, context));
      // Binary files are skipped, as ripgrep skips them.
      if (bytes.includes(0)) continue;
      const lines = new TextDecoder()
        .decode(bytes)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
      for (let index = 0; index < lines.length && matchCount < effectiveLimit; index++) {
        if (!expression.test(lines[index]!)) continue;
        matchCount++;
        const lineNumber = index + 1;
        const start = Math.max(1, lineNumber - contextLines);
        const end = Math.min(lines.length, lineNumber + contextLines);
        for (let current = start; current <= end; current++) {
          const line = truncateLine(lines[current - 1] ?? "");
          if (line.wasTruncated) linesTruncated = true;
          output.push(
            current === lineNumber
              ? `${shown}:${current}: ${line.text}`
              : `${shown}-${current}- ${line.text}`,
          );
        }
      }
      if (matchCount >= effectiveLimit) break;
    }
    if (matchCount === 0) return text("No matches found");
    const notices: string[] = [];
    if (matchCount >= effectiveLimit) {
      notices.push(
        `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
      );
    }
    if (linesTruncated) {
      notices.push(
        `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
      );
    }
    return text(withNotices(output.join("\n"), notices));
  },
});

const findSchema = Type.Object({
  pattern: Type.String({
    description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
  }),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export const findTool = defineTool({
  name: "find",
  description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${FIND_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
  parameters: findSchema,
  replay: "safe",
  async execute({ pattern, path, limit }, api, context) {
    const env = envOf(api);
    const searchPath = await resolve(env, path, context);
    if (!(await infoOf(env, searchPath, context))) {
      throw new Error(`Path not found: ${searchPath}`);
    }
    const effectiveLimit = limit ?? FIND_LIMIT;
    const matches = globMatcher(pattern);
    const results: string[] = [];
    for (const entry of await walk(env, searchPath, context)) {
      if (results.length >= effectiveLimit) break;
      const relative = relativeTo(searchPath, entry.path);
      if (!matches(relative)) continue;
      results.push(entry.kind === "directory" ? `${relative}/` : relative);
    }
    if (results.length === 0) return text("No files found matching pattern");
    const notices =
      results.length >= effectiveLimit
        ? [
            `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
          ]
        : [];
    return text(withNotices(results.join("\n"), notices));
  },
});

const lsSchema = Type.Object({
  path: Type.Optional(
    Type.String({ description: "Directory to list (default: current directory)" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of entries to return (default: 500)" }),
  ),
});

export const lsTool = defineTool({
  name: "ls",
  description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${LS_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
  parameters: lsSchema,
  replay: "safe",
  async execute({ path, limit }, api, context) {
    const env = envOf(api);
    const dirPath = await resolve(env, path, context);
    const info = await infoOf(env, dirPath, context);
    if (!info) throw new Error(`Path not found: ${dirPath}`);
    if (info.kind !== "directory") throw new Error(`Not a directory: ${dirPath}`);
    const effectiveLimit = limit ?? LS_LIMIT;
    const entries = getOrThrow(await env.listDir(dirPath, context)).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    const results = entries
      .slice(0, effectiveLimit)
      .map(({ name, kind }) => (kind === "directory" ? `${name}/` : name));
    if (results.length === 0) return text("(empty directory)");
    const notices =
      entries.length > effectiveLimit
        ? [`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`]
        : [];
    return text(withNotices(results.join("\n"), notices));
  },
});

const mvSchema = Type.Object({
  from: Type.String({ description: "Path of the file to move (relative or absolute)" }),
  to: Type.String({ description: "Path to move it to (relative or absolute)" }),
});

/** Camox's own: moves or renames a file, which the write line checks at both ends. */
export const mvTool = defineTool({
  name: "mv",
  description:
    "Move or rename a file. Overwrites the destination if it exists. Automatically creates the destination's parent directories.",
  parameters: mvSchema,
  async execute({ from, to }, api, context) {
    const env = envOf(api);
    const source = await resolve(env, from, context);
    const destination = await resolve(env, to, context);
    let moved = await env.renameFile(source, destination, context);
    // The destination's directory doesn't exist yet: the source does, as `renameFile` checked.
    if (!moved.ok && moved.error.code === "not_found" && (await infoOf(env, source, context))) {
      const parent = destination.slice(0, destination.lastIndexOf("/")) || "/";
      getOrThrow(await env.createDir(parent, { recursive: true }, context));
      moved = await env.renameFile(source, destination, context);
    }
    getOrThrow(moved);
    return text(`Moved ${from} to ${to}`);
  },
});

const rmSchema = Type.Object({
  path: Type.String({ description: "Path to the file to delete (relative or absolute)" }),
});

/** Camox's own: deletes a file, which the write line checks. */
export const rmTool = defineTool({
  name: "rm",
  description: "Delete a file.",
  parameters: rmSchema,
  async execute({ path }, api, context) {
    const env = envOf(api);
    getOrThrow(await env.remove(await resolve(env, path, context), { recursive: false }, context));
    return text(`Deleted ${path}`);
  },
});

/**
 * The agent's tools for changing code, which both the model and code mode scripts may call:
 * Pi Durable's `write` and `edit`, unchanged, and Camox's `mv` and `rm`.
 */
export const codeWritingTools = (): ToolRegistration[] => [
  createWriteTool() as unknown as ToolRegistration,
  createEditTool() as unknown as ToolRegistration,
  mvTool as unknown as ToolRegistration,
  rmTool as unknown as ToolRegistration,
];

const pathsIn =
  (...keys: string[]) =>
  (args: unknown) =>
    keys.flatMap((key) => {
      const path = (args as Record<string, unknown> | null)?.[key];
      return typeof path === "string" ? [path] : [];
    });

/** The tools changing code, with the paths a call of each writes. */
export const CODE_WRITES: { name: string; paths: (args: unknown) => string[] }[] = [
  { name: "write", paths: pathsIn("path") },
  { name: "edit", paths: pathsIn("path") },
  { name: "mv", paths: pathsIn("from", "to") },
  { name: "rm", paths: pathsIn("path") },
];

/** The agent's tools for reading code, which both the model and code mode scripts may call. */
export const codeReadingTools = (): ToolRegistration[] => [
  createReadTool() as unknown as ToolRegistration,
  grepTool as unknown as ToolRegistration,
  findTool as unknown as ToolRegistration,
  lsTool as unknown as ToolRegistration,
];
