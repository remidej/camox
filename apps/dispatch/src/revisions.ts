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
  return env.LOADER.get(toLoad.revision, async () => {
    const archive = await env.REVISION_BUILDS.get(toLoad.archiveKey);
    if (!archive) throw new Error(`The build ${toLoad.archiveKey} isn't stored`);
    const files = await untarGzip(archive.body);
    return revisionCode(files, toLoad, gateway({ project: toLoad.project, draft: toLoad.draft }));
  });
}

/** A revision's Definition Set, as its build's entrypoint gives it (JSON-shaped). */
export function readDefinitionSet(revision: WorkerStub): Promise<unknown> {
  const entrypoint = revision.getEntrypoint(DEFINITION_SET_ENTRYPOINT) as unknown as {
    read(): Promise<unknown>;
  };
  return entrypoint.read();
}
