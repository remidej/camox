import { FileError } from "@earendil-works/pi-durable/env";

import type { WritePolicy } from "./env";

// The line between the website's own code, which the agent changes, and the files the platform
// owns, which only Upgrades change. The extensions also keep binary assets out.

/** The files the agent may write, as its instructions and refusals name them. */
export const WRITABLE = "`src/**/*.{ts,tsx,css}`, except `src/camox/`";

const SOURCE = "src";
const PLATFORM_SOURCE = "src/camox";
const CODE_FILE = /\.(ts|tsx|css)$/;

const within = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/**
 * Whether the agent may write the absolute path `path`: a code file under `src/`, or a
 * directory there to hold one, never under `src/camox/`. A refusal names the rule.
 */
export const writeLine: WritePolicy = (path, kind) => {
  const relative = path.replace(/^\/+/, "");
  const refuse = (why: string) =>
    new FileError("permission_denied", `${why} You may write ${WRITABLE}.`, path);
  if (!within(relative, SOURCE) || within(relative, PLATFORM_SOURCE)) {
    return refuse(`\`${relative || "/"}\` is platform-owned; only Upgrades change it.`);
  }
  if (kind === "file" && !CODE_FILE.test(relative)) {
    return refuse(`\`${relative}\` isn't a TypeScript or CSS file.`);
  }
  return undefined;
};
