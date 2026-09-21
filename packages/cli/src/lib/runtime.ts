import fs from "node:fs";
import path from "node:path";

import { ZodError, z } from "zod";

/**
 * Subset of the camox vite plugin's options that the CLI needs at dispatch
 * time. Written by the plugin to `node_modules/.camox/runtime.json` on every
 * `configResolved` (dev + build), so it always reflects what vite actually
 * loaded — including `_internal.apiUrl` overrides.
 *
 * Schema is the source of truth; the TS type is derived from it via
 * `z.infer` so the two never drift.
 */
export const runtimeSchema = z.object({
  projectSlug: z.string().min(1),
  apiUrl: z.string().url(),
  authenticationUrl: z.string().url(),
  disableTelemetry: z.boolean().optional().default(false),
});

export type Runtime = z.infer<typeof runtimeSchema>;

const SIDECAR = path.join("node_modules", ".camox", "runtime.json");

export class RuntimeNotFoundError extends Error {
  readonly cwd: string;
  constructor(cwd: string) {
    super(
      `No Camox runtime found. Looked for "${SIDECAR}" starting from ${cwd} and its parent directories. ` +
        "Change into your app directory or pass --cwd <app-path>. " +
        "If you're already targeting the correct app, run its dev server or build once to generate the runtime file.",
    );
    this.cwd = cwd;
    this.name = "RuntimeNotFoundError";
  }
}

export class RuntimeDirectoryError extends Error {
  constructor(directory: string) {
    super(
      `Runtime lookup directory "${directory}" does not exist, is not a directory, or cannot be accessed. Check --cwd <app-path>.`,
    );
    this.name = "RuntimeDirectoryError";
  }
}

export class RuntimeMalformedError extends Error {
  constructor(file: string, reason: string) {
    super(
      `Camox runtime sidecar at ${file} is malformed (${reason}). ` +
        "Re-run your project's dev server to regenerate it.",
    );
    this.name = "RuntimeMalformedError";
  }
}

/**
 * Walk up from cwd looking for the sidecar. Validates against `runtimeSchema`
 * and throws `RuntimeNotFoundError` / `RuntimeMalformedError` with messages
 * that tell the user how to fix it.
 */
export function loadRuntime(cwd: string = process.cwd()): Runtime {
  let dir = path.resolve(cwd);
  try {
    if (!fs.statSync(dir).isDirectory()) throw new RuntimeDirectoryError(dir);
  } catch {
    throw new RuntimeDirectoryError(dir);
  }
  const start = dir;
  while (true) {
    const candidate = path.join(dir, SIDECAR);
    if (fs.existsSync(candidate)) {
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      } catch (e) {
        throw new RuntimeMalformedError(candidate, e instanceof Error ? e.message : String(e));
      }
      try {
        return runtimeSchema.parse(raw);
      } catch (e) {
        if (e instanceof ZodError) {
          const reason = e.issues
            .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
            .join("; ");
          throw new RuntimeMalformedError(candidate, reason);
        }
        throw e;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new RuntimeNotFoundError(start);
    dir = parent;
  }
}
