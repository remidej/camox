import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { createBuilder, preview } from "vite-plus";

import { ASSET_PREFIX_GLOBAL } from "../runtime/assetPrefix";
import { DEFINITION_SET_ENTRYPOINT } from "../runtime/definitionSetEntrypoint";
import { camox } from "./vite";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = join(sdkRoot, "test/fixture-app");

export const FIXTURE_PROJECT_ID = "01a15fff-627b-7fa1-938b-93ab659c1acc";

/** A running copy of the built Worker. */
export interface ServedBuild {
  url: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface FixtureBuild {
  root: string;
  /** What Workers Static Assets serves: the client build and the app's public files. */
  clientDir: string;
  /**
   * Runs the built Worker in workerd, as Cloudflare does. With `assetPrefix`, an entry module sets
   * the prefix before the build's server bundle loads, as a revision's loader does.
   */
  serve(options?: { assetPrefix?: string }): Promise<ServedBuild>;
  /** The Definition Set the built server's entrypoint returns, called as a revision's loader does. */
  readDefinitionSet(): Promise<unknown>;
  cleanup(): Promise<void>;
}

/**
 * Copies the fixture app (`packages/sdk/test/fixture-app`) to a temp directory, with `files`
 * written over it, and builds it for real as a dry-run release: what a project's build runs
 * without syncing Live. Camox's plugin comes from this package's source.
 */
export async function buildFixtureApp({
  apiUrl,
  files = {},
}: {
  /** The Camox API the build talks to. */
  apiUrl: string;
  /** Files to add or replace, by path from the app's root. */
  files?: Record<string, string>;
}): Promise<FixtureBuild> {
  const temp = await mkdtemp(join(tmpdir(), "camox-fixture-"));
  const root = join(temp, "app");
  const cleanup = () => rm(temp, { recursive: true, force: true });
  try {
    await cp(fixtureRoot, root, { recursive: true });
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    await linkDependencies(root);
    await withEnv({ CAMOX_INTERNAL_RELEASE: "dry-run" }, async () => {
      const builder = await createBuilder({
        configFile: false,
        root,
        logLevel: "silent",
        // Emit the fixture's tiny font as a file, as a real one would be.
        build: { assetsInlineLimit: 0 },
        plugins: [
          cloudflare(),
          camox({
            projectId: FIXTURE_PROJECT_ID,
            _internal: { apiUrl, authenticationUrl: apiUrl },
          }),
        ],
      });
      await builder.buildApp();
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  // Where the Cloudflare plugin points wrangler at the built Worker's config.
  const deployConfigDir = join(root, ".wrangler/deploy");
  const deployConfig = JSON.parse(await readFile(join(deployConfigDir, "config.json"), "utf8")) as {
    configPath: string;
  };
  const wranglerPath = resolve(deployConfigDir, deployConfig.configPath);
  const workerDir = dirname(wranglerPath);
  const wrangler = JSON.parse(await readFile(wranglerPath, "utf8")) as { main: string };
  return {
    root,
    clientDir: join(root, "dist/client"),
    serve: ({ assetPrefix } = {}) =>
      serveBuild(root, workerDir, wranglerPath, wrangler, assetPrefix),
    async readDefinitionSet() {
      // The probe's own route calls the entrypoint over RPC, as the revision's loader does.
      const build = `./${wrangler.main}`;
      await writeFile(
        join(workerDir, "definition-set-probe.js"),
        `import worker from ${JSON.stringify(build)};
export * from ${JSON.stringify(build)};

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname !== "/__probe/definition-set") return worker.fetch(request, env, ctx);
    return Response.json(await ctx.exports[${JSON.stringify(DEFINITION_SET_ENTRYPOINT)}].read());
  },
};
`,
      );
      const served = await serveBuild(root, workerDir, wranglerPath, {
        ...wrangler,
        main: "definition-set-probe.js",
      });
      try {
        const response = await served.fetch("/__probe/definition-set");
        const body = await response.text();
        if (!response.ok) throw new Error(`Reading the Definition Set failed: ${body}`);
        return JSON.parse(body) as unknown;
      } finally {
        await served.close();
      }
    },
    cleanup,
  };
}

/** Runs a build's Worker, from the module `wrangler.main` names, in workerd. */
async function serveBuild(
  root: string,
  workerDir: string,
  wranglerPath: string,
  wrangler: { main: string },
  assetPrefix?: string,
): Promise<ServedBuild> {
  let main = wrangler.main;
  if (assetPrefix !== undefined) {
    // A module of its own: imports run before the importing module's body.
    await writeFile(
      join(workerDir, "set-asset-prefix.js"),
      `globalThis.${ASSET_PREFIX_GLOBAL} = ${JSON.stringify(assetPrefix)};\n`,
    );
    const build = JSON.stringify(`./${wrangler.main}`);
    await writeFile(
      join(workerDir, "prefixed-entry.js"),
      `import "./set-asset-prefix.js";\nexport * from ${build};\nexport { default } from ${build};\n`,
    );
    main = "prefixed-entry.js";
  }
  await writeFile(wranglerPath, JSON.stringify({ ...wrangler, main }));
  const server = await preview({
    configFile: false,
    root,
    logLevel: "silent",
    // No inspector: its fixed port would collide with a Worker served in parallel.
    plugins: [cloudflare({ inspectorPort: false })],
    preview: { host: "127.0.0.1", port: 0 },
  });
  const url = server.resolvedUrls!.local[0]!;
  return {
    url,
    fetch: (path, init) => fetch(new URL(path, url), init),
    close: () => server.close(),
  };
}

/**
 * The app's own `node_modules`, linking this package's dependencies and `camox` itself, so Vite's
 * caches and Camox's sidecar land in the copy.
 */
async function linkDependencies(root: string) {
  const modules = join(root, "node_modules");
  const sdkModules = join(sdkRoot, "node_modules");
  await mkdir(modules);
  await symlink(sdkRoot, join(modules, "camox"), "dir");
  for (const entry of await readdir(sdkModules)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      await mkdir(join(modules, entry));
      for (const scoped of await readdir(join(sdkModules, entry)))
        await symlink(join(sdkModules, entry, scoped), join(modules, entry, scoped), "dir");
    } else {
      await symlink(join(sdkModules, entry), join(modules, entry), "dir");
    }
  }
}

async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
