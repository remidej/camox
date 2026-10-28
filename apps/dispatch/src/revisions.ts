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

/** A build's server build: its folder within the archive, and its `wrangler.json`. */
function serverBuildOf(files: Map<string, Uint8Array>, archiveKey: string) {
  const configPath = [...files.keys()].find((path) =>
    /^dist\/(?!client\/)[^/]+\/wrangler\.json$/.test(path),
  );
  if (!configPath) throw new Error(`The build ${archiveKey} has no server build`);
  const serverDir = configPath.slice(0, -"wrangler.json".length);
  const config = JSON.parse(new TextDecoder().decode(files.get(configPath))) as BuiltWranglerConfig;
  return { serverDir, configPath, config };
}

/**
 * The SDK Bundle a build names (ADR 0029), one name per target, in its server build's
 * `camox-sdk-bundle.json` (`SDK_BUNDLE_BUILD_MANIFEST` in `camox`). Null for a whole-app build.
 */
function sdkBundleOf(files: Map<string, Uint8Array>, archiveKey: string): SdkBundleNames | null {
  const manifest = files.get(`${serverBuildOf(files, archiveKey).serverDir}${SDK_BUNDLE_MANIFEST}`);
  if (!manifest) return null;
  const { browser, workerd } = JSON.parse(new TextDecoder().decode(manifest)) as SdkBundleNames;
  if (!SDK_BUNDLE_NAME.test(browser) || !SDK_BUNDLE_NAME.test(workerd)) {
    throw new Error(`The build ${archiveKey} names an SDK Bundle that isn't one`);
  }
  return { browser, workerd };
}

/**
 * The code of a revision's Dynamic Worker, from its build: the server build's modules, with
 * those of the workerd SDK Bundle it names, which its chunks import from `_camox/sdk/<name>/` at
 * its folder's root, run with the compatibility date and flags of its `wrangler.json`. Its main
 * module sets the revision's asset prefix in a module of its own, which runs before the server
 * bundle loads, then re-exports the build, its named entrypoints included.
 */
async function revisionCode(
  env: RevisionBindings,
  files: Map<string, Uint8Array>,
  { revision, archiveKey }: RevisionToLoad,
  globalOutbound: Fetcher,
): Promise<WorkerLoaderWorkerCode> {
  const { serverDir, configPath, config } = serverBuildOf(files, archiveKey);
  const sdkBundle = sdkBundleOf(files, archiveKey);

  const modules: Record<string, string | WorkerLoaderModule> = sdkBundle
    ? { ...(await sdkBundleModules(env, sdkBundle.workerd)) }
    : {};
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
      env,
      await buildFiles(env, toLoad),
      toLoad,
      gateway({ project: toLoad.project, draft: toLoad.draft }),
    ),
  );
}

/** An SDK Bundle's name: a digest, as `sdkBundleName` in `camox` makes it. */
const SDK_BUNDLE_NAME = /^[0-9a-f]{32}$/;
/** The file a build names its SDK Bundle in (`SDK_BUNDLE_BUILD_MANIFEST` in `camox`). */
const SDK_BUNDLE_MANIFEST = "camox-sdk-bundle.json";

/** An SDK Bundle's names, one per target. Mirrors `SdkBundleNames` in `camox`. */
type SdkBundleNames = { browser: string; workerd: string };

/**
 * Where one target's SDK Bundle is stored, as ensuring it stores it: a gzipped tar archive of its
 * folder. Mirrored in apps/api/src/domains/sdk-bundles/ensure.ts: keep the two in sync.
 */
export const sdkBundleArchiveKey = (name: string) => `sdk/${name}.tar.gz`;

/**
 * Where a browser SDK Bundle's files are stored to be served, as a revision's client assets are:
 * one pack, and its index, written last. Under no project, as every project serves them, and
 * never deleted, as SDK Bundles aren't.
 */
const sdkBundlePackKey = (name: string) => `sdk/${name}/#assets`;
const sdkBundleIndexKey = (name: string) => `sdk/${name}/#index`;

/** The workerd SDK Bundles' modules this isolate read, by bucket and name: they never change. */
const sdkBundleModulesOf = new WeakMap<
  R2Bucket,
  Map<string, Promise<Record<string, WorkerLoaderModule | string>>>
>();
/** How many workerd SDK Bundles an isolate keeps the modules of, dropping the oldest. A tuning value. */
const SDK_BUNDLES_KEPT = 4;

/**
 * A workerd SDK Bundle's modules, keyed where a server build imports them from: under
 * `_camox/sdk/<name>/`. Read once per isolate.
 */
function sdkBundleModules(env: RevisionBindings, name: string) {
  let kept = sdkBundleModulesOf.get(env.REVISION_BUILDS);
  if (!kept) {
    kept = new Map();
    sdkBundleModulesOf.set(env.REVISION_BUILDS, kept);
  }
  const found = kept.get(name);
  if (found) return found;
  const read = sdkBundleFiles(env, name).then((files) => {
    const modules: Record<string, WorkerLoaderModule | string> = {};
    for (const [path, content] of files) {
      const module = moduleOf(path, content);
      if (module) modules[`_camox/sdk/${name}/${path}`] = module;
    }
    return modules;
  });
  // A read that failed is tried again by the next load.
  const forget = () => {
    if (kept.get(name) === read) kept.delete(name);
  };
  read.catch(forget);
  kept.set(name, read);
  if (kept.size > SDK_BUNDLES_KEPT) kept.delete(kept.keys().next().value!);
  return read;
}

/** One target's SDK Bundle's files, from its stored archive. */
async function sdkBundleFiles(env: RevisionBindings, name: string) {
  const archive = await env.REVISION_BUILDS.get(sdkBundleArchiveKey(name));
  if (!archive) throw new Error(`An SDK Bundle isn't stored: ${sdkBundleArchiveKey(name)}`);
  return untarGzip(archive.body);
}

/** The browser SDK Bundles this isolate knows are stored to be served, by bucket. */
const servedSdkBundlesOf = new WeakMap<R2Bucket, Set<string>>();

/**
 * Stores a browser SDK Bundle's files where `/_camox/sdk/<name>/` serves them from, unless
 * they're there: the first revision naming it to be prepared stores them for every project.
 */
async function storeSdkBundleAssets(env: RevisionBindings, name: string) {
  let served = servedSdkBundlesOf.get(env.REVISION_BUILDS);
  if (!served) {
    served = new Set();
    servedSdkBundlesOf.set(env.REVISION_BUILDS, served);
  }
  if (served.has(name)) return;
  if (!(await env.REVISION_BUILDS.head(sdkBundleIndexKey(name)))) {
    const { pack, index } = packed([...(await sdkBundleFiles(env, name))]);
    // The index last: a bundle with an index has its pack. Each is written only if nothing has
    // its key, so a name's served bytes never change once stored, whoever races to store them.
    const once = { onlyIf: { etagDoesNotMatch: "*" } };
    await env.REVISION_BUILDS.put(sdkBundlePackKey(name), pack, once);
    await env.REVISION_BUILDS.put(sdkBundleIndexKey(name), JSON.stringify(index), once);
  }
  served.add(name);
}

/** What loading a revision whose build isn't stored fails with. */
const MISSING_BUILD = "A revision's build isn't stored";

/**
 * Whether `error` says a revision's build isn't stored, as when it was pruned since the API
 * answered. Matched by message: an error thrown while the loader loads crosses as a plain one.
 */
export const isMissingBuild = (error: unknown) =>
  error instanceof Error && error.message.startsWith(MISSING_BUILD);

/** The files of a revision's build, from its archive. */
async function buildFiles(env: RevisionBindings, { archiveKey }: RevisionToLoad) {
  const archive = await env.REVISION_BUILDS.get(archiveKey);
  if (!archive) throw new Error(`${MISSING_BUILD}: ${archiveKey}`);
  return untarGzip(archive.body);
}

/** A build's client assets, which a revision serves under its asset prefix. */
const CLIENT_DIR = "dist/client/";

/**
 * Where a revision's client asset at `path` (within `dist/client/`) was stored, one object each,
 * by revisions prewarmed before their assets were packed: still served while such a revision is
 * previewed. Keyed by project, so a host only serves its own project's revisions. Its prefix is
 * mirrored in apps/api/src/domains/revisions/archive.ts, which deletes what's under it: keep the
 * two in sync.
 */
export const revisionAssetKey = (project: string, revision: string, path: string) =>
  `${project}/revisions/${revision}/${path}`;

/**
 * Where a prepared revision's client assets are stored, one after the other in one object, and
 * where the index saying where each one is. Under the revision's asset key prefix, so deleting
 * its assets deletes them; `#` never starts an asset's path, which a URL can't hold.
 */
export const revisionAssetsPackKey = (project: string, revision: string) =>
  revisionAssetKey(project, revision, "#assets");
export const revisionAssetsIndexKey = (project: string, revision: string) =>
  revisionAssetKey(project, revision, "#index");

/** Where each client asset is in its revision's pack: its offset, length and content type. */
type AssetIndex = Record<string, [offset: number, length: number, contentType: string]>;

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

/** Files one after the other in one pack, with the index saying where each one is. */
function packed(files: (readonly [path: string, content: Uint8Array])[]) {
  const pack = new Uint8Array(files.reduce((size, [, content]) => size + content.byteLength, 0));
  const index: AssetIndex = {};
  let offset = 0;
  for (const [path, content] of files) {
    pack.set(content, offset);
    index[path] = [offset, content.byteLength, contentTypeOf(path)];
    offset += content.byteLength;
  }
  return { pack, index };
}

/**
 * Stores a revision's client assets where its asset prefix serves them from: in one object, with
 * its index beside it, since a Worker writes only a few objects at once, and a build's client
 * assets are dozens. Returns how many it stored.
 */
async function storeClientAssets(
  env: RevisionBindings,
  { project, revision }: RevisionToLoad,
  files: Map<string, Uint8Array>,
) {
  const assets = [...files]
    .filter(([path]) => path.startsWith(CLIENT_DIR))
    .map(([path, content]) => [path.slice(CLIENT_DIR.length), content] as const);
  const { pack, index } = packed(assets);
  // Both at once: no one asks for the revision's assets before the API is told it's prepared.
  await Promise.all([
    env.REVISION_BUILDS.put(revisionAssetsPackKey(project, revision), pack),
    env.REVISION_BUILDS.put(revisionAssetsIndexKey(project, revision), JSON.stringify(index)),
  ]);
  return assets.length;
}

/**
 * Readies a revision before anyone is told of it, as the API asks once its build passed, reading
 * its build once, from `archive` when the API sends it, as it does while it stores it, or else
 * from R2: stores its client assets where its asset prefix serves them from, and loads it
 * to read its Definition Set and render its renderer document once, so the first member to
 * reload waits for neither. Returns the Definition Set (JSON-shaped, not yet checked), with what
 * each part took.
 */
export async function prepareRevision(
  env: RevisionBindings,
  toLoad: RevisionToLoad,
  gateway: (props: GatewayProps) => Fetcher,
  archive?: Uint8Array,
): Promise<PreparedRevision> {
  const startedAt = Date.now();
  const files = archive
    ? await untarGzip(new Response(archive).body!)
    : await buildFiles(env, toLoad);
  const readAt = Date.now();
  const revision = env.LOADER.get(toLoad.revision, async () =>
    revisionCode(env, files, toLoad, gateway({ project: toLoad.project, draft: toLoad.draft })),
  );
  const sdkBundle = sdkBundleOf(files, toLoad.archiveKey);
  const timed = async <T>(run: () => Promise<T>) => {
    const at = Date.now();
    return { result: await run(), ms: Date.now() - at };
  };
  const [stored, read] = await Promise.all([
    timed(async () => {
      const [assets] = await Promise.all([
        storeClientAssets(env, toLoad, files),
        sdkBundle && storeSdkBundleAssets(env, sdkBundle.browser),
      ]);
      return assets;
    }),
    timed(() => readDefinitionSet(revision)),
  ]);
  const rendered = await timed(async () => {
    const response = await revision
      .getEntrypoint()
      .fetch(new Request("https://prewarm.camox.invalid" + RENDERER_DOCUMENT_PATH));
    // Its body is drained so the render runs to its end; how it went isn't the prewarm's to judge.
    await response.arrayBuffer();
  });
  return {
    definitionSet: read.result,
    assets: stored.result,
    readMs: readAt - startedAt,
    assetsMs: stored.ms,
    definitionSetMs: read.ms,
    renderMs: rendered.ms,
  };
}

/**
 * What preparing a revision took, for the API's timing logs: reading its build (unpacking it, and
 * first fetching it from R2 unless the API sent it), then, at once,
 * storing its client assets (how many) and reading its Definition Set, then the first render.
 * Mirrored in apps/api/src/domains/revisions/dispatch.ts: keep the two in sync.
 */
export type PrepareTimings = {
  assets: number;
  readMs: number;
  assetsMs: number;
  definitionSetMs: number;
  renderMs: number;
};

/** A prepared revision's Definition Set, with what preparing it took. */
export type PreparedRevision = PrepareTimings & { definitionSet: unknown };

/** The renderer document's path (`RUNTIME_ROUTE_PATHS.renderer` in `camox`). */
export const RENDERER_DOCUMENT_PATH = "/_camox/renderer";

/** The path a revision's client asset is served at: under its asset prefix. */
const ASSET_PATH = /^\/_camox\/r\/([^/]+)\/(.+)$/;

/** Whether a request's path is under some revision's asset prefix. */
export const isRevisionAssetPath = (pathname: string) => pathname.startsWith("/_camox/r/");

/** The indexes of revisions' asset packs this isolate read, by bucket and key: they never change. */
const assetIndexesOf = new WeakMap<R2Bucket, Map<string, Promise<AssetIndex | null>>>();
/** How many indexes an isolate keeps, dropping the oldest. A tuning value. */
const ASSET_INDEXES_KEPT = 100;

/** The index of the asset pack at `key`, or null when it isn't stored (yet). */
function assetIndexOf(env: RevisionBindings, key: string) {
  let assetIndexes = assetIndexesOf.get(env.REVISION_BUILDS);
  if (!assetIndexes) {
    assetIndexes = new Map();
    assetIndexesOf.set(env.REVISION_BUILDS, assetIndexes);
  }
  const kept = assetIndexes.get(key);
  if (kept) return kept;
  const read = env.REVISION_BUILDS.get(key).then(async (object) =>
    object ? ((await object.json()) as AssetIndex) : null,
  );
  // A revision not prepared yet may be soon: only an index found is kept.
  const forget = () => {
    if (assetIndexes.get(key) === read) assetIndexes.delete(key);
  };
  void read.then((index) => index || forget(), forget);
  assetIndexes.set(key, read);
  if (assetIndexes.size > ASSET_INDEXES_KEPT) {
    assetIndexes.delete(assetIndexes.keys().next().value!);
  }
  return read;
}

/** A client asset's answer: its build's, which nothing rewrites, so its revision's for good. */
function assetResponse(body: BodyInit | null, contentType: string, etag: string) {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      etag,
    },
  });
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/**
 * A prepared revision's client asset of `project`, at a path under its asset prefix, to anyone:
 * its names are hashed, and its revision's ID unguessable. Not found otherwise.
 */
export async function serveRevisionAsset(
  env: RevisionBindings,
  project: string,
  pathname: string,
): Promise<Response> {
  const match = ASSET_PATH.exec(pathname);
  if (!match) return notFound();
  const [, revision, path] = match as unknown as [string, string, string];
  const index = await assetIndexOf(env, revisionAssetsIndexKey(project, revision));
  if (index) {
    return packedAsset(env, index, revisionAssetsPackKey(project, revision), path, revision);
  }
  // A revision prewarmed before assets were packed has an object for each.
  const asset = await env.REVISION_BUILDS.get(revisionAssetKey(project, revision, path));
  if (!asset) return notFound();
  return assetResponse(
    asset.body,
    asset.httpMetadata?.contentType ?? contentTypeOf(pathname),
    asset.httpEtag,
  );
}

/** The asset at `path` in the pack at `packKey`, which `index` indexes. */
async function packedAsset(
  env: RevisionBindings,
  index: AssetIndex,
  packKey: string,
  path: string,
  etagPrefix: string,
) {
  const entry = Object.hasOwn(index, path) ? index[path] : undefined;
  if (!entry) return notFound();
  const [offset, length, contentType] = entry;
  const etag = `"${etagPrefix}-${offset}"`;
  if (length === 0) return assetResponse(null, contentType, etag);
  const asset = await env.REVISION_BUILDS.get(packKey, { range: { offset, length } });
  return asset ? assetResponse(asset.body, contentType, etag) : notFound();
}

/** The path a browser SDK Bundle's file is served at. */
const SDK_BUNDLE_PATH = /^\/_camox\/sdk\/([0-9a-f]{32})\/(.+)$/;

/** Whether a request's path is under some SDK Bundle's prefix. */
export const isSdkBundlePath = (pathname: string) => pathname.startsWith("/_camox/sdk/");

/**
 * A browser SDK Bundle's file, at a path under its prefix, to anyone, on any project's host: it's
 * the same for every project, and never changes under its name. Null until a revision naming it
 * was prepared, and for a workerd SDK Bundle, which no revision serves: Live's Worker, which
 * holds its own SDK Bundle's files, answers then.
 */
export async function serveSdkBundleFile(env: RevisionBindings, pathname: string) {
  const match = SDK_BUNDLE_PATH.exec(pathname);
  if (!match) return null;
  const [, name, path] = match as unknown as [string, string, string];
  const index = await assetIndexOf(env, sdkBundleIndexKey(name));
  return index ? packedAsset(env, index, sdkBundlePackKey(name), path, name) : null;
}

/** A revision's Definition Set, as its build's entrypoint gives it (JSON-shaped). */
export function readDefinitionSet(revision: WorkerStub): Promise<unknown> {
  const entrypoint = revision.getEntrypoint(DEFINITION_SET_ENTRYPOINT) as unknown as {
    read(): Promise<unknown>;
  };
  return entrypoint.read();
}
