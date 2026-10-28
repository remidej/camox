import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { onTestFinished } from "vite-plus/test";

import { CamoxGateway, type Env } from "../src/worker";

// Dispatch's bindings as the tests fake them, and a revision's build as the revision sandbox
// archives it.

export const PROJECT = "5f0c8f6e-2d3b-4a7e-9c1d-0b8e6a4f2c11";
export const DRAFT = "0195f2a4-7a6b-7c3d-8e9f-0a1b2c3d4e5f";
export const REVISION = "0195f2a4-9b8c-7d6e-8f00-112233445566";
export const API_URL = "https://api.camox.test";
export const ARCHIVE_KEY = `${PROJECT}/${DRAFT}/${REVISION}.tar.gz`;
export const revision = {
  project: PROJECT,
  draft: DRAFT,
  revision: REVISION,
  archiveKey: ARCHIVE_KEY,
};

/** The website's Definition Set, as its build's entrypoint gives it. */
export const definitionSet = (stylesheetsUnder: string) => ({
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

export const PRICING_CSS = ".pricing { color: teal }\n";

/**
 * The files of a revision's `dist/`, as `vp build` leaves them: the client assets, and the server
 * build's directory with its `wrangler.json`. The server bundle reads the asset prefix as it
 * loads, as the SDK's does, exposes the Definition Set by its entrypoint's name, and answers
 * every request with what it was asked, under that prefix.
 */
export const BUILD: Record<string, string> = {
  "dist/client/assets/pricing.css": PRICING_CSS,
  "dist/client/assets/renderer-B1x9.js": `console.log("renderer");\n`,
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
export default {
  fetch(request) {
    const url = new URL(request.url);
    return new Response("The revision under " + prefix + " at " + url.pathname + url.search);
  },
};
`,
  [`dist/acme_website/${LONG_CHUNK}`]: `export const definitionSet = ${definitionSet.toString()};\n`,
};

/** `files` archived the way the revision sandbox does: `tar -czf <archive> dist`. */
export async function archived(files: Record<string, string>) {
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
 * main module exports under that name, or its default export's `fetch` for the default
 * entrypoint. It loads each name once, as Cloudflare caches it.
 */
export function fakeLoader() {
  const loaded: LoadedWorker[] = [];
  const fetched: string[] = [];
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
        getEntrypoint: (entrypoint?: string) =>
          entrypoint === undefined
            ? {
                fetch: async (request: Request) => {
                  fetched.push(`${name} ${new URL(request.url).pathname}`);
                  const main = (await worker).default as {
                    fetch(request: Request): Promise<Response>;
                  };
                  return main.fetch(request);
                },
              }
            : new Proxy(
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
  return { loaded, fetched, binding: binding as unknown as WorkerLoader };
}

/** An R2 bucket in memory, by key, with each object's content type, recording what it was asked. */
export function fakeBucket(initial: Record<string, Uint8Array> = {}) {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>(
    Object.entries(initial).map(([key, body]) => [key, { body }]),
  );
  const gets: string[] = [];
  const bucket = {
    get: async (key: string, options?: { range?: { offset: number; length: number } }) => {
      gets.push(key);
      const object = objects.get(key);
      if (!object) return null;
      const { offset = 0, length = object.body.byteLength - offset } = options?.range ?? {};
      const body = object.body.slice(offset, offset + length);
      return {
        body: new Response(body).body,
        json: async () => JSON.parse(new TextDecoder().decode(body)),
        httpMetadata: { contentType: object.contentType },
        httpEtag: `"${key.length}"`,
      };
    },
    head: async (key: string) => (objects.has(key) ? { key } : null),
    put: async (
      key: string,
      value: Uint8Array | string,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
      objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
    },
  };
  return { objects, gets, bucket: bucket as unknown as R2Bucket };
}

/**
 * What `ctx.exports` gives dispatch's own entrypoints: a gateway is the real `CamoxGateway`,
 * given the `props` it was made with.
 */
export function context(env: Env, props: unknown = {}): ExecutionContext {
  const exports = {
    CamoxGateway: ({ props }: { props: unknown }) => {
      const gateway = new CamoxGateway(context(env, props), env);
      return { fetch: (request: Request) => gateway.fetch(request) };
    },
  };
  return {
    props,
    exports,
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

/** The SDK Bundle a bundled build names (ADR 0029), one name per target. */
export const SDK_BUNDLE = {
  browser: "0123456789abcdef0123456789abcdef",
  workerd: "fedcba9876543210fedcba9876543210",
};
export const SDK_BUNDLE_ARCHIVE_KEYS = {
  browser: `sdk/${SDK_BUNDLE.browser}.tar.gz`,
  workerd: `sdk/${SDK_BUNDLE.workerd}.tar.gz`,
};

/** The SDK Bundle's workerd half, as `buildSdkBundle` leaves its folder. */
export const WORKERD_SDK_BUNDLE: Record<string, string> = {
  "entry.mjs": `export { greeting } from "./chunks/greeting.mjs";\n`,
  "chunks/greeting.mjs": `export const greeting = "rendered by the SDK Bundle";\n`,
  "sdk-bundle.json": JSON.stringify({ name: SDK_BUNDLE.workerd, target: "workerd" }),
};

export const STUDIO_CSS = ".camox-studio { color: plum }\n";

/** The SDK Bundle's browser half. */
export const BROWSER_SDK_BUNDLE: Record<string, string> = {
  "entry.mjs": `export const camox = "in the browser";\n`,
  "camox-studio-Q2x8.css": STUDIO_CSS,
  "sdk-bundle.json": JSON.stringify({ name: SDK_BUNDLE.browser, target: "browser" }),
};

/**
 * A build against `SDK_BUNDLE`, as `vp build` leaves it with the switch on: its server build
 * names the bundle beside its `wrangler.json`, and imports the bundle's workerd entry from the
 * root of its folder.
 */
export const BUNDLED_BUILD: Record<string, string> = {
  ...BUILD,
  "dist/acme_website/camox-sdk-bundle.json": JSON.stringify(SDK_BUNDLE),
  "dist/acme_website/index.js": BUILD["dist/acme_website/index.js"]!.replace(
    `const prefix`,
    `import { greeting } from "./_camox/sdk/${SDK_BUNDLE.workerd}/entry.mjs";\nconst prefix`,
  ).replace(`"The revision under "`, `greeting + ": the revision under "`),
};

/** A target's folder of an SDK Bundle archived as ensuring it stores it: `tar -czf … -C <dir> .`. */
export async function archivedSdkBundle(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "camox-sdk-bundle-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "out"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, "out", path)), { recursive: true });
    await writeFile(join(dir, "out", path), content);
  }
  await promisify(execFile)("tar", ["-czf", "bundle.tar.gz", "-C", "out", "."], { cwd: dir });
  return new Uint8Array(await readFile(join(dir, "bundle.tar.gz")));
}
