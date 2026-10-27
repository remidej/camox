import { PUBLISHING_DRAFT_VAR } from "@camox/api-contract/drafts";
import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import { untarGzip } from "../../lib/tar";
import { type SpanFields, timed } from "../../lib/timing";
import {
  deleteUserWorker,
  deleteUserWorkersTagged,
  uploadUserWorker,
  type UserWorker,
  type WorkerModule,
} from "../../lib/user-workers";
import type { Bindings } from "../../types";
import { projects } from "../projects/schema";

// A publish with code uploads the build of the revision members previewed as a user Worker of its
// own, its publish script, beside the one named after the Project ID that releases deploy. The
// project's live script pointer (`projects.live_script`) says which serves the website: dispatch
// reads it (apps/dispatch/src/live-script.ts), so promoting and rolling back a publish is writing
// it. Workers for Platforms user Workers have no versions to upload without serving (README.md).

/**
 * A draft's publish script: named after its project's Project ID and the draft's ID, 81
 * characters of the 255 a Worker's name can have. The draft uploads the build of each revision it
 * previews to it ahead of its publish (`DraftCode.prepareUpload`), and its publish points Live at
 * it.
 */
export const publishScriptName = (project: string, draft: string) => `${project}-publish-${draft}`;

/** The tag of every publish script of a project, which releases and deletion delete them by. */
export const publishScriptsTag = (project: string) => `camox-publish-${project}`;

/** A revision's build that can't be published as it is. Workflows retry the step. */
export class UnpublishableBuildError extends Error {
  override name = "UnpublishableBuildError";
}

/**
 * The compatibility flags a website's Worker may run with: the Template's. A build asking for
 * others isn't published, as only Camox chooses what the runtime gives a website.
 */
const ALLOWED_COMPATIBILITY_FLAGS = new Set(["nodejs_compat"]);
const COMPATIBILITY_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A server build's file as a module of its Worker, with the type its upload gives it. */
function moduleType(path: string) {
  if (/\.m?js$/.test(path)) return "application/javascript+module";
  if (path.endsWith(".cjs")) return "application/javascript";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (/\.(txt|html|sql)$/.test(path)) return "text/plain";
  if (path.endsWith(".bin")) return "application/octet-stream";
  return null;
}

/** Content types of the files a client build holds, by extension. */
const CONTENT_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json",
  map: "application/json",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  webmanifest: "application/manifest+json",
};

const contentTypeOf = (path: string) =>
  CONTENT_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/null";

const CLIENT_DIR = "dist/client/";
/** Files of `dist/client/` that configure its assets rather than being ones (as wrangler reads them). */
const ASSETS_IGNORE = ".assetsignore";
const HEADERS = "_headers";
const REDIRECTS = "_redirects";

/** Whether `.assetsignore`'s patterns, as gitignore reads them, leave out the asset `path`. */
function ignoredBy(patterns: string[], path: string) {
  return patterns.some((pattern) => {
    const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
    const glob = pattern.replace(/^\//, "").replace(/\/$/, "");
    const source = glob
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*");
    return new RegExp(`${anchored ? "^" : "(^|/)"}${source}(/|$)`).test(path);
  });
}

const decode = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

/**
 * The user Worker of a revision's build, made from trusted inputs only: its server build's
 * modules, its client assets, the compatibility date and flags its `wrangler.json` names, once
 * checked, and the platform's variables. Nothing else of that `wrangler.json`, which the agent's
 * build wrote, is read, and nothing of the build runs.
 */
export function workerOfBuild(
  files: Map<string, Uint8Array>,
  { vars, tags }: { vars: Record<string, string>; tags: string[] },
): UserWorker {
  const configPath = [...files.keys()].find((path) =>
    /^dist\/(?!client\/)[^/]+\/wrangler\.json$/.test(path),
  );
  if (!configPath) throw new UnpublishableBuildError("The build has no server build");
  const serverDir = configPath.slice(0, -"wrangler.json".length);
  let config: { main?: unknown; compatibility_date?: unknown; compatibility_flags?: unknown };
  try {
    config = JSON.parse(decode(files.get(configPath))!);
  } catch {
    throw new UnpublishableBuildError("The server build's wrangler.json isn't JSON");
  }

  const modules: WorkerModule[] = [];
  for (const [path, content] of files) {
    if (!path.startsWith(serverDir)) continue;
    const type = moduleType(path);
    if (type) modules.push({ name: path.slice(serverDir.length), content, type });
  }
  const main = typeof config.main === "string" ? config.main.replace(/^\.\//, "") : "";
  if (!modules.some(({ name, type }) => name === main && type.endsWith("+module"))) {
    throw new UnpublishableBuildError(`The server build's main module ${main} isn't in it`);
  }
  const date = config.compatibility_date;
  if (typeof date !== "string" || !COMPATIBILITY_DATE.test(date)) {
    throw new UnpublishableBuildError(`The server build's compatibility date isn't a date`);
  }
  const flags = config.compatibility_flags ?? [];
  if (
    !Array.isArray(flags) ||
    !flags.every((flag) => typeof flag === "string" && ALLOWED_COMPATIBILITY_FLAGS.has(flag))
  ) {
    throw new UnpublishableBuildError(
      `The server build asks for compatibility flags Camox doesn't allow: ${JSON.stringify(flags)}`,
    );
  }

  const ignored = [
    `/${ASSETS_IGNORE}`,
    `/${HEADERS}`,
    `/${REDIRECTS}`,
    ...(decode(files.get(`${CLIENT_DIR}${ASSETS_IGNORE}`)) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  ];
  const assets = [...files]
    .filter(([path]) => path.startsWith(CLIENT_DIR))
    .map(([path, content]) => ({ path: path.slice(CLIENT_DIR.length), content }))
    .filter(({ path }) => !ignoredBy(ignored, path))
    .map(({ path, content }) => ({ path: `/${path}`, content, contentType: contentTypeOf(path) }));
  const assetRules = {
    _headers: decode(files.get(`${CLIENT_DIR}${HEADERS}`)),
    _redirects: decode(files.get(`${CLIENT_DIR}${REDIRECTS}`)),
  };

  return {
    mainModule: main,
    modules,
    compatibilityDate: date,
    compatibilityFlags: flags as string[],
    vars,
    assets,
    assetRules: Object.fromEntries(
      Object.entries(assetRules).filter(([, rules]) => rules !== undefined),
    ),
    tags,
  };
}

/**
 * Uploads the build of a draft's revision as the draft's publish script. It carries the draft's
 * ID, so its public reads see Live overlaid with the draft while the draft publishes
 * (`PUBLISHING_DRAFT_HEADER`). Uploading again replaces it. Returns its name.
 */
export async function uploadPublishScript(
  env: Pick<Bindings, "REVISION_BUILDS" | "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  { project, draft, archiveKey }: { project: string; draft: string; archiveKey: string },
  span: SpanFields = {},
): Promise<string> {
  const worker = await timed("publish.upload.readBuild", span, async () => {
    const archive = await env.REVISION_BUILDS.get(archiveKey);
    if (!archive)
      throw new UnpublishableBuildError(`The revision's build ${archiveKey} isn't stored`);
    return workerOfBuild(await untarGzip(archive.body), {
      vars: { [PUBLISHING_DRAFT_VAR]: draft },
      tags: [publishScriptsTag(project)],
    });
  });
  const name = publishScriptName(project, draft);
  await timed(
    "publish.upload.worker",
    span,
    () => uploadUserWorker(env, name, worker),
    (upload) => upload,
  );
  return name;
}

/** The script the project's website is served by: a publish's, or null for its releases'. */
export async function liveScriptOf(db: Database, projectId: number) {
  const project = await db
    .select({ liveScript: projects.liveScript })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return project?.liveScript ?? null;
}

/**
 * The user Worker that serves the website of the project `project` (its Project ID), as dispatch
 * asks: a publish's script, or null for the one named after its Project ID, which its releases
 * deploy, including for a project that doesn't exist.
 */
export async function liveScriptOfProject(db: Database, project: string) {
  const row = await db
    .select({ liveScript: projects.liveScript })
    .from(projects)
    .where(eq(projects.uuid, project))
    .get();
  return row?.liveScript ?? null;
}

/** Serves the project's website with `script`, a publish's, or its releases' with null. */
export async function pointLiveAt(db: Database, projectId: number, script: string | null) {
  await db.update(projects).set({ liveScript: script }).where(eq(projects.id, projectId));
}

/** Deletes a publish's script, which nothing serves and nothing rolls back to anymore. */
export async function deletePublishScript(
  env: Pick<Bindings, "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  script: string,
) {
  await deleteUserWorker(env, script);
}

/** Deletes every publish script of the project `project` (its Project ID). */
export async function deletePublishScripts(
  env: Pick<Bindings, "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  project: string,
) {
  await deleteUserWorkersTagged(env, publishScriptsTag(project));
}

/**
 * How long until every dispatch isolate serves the script the pointer was moved to: the 2 seconds
 * dispatch keeps the pointer for (`LIVE_SCRIPT_TTL_MS` in apps/dispatch/src/live-script.ts: keep
 * the two in sync), and a second for the read in flight. Once the pointer moved, a publish waits
 * that long before its content goes on Live, so no request reads the new content with the
 * previous code.
 */
export const LIVE_SCRIPT_SETTLES = "3 seconds";
