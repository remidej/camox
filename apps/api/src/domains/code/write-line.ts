import { FileError } from "@earendil-works/pi-durable/env";

import type { WritePolicy } from "./env";

// The line between the website's own code, which the agent changes and members push (ADR 0021,
// ADR 0026), and the files the platform owns, which only Upgrades change. The extensions also
// keep binary assets out. This is its one definition: the agent's write tools check one path
// against it, and a push checks its whole tree.

const SOURCE = "src";
const PLATFORM_SOURCE = "src/camox";
const EXTENSIONS = ["ts", "tsx", "css"];
const CODE_FILE = new RegExp(`\\.(${EXTENSIONS.join("|")})$`);

/** The files the agent may write, as its instructions and refusals name them. */
export const WRITABLE = `\`${SOURCE}/**/*.{${EXTENSIONS.join(",")}}\`, except \`${PLATFORM_SOURCE}/\``;

const within = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/**
 * Why a file or directory isn't in the writable area: it's platform-owned, or it's under `src/`
 * but isn't a TypeScript or CSS file.
 */
export type Unwritable = "platformOwned" | "notCode";

/**
 * Why the path `path`, relative to the website's root, is outside the writable area, or
 * undefined when it's in it: a code file under `src/`, or a directory there to hold one, never
 * under `src/camox/`.
 */
export function unwritable(path: string, kind: "file" | "directory"): Unwritable | undefined {
  if (!within(path, SOURCE) || within(path, PLATFORM_SOURCE)) return "platformOwned";
  if (kind === "file" && !CODE_FILE.test(path)) return "notCode";
  return undefined;
}

/** A tree's files, by path relative to the website's root: what identifies each one's content. */
export type TreeFiles = ReadonlyMap<string, string>;

/**
 * The files outside the writable area that `tree` has differently from `reference`, or that only
 * one of them has, with why each is outside it, sorted by path.
 */
export function unwritableChanges(tree: TreeFiles, reference: TreeFiles) {
  const changed: { path: string; why: Unwritable }[] = [];
  for (const path of new Set([...tree.keys(), ...reference.keys()])) {
    if (tree.get(path) === reference.get(path)) continue;
    const why = unwritable(path, "file");
    if (why) changed.push({ path, why });
  }
  return changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Whether the agent may write the absolute path `path`, in the writable area. A refusal names
 * the rule.
 */
export const writeLine: WritePolicy = (path, kind) => {
  const relative = path.replace(/^\/+/, "");
  const refuse = (why: string) =>
    new FileError("permission_denied", `${why} You may write ${WRITABLE}.`, path);
  switch (unwritable(relative, kind)) {
    case "platformOwned":
      return refuse(`\`${relative || "/"}\` is platform-owned; only Upgrades change it.`);
    case "notCode":
      return refuse(`\`${relative}\` isn't a TypeScript or CSS file.`);
    case undefined:
      return undefined;
  }
};
