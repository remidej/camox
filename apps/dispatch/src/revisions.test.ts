import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import { CamoxGateway, CamoxRevisions, type Env } from "./worker";

// A revision as the API names it to dispatch, and the build the revision sandbox archived for it.

const PROJECT = "5f0c8f6e-2d3b-4a7e-9c1d-0b8e6a4f2c11";
const DRAFT = "0195f2a4-7a6b-7c3d-8e9f-0a1b2c3d4e5f";
const REVISION = "0195f2a4-9b8c-7d6e-8f00-112233445566";
const API_URL = "https://api.camox.test";

/** The website's Definition Set, as its build's entrypoint gives it. */
const definitionSet = (stylesheetsUnder: string) => ({
  blocks: [
    {
      blockId: "pricing",
      title: "Pricing",
      description: `Three tiers, styled by ${stylesheetsUnder}assets/pricing.css`,
      contentSchema: { type: "object", properties: {} },
    },
  ],
  layouts: [],
  collections: [],
  homepage: null,
});

// A chunk name long enough to need a long-name record in the archive, as hashed chunks can.
const LONG_CHUNK = `assets/${"definition-set-of-the-website-with-every-block-".repeat(2)}B1x9.js`;

/**
 * The files of a revision's `dist/`, as `vp build` leaves them: the client assets, and the server
 * build's directory with its `wrangler.json`. The server bundle reads the asset prefix as it
 * loads, as the SDK's does, and exposes the Definition Set by its entrypoint's name.
 */
const BUILD: Record<string, string> = {
  "dist/client/assets/pricing.css": ".pricing { color: teal }\n",
  "dist/acme_website/wrangler.json": JSON.stringify({
    name: "acme_website",
    main: "index.js",
    compatibility_date: "2026-04-11",
    compatibility_flags: ["nodejs_compat"],
    assets: { directory: "../client" },
  }),
  "dist/acme_website/index.js": `import { definitionSet } from "./${LONG_CHUNK}";
const prefix = globalThis.__CAMOX_ASSET_PREFIX__ ?? "/";
export class CamoxDefinitionSet {
  read() {
    return definitionSet(prefix);
  }
}
export default { fetch: () => new Response("A page") };
`,
  [`dist/acme_website/${LONG_CHUNK}`]: `export const definitionSet = ${definitionSet.toString()};\n`,
};

/** `BUILD` archived the way the revision sandbox does: `tar -czf <archive> dist`. */
async function archived(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "camox-revision-build-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await promisify(execFile)("tar", ["-czf", "build.tar.gz", "dist"], { cwd: dir });
  return new Uint8Array(await readFile(join(dir, "build.tar.gz")));
}

type LoadedWorker = { name: string | null; code: WorkerLoaderWorkerCode };

/**
 * The Worker Loader binding, running each Worker it loads in Node: it writes the Worker's modules
 * to a directory, imports its main module, and answers an entrypoint's calls with the class its
 * main module exports under that name. It loads each name once, as Cloudflare caches it.
 */
function fakeLoader() {
  const loaded: LoadedWorker[] = [];
  const workers = new Map<string | null, Promise<Record<string, unknown>>>();
  const load = async (name: string | null, code: WorkerLoaderWorkerCode) => {
    loaded.push({ name, code });
    const dir = await mkdtemp(join(tmpdir(), "camox-loaded-worker-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    for (const [path, module] of Object.entries(code.modules)) {
      const source = typeof module === "string" ? module : (module as WorkerLoaderModule).js;
      if (source === undefined) continue;
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), source);
    }
    return (await import(pathToFileURL(join(dir, code.mainModule)).href)) as Record<
      string,
      unknown
    >;
  };
  const binding = {
    get(name: string | null, getCode: () => Promise<WorkerLoaderWorkerCode>) {
      if (!workers.has(name))
        workers.set(
          name,
          getCode().then((code) => load(name, code)),
        );
      const worker = workers.get(name)!;
      return {
        getEntrypoint: (entrypoint: string) =>
          new Proxy(
            {},
            {
              get:
                (_, method: string) =>
                async (...args: unknown[]) => {
                  const Class = (await worker)[entrypoint] as new () => Record<
                    string,
                    (...args: unknown[]) => unknown
                  >;
                  return new Class()[method]!(...args);
                },
            },
          ),
      };
    },
  };
  return { loaded, binding: binding as unknown as WorkerLoader };
}

/** Dispatch's bindings, with its R2 bucket of revision builds holding `archives` by key. */
function fakeEnv(archives: Record<string, Uint8Array>) {
  const loader = fakeLoader();
  const env = {
    LOADER: loader.binding,
    CAMOX_API_URL: API_URL,
    REVISION_BUILDS: {
      get: async (key: string) => {
        const archive = archives[key];
        return archive ? { body: new Response(archive).body } : null;
      },
    },
  } as unknown as Env;
  return { env, loaded: loader.loaded };
}

/**
 * What `ctx.exports` gives dispatch's own entrypoints: a gateway is the real `CamoxGateway`,
 * given the `props` it was made with.
 */
function context(env: Env, props: unknown = {}): ExecutionContext {
  const exports = {
    CamoxGateway: ({ props }: { props: unknown }) => {
      const gateway = new CamoxGateway(context(env, props), env);
      return { fetch: (request: Request) => gateway.fetch(request) };
    },
  };
  return { props, exports } as unknown as ExecutionContext;
}

const ARCHIVE_KEY = `${PROJECT}/${DRAFT}/${REVISION}.tar.gz`;
const revision = { project: PROJECT, draft: DRAFT, revision: REVISION, archiveKey: ARCHIVE_KEY };

async function readDefinitionSet(env: Env) {
  return new CamoxRevisions(context(env), env).readDefinitionSet(revision);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a revision, as dispatch loads it", () => {
  it("gives the API its Definition Set, read from its build under its asset prefix", async () => {
    const { env } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });

    expect(await readDefinitionSet(env)).toEqual(definitionSet(`/_camox/r/${REVISION}/`));
  });

  it("runs with the compatibility date and flags of its build's Wrangler configuration", async () => {
    const { env, loaded } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });

    await readDefinitionSet(env);

    expect(loaded).toMatchObject([
      {
        name: REVISION,
        code: { compatibilityDate: "2026-04-11", compatibilityFlags: ["nodejs_compat"] },
      },
    ]);
  });

  it("is loaded once however often it's read", async () => {
    const { env, loaded } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });

    await readDefinitionSet(env);
    await readDefinitionSet(env);

    expect(loaded).toHaveLength(1);
  });

  it("fails to load when its build isn't stored", async () => {
    const { env } = fakeEnv({});

    await expect(readDefinitionSet(env)).rejects.toThrow(ARCHIVE_KEY);
  });
});

describe("a revision's outbound requests, through its gateway", () => {
  /** The gateway the loaded revision sends its outbound requests to. */
  async function gatewayOf() {
    const { env, loaded } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });
    await readDefinitionSet(env);
    return loaded[0]!.code.globalOutbound!;
  }

  /** The internet, which records each request reaching it. */
  function internet() {
    const reached: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
      reached.push(new Request(input, init));
      return new Response("reached");
    });
    return reached;
  }

  it("reach the Camox API in the revision's draft, whichever draft they name", async () => {
    const gateway = await gatewayOf();
    const reached = internet();

    const response = await gateway.fetch(
      new Request(`${API_URL}/rpc/pages/list`, {
        method: "POST",
        headers: { "x-camox-draft": "another-draft", cookie: "camox_auth=session" },
        body: "{}",
      }),
    );

    expect(await response.text()).toBe("reached");
    expect(reached).toHaveLength(1);
    expect(reached[0]!.url).toBe(`${API_URL}/rpc/pages/list`);
    expect(reached[0]!.headers.get("x-camox-draft")).toBe(DRAFT);
    expect(reached[0]!.headers.get("cookie")).toBe("camox_auth=session");
    expect(await reached[0]!.text()).toBe("{}");
  });

  it("reach any other host as they were sent", async () => {
    const gateway = await gatewayOf();
    const reached = internet();

    await gateway.fetch(
      new Request("https://weather.example.com/today", {
        headers: { "x-camox-draft": "another-draft" },
      }),
    );

    expect(reached.map((request) => request.url)).toEqual(["https://weather.example.com/today"]);
    expect(reached[0]!.headers.get("x-camox-draft")).toBe("another-draft");
  });
});
