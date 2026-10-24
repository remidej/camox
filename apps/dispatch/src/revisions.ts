import { untarGzip } from "./tar";

// A revision of a draft with code runs as a Dynamic Worker that dispatch loads from its build in
// R2 (ADR 0023). The API names one by `RevisionToLoad`; its build is the gzipped tar archive of the
// website's `dist/` the revision sandbox stored: `dist/client/` and the server build's directory
// with its `wrangler.json`.

/**
 * A revision, as the API names it to dispatch. Mirrored in apps/api/src/domains/revisions/dispatch.ts:
 * keep the two in sync.
 */
export type RevisionToLoad = {
  /** The revision's ID, which names its Dynamic Worker. */
  revision: string;
  /** Its build in `REVISION_BUILDS`. */
  archiveKey: string;
  /** Its project's Project ID. */
  project: string;
  /** Its draft's ID. */
  draft: string;
};

/** What scopes a revision's outbound requests: its project and draft. */
export type GatewayProps = { project: string; draft: string };

/** The bindings a revision is loaded with. */
export interface RevisionBindings {
  LOADER: WorkerLoader;
  REVISION_BUILDS: R2Bucket;
}

/** The SDK's global holding the URL prefix of a build's assets (`assetPrefix.ts` in `camox`). */
const ASSET_PREFIX_GLOBAL = "__CAMOX_ASSET_PREFIX__";
/** The entrypoint a website's server build exposes its Definition Set by (`camox`'s worker). */
const DEFINITION_SET_ENTRYPOINT = "CamoxDefinitionSet";

/** Where a revision's client assets are served from: its asset prefix. */
export const revisionAssetPrefix = (revision: string) => `/_camox/r/${revision}/`;

// The modules a loaded revision is given, besides its server build's. Their names can't clash
// with a build's: Vite emits none starting with `__camox`.
const ENTRY_MODULE = "__camox-revision-entry.js";
const PREFIX_MODULE = "__camox-asset-prefix.js";

/** The Wrangler configuration a server build leaves beside its bundle. */
type BuiltWranglerConfig = {
  main: string;
  compatibility_date: string;
  compatibility_flags?: string[];
};

/** A server build's file as a Worker Loader module, or null for a file that isn't a module. */
function moduleOf(path: string, content: Uint8Array): string | WorkerLoaderModule | null {
  if (/\.m?js$/.test(path)) return { js: new TextDecoder().decode(content) };
  if (path.endsWith(".cjs")) return { cjs: new TextDecoder().decode(content) };
  if (path.endsWith(".wasm")) return { wasm: content };
  if (/\.(txt|html|sql)$/.test(path)) return { text: new TextDecoder().decode(content) };
  if (path.endsWith(".bin")) return { data: content.slice().buffer };
  return null;
}

/**
 * The code of a revision's Dynamic Worker, from its build: the server build's modules, run with
 * the compatibility date and flags of its `wrangler.json`. Its main module sets the revision's
 * asset prefix in a module of its own, which runs before the server bundle loads, then
 * re-exports the build, its named entrypoints included.
 */
function revisionCode(
  files: Map<string, Uint8Array>,
  { revision, archiveKey }: RevisionToLoad,
  globalOutbound: Fetcher,
): WorkerLoaderWorkerCode {
  const configPath = [...files.keys()].find((path) =>
    /^dist\/(?!client\/)[^/]+\/wrangler\.json$/.test(path),
  );
  if (!configPath) throw new Error(`The build ${archiveKey} has no server build`);
  const serverDir = configPath.slice(0, -"wrangler.json".length);
  const config = JSON.parse(new TextDecoder().decode(files.get(configPath))) as BuiltWranglerConfig;

  const modules: Record<string, string | WorkerLoaderModule> = {};
  for (const [path, content] of files) {
    if (!path.startsWith(serverDir) || path === configPath) continue;
    const module = moduleOf(path, content);
    if (module) modules[path.slice(serverDir.length)] = module;
  }
  const build = JSON.stringify(`./${config.main.replace(/^\.\//, "")}`);
  modules[PREFIX_MODULE] = {
    js: `globalThis.${ASSET_PREFIX_GLOBAL} = ${JSON.stringify(revisionAssetPrefix(revision))};\n`,
  };
  modules[ENTRY_MODULE] = {
    js: `import "./${PREFIX_MODULE}";\nexport * from ${build};\nexport { default } from ${build};\n`,
  };
  return {
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [],
    mainModule: ENTRY_MODULE,
    modules,
    // A website's Worker uses no bindings: its client assets are served by dispatch.
    env: {},
    globalOutbound,
  };
}

/**
 * A revision's Dynamic Worker, loaded from its build the first time it's needed. Its outbound
 * requests go through `gateway`, made for its project and draft.
 */
export function loadRevision(
  env: RevisionBindings,
  toLoad: RevisionToLoad,
  gateway: (props: GatewayProps) => Fetcher,
): WorkerStub {
  return env.LOADER.get(toLoad.revision, async () =>
    revisionCode(
      await buildFiles(env, toLoad),
      toLoad,
      gateway({ project: toLoad.project, draft: toLoad.draft }),
    ),
  );
}

/** The files of a revision's build, from its archive. */
async function buildFiles(env: RevisionBindings, { archiveKey }: RevisionToLoad) {
  const archive = await env.REVISION_BUILDS.get(archiveKey);
  if (!archive) throw new Error(`The build ${archiveKey} isn't stored`);
  return untarGzip(archive.body);
}

/** A build's client assets, which a revision serves under its asset prefix. */
const CLIENT_DIR = "dist/client/";

/**
 * Where a revision's client asset at `path` (within `dist/client/`) is stored once it's
 * prewarmed. Keyed by project, so a host only serves its own project's revisions. Mirrored in
 * apps/api/src/domains/revisions/archive.ts, which deletes them: keep the two in sync.
 */
export const revisionAssetKey = (project: string, revision: string, path: string) =>
  `${project}/revisions/${revision}/${path}`;

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
  CONTENT_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

/**
 * Readies a revision before anyone is told of it, as the API asks once its build passed: stores
 * its client assets where its asset prefix serves them from, then loads it and renders its
 * renderer document once, so the first member to reload doesn't wait for either.
 */
export async function prewarmRevision(
  env: RevisionBindings,
  toLoad: RevisionToLoad,
  gateway: (props: GatewayProps) => Fetcher,
): Promise<void> {
  const files = await buildFiles(env, toLoad);
  await Promise.all(
    [...files]
      .filter(([path]) => path.startsWith(CLIENT_DIR))
      .map(([path, content]) =>
        env.REVISION_BUILDS.put(
          revisionAssetKey(toLoad.project, toLoad.revision, path.slice(CLIENT_DIR.length)),
          content,
          { httpMetadata: { contentType: contentTypeOf(path) } },
        ),
      ),
  );
  const rendered = await loadRevision(env, toLoad, gateway)
    .getEntrypoint()
    .fetch(new Request("https://prewarm.camox.invalid" + RENDERER_DOCUMENT_PATH));
  // Its body is drained so the render runs to its end; how it went isn't the prewarm's to judge.
  await rendered.arrayBuffer();
}

/** The renderer document's path (`RUNTIME_ROUTE_PATHS.renderer` in `camox`). */
const RENDERER_DOCUMENT_PATH = "/_camox/renderer";

/** The path a revision's client asset is served at: under its asset prefix. */
const ASSET_PATH = /^\/_camox\/r\/([^/]+)\/(.+)$/;

/** Whether a request's path is under some revision's asset prefix. */
export const isRevisionAssetPath = (pathname: string) => pathname.startsWith("/_camox/r/");

/**
 * A prewarmed revision's client asset of `project`, at a path under its asset prefix, to anyone:
 * its names are hashed, and its revision's ID unguessable. Not found otherwise.
 */
export async function serveRevisionAsset(
  env: RevisionBindings,
  project: string,
  pathname: string,
): Promise<Response> {
  const match = ASSET_PATH.exec(pathname);
  const asset =
    match && (await env.REVISION_BUILDS.get(revisionAssetKey(project, match[1]!, match[2]!)));
  if (!asset) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(asset.body, {
    headers: {
      "content-type": asset.httpMetadata?.contentType ?? contentTypeOf(pathname),
      // A revision's assets never change: they're its build's, which nothing rewrites.
      "cache-control": "public, max-age=31536000, immutable",
      etag: asset.httpEtag,
    },
  });
}

/** A revision's Definition Set, as its build's entrypoint gives it (JSON-shaped). */
export function readDefinitionSet(revision: WorkerStub): Promise<unknown> {
  const entrypoint = revision.getEntrypoint(DEFINITION_SET_ENTRYPOINT) as unknown as {
    read(): Promise<unknown>;
  };
  return entrypoint.read();
}
