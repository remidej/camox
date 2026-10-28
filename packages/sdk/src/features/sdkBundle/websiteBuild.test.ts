import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { type Logger, type Plugin, createBuilder, createLogger, parseSync } from "vite-plus";

import { HOSTED_BUILD_ENV } from "../vite/hostedChecks";
import { camox } from "../vite/vite";
import { addSdkBundleToBuild } from "./localSdkBundle";
import {
  SDK_BUNDLE_BUILD_MANIFEST,
  type SdkBundleSettings,
  sdkBundleEntryFile,
  sdkBundleMissingIn,
  sdkBundleName,
} from "./sdkBundleName";

// Builds a copy of the Template with the SDK Bundle switch on, as `vite build` and `camox release`
// do, with Camox's plugin from this package's source.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const templateRoot = join(repoRoot, "apps/template-default");
const PROJECT_ID = "01a15fff-627c-7e88-83cd-ceb11f804d47";
const CONFIG_GLOBAL = "__camoxSdkBundleTestPlugins";

/** What the copy's `camox()` compiles in: the production API, no icons. */
const settings: SdkBundleSettings = {
  iconIds: [],
  telemetryDisabled: false,
  experimentalFeatures: false,
  apiUrl: "https://api.camox.ai",
};

/** The Template's SDK Bundle names, from the monorepo's lockfile. */
async function templateNames() {
  const lockfile = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const name = (target: "browser" | "workerd") =>
    sdkBundleName({ lockfile, importer: "apps/template-default", target, settings });
  return { browser: await name("browser"), workerd: await name("workerd") };
}

/**
 * A copy of the Template where the monorepo has it, beside a copy of the monorepo's lockfile, so
 * its SDK Bundle is named as the Template's.
 */
async function copyTemplate(temp: string): Promise<string> {
  await cp(join(repoRoot, "pnpm-lock.yaml"), join(temp, "pnpm-lock.yaml"));
  const root = join(temp, "apps/template-default");
  await mkdir(root, { recursive: true });
  for (const file of ["src", "tsconfig.json", "package.json", "wrangler.jsonc"])
    await cp(join(templateRoot, file), join(root, file), { recursive: true });
  await symlink(join(templateRoot, "node_modules"), join(root, "node_modules"), "dir");
  await writeFile(
    join(root, "vite.config.mjs"),
    `import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default {
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), cloudflare(), ...globalThis.${CONFIG_GLOBAL}(), react({ compiler: true })],
};
`,
  );
  return root;
}

interface TemplateBuild {
  /** Every module each environment's output holds, by environment. */
  modules: Map<string, string[]>;
  /** What the build logged. */
  log: string;
  clientDir: string;
  workerDir: string;
}

/** Builds the copy in `root` with `env` set, where `undefined` unsets a variable. */
async function buildTemplate(
  root: string,
  env: Record<string, string | undefined>,
): Promise<TemplateBuild> {
  const modules = new Map<string, string[]>();
  const probe: Plugin = {
    name: "probe",
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((file) =>
        file.type === "chunk" ? Object.keys(file.modules) : [],
      );
      modules.set(this.environment.name, [...(modules.get(this.environment.name) ?? []), ...ids]);
    },
  };
  let log = "";
  const logger: Logger = { ...createLogger("info"), info: (message) => void (log += message) };
  (globalThis as Record<string, unknown>)[CONFIG_GLOBAL] = () => [
    camox({ projectId: PROJECT_ID }),
    probe,
  ];
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  const set = (vars: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  set(env);
  try {
    await rm(join(root, "dist"), { recursive: true, force: true });
    const builder = await createBuilder({
      configFile: join(root, "vite.config.mjs"),
      root,
      customLogger: logger,
    });
    await builder.buildApp();
  } finally {
    set(previous);
  }
  const deploy = JSON.parse(await readFile(join(root, ".wrangler/deploy/config.json"), "utf8")) as {
    configPath: string;
  };
  const workerDir = dirname(resolve(root, ".wrangler/deploy", deploy.configPath));
  return { modules, log, clientDir: join(root, "dist/client"), workerDir };
}

/** The specifiers a module imports, statically or with a literal `import()`. */
function importsOf(file: string, code: string): string[] {
  const { module } = parseSync(file, code);
  const specifiers = [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) =>
      entry.entries.flatMap((exported) =>
        exported.moduleRequest ? [exported.moduleRequest.value] : [],
      ),
    ),
  ];
  for (const { moduleRequest } of module.dynamicImports) {
    const literal = /^["'`]([^"'`]*)["'`]$/.exec(
      code.slice(moduleRequest.start, moduleRequest.end),
    );
    if (literal) specifiers.push(literal[1]!);
  }
  return specifiers;
}

/** Each JavaScript module under `dir` and what it imports, by its path from `dir`. */
async function importsUnder(dir: string): Promise<Map<string, string[]>> {
  const imports = new Map<string, string[]>();
  for (const file of await readdir(dir, { recursive: true })) {
    if (!/\.m?js$/.test(file) || file.startsWith("_camox/")) continue;
    imports.set(file, importsOf(file, await readFile(join(dir, file), "utf8")));
  }
  return imports;
}

void describe("a website built against its SDK Bundle", () => {
  let temp: string;
  let root: string;
  let cache: string;
  let names: { browser: string; workerd: string };
  let first: TemplateBuild;
  let second: TemplateBuild;
  const switchOn = () => ({
    CAMOX_INTERNAL_SDK_BUNDLE: "1",
    CAMOX_INTERNAL_SDK_BUNDLE_CACHE: cache,
    CAMOX_INTERNAL_RELEASE: undefined,
    [HOSTED_BUILD_ENV]: undefined,
  });

  before(async () => {
    temp = await mkdtemp(join(tmpdir(), "camox-website-build-"));
    root = await copyTemplate(temp);
    cache = join(temp, "cache");
    names = await templateNames();
    first = await buildTemplate(root, switchOn());
    second = await buildTemplate(root, switchOn());
  });
  after(() => rm(temp, { recursive: true, force: true }));

  void test("names its SDK Bundle in the server build's output", async () => {
    const manifest = JSON.parse(
      await readFile(join(second.workerDir, SDK_BUNDLE_BUILD_MANIFEST), "utf8"),
    ) as unknown;
    assert.deepEqual(manifest, names);
  });

  void test("holds no camox or React code, only the website's own", () => {
    const sdkSource = join(repoRoot, "packages/sdk/src/");
    // The Worker entry is compiled into each website's build: it imports the website's modules.
    const workerEntry = join(sdkSource, "features/runtime/worker.ts");
    for (const [environment, ids] of second.modules) {
      for (const id of ids) {
        assert.doesNotMatch(
          id,
          /[/\\]node_modules[/\\](\.pnpm[/\\])?(react|react-dom|scheduler|camox|@tanstack\+?[/\\]?react-query)[@/\\]/,
          `${environment} holds ${id}`,
        );
        if (id !== workerEntry)
          assert.ok(!id.startsWith(sdkSource), `${environment} holds camox's ${id}`);
      }
    }
  });

  void test("imports the SDK Bundle by absolute path under its prefix in the browser", async () => {
    const prefix = `/_camox/sdk/${names.browser}/`;
    const bundleImports = new Set<string>();
    for (const [file, specifiers] of await importsUnder(second.clientDir)) {
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) {
          assert.ok(existsSync(join(second.clientDir, dirname(file), specifier)), specifier);
          continue;
        }
        assert.ok(specifier.startsWith(prefix), `${file} imports ${specifier}`);
        bundleImports.add(specifier.slice(prefix.length));
      }
    }
    assert.ok(bundleImports.has(sdkBundleEntryFile("react")), [...bundleImports].join(", "));
    assert.ok(bundleImports.has(sdkBundleEntryFile("camox/_internal/pageClient")));
  });

  void test("imports the SDK Bundle's modules by path in workerd", async () => {
    const prefix = `_camox/sdk/${names.workerd}/`;
    const bundleImports = new Set<string>();
    for (const [file, specifiers] of await importsUnder(second.workerDir)) {
      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          assert.match(specifier, /^(node|cloudflare):/, `${file} imports ${specifier}`);
          continue;
        }
        const target = posix.join(posix.dirname(file), specifier);
        if (target.startsWith(prefix)) bundleImports.add(target.slice(prefix.length));
        else assert.ok(existsSync(join(second.workerDir, target)), `${file} imports ${specifier}`);
      }
    }
    assert.ok(bundleImports.has(sdkBundleEntryFile("camox/_internal/runtime")));
    assert.ok(bundleImports.has(sdkBundleEntryFile("camox/_internal/workerRuntime")));
  });

  void test("builds a missing SDK Bundle into its cache, and reuses it on the next build", () => {
    assert.match(first.log, /Built the SDK Bundle/);
    assert.doesNotMatch(second.log, /Built the SDK Bundle/);
  });

  void test("a release adds the SDK Bundle's files and modules beside the build's", async () => {
    await addSdkBundleToBuild({ root, env: { CAMOX_INTERNAL_SDK_BUNDLE_CACHE: cache } });
    assert.ok(
      existsSync(join(second.clientDir, "_camox/sdk", names.browser, sdkBundleEntryFile("react"))),
    );
    assert.ok(
      existsSync(
        join(
          second.workerDir,
          "_camox/sdk",
          names.workerd,
          sdkBundleEntryFile("camox/_internal/runtime"),
        ),
      ),
    );
  });

  void test("a hosted release whose SDK Bundle is missing fails with the missing-bundle error", async () => {
    const empty = join(temp, "empty-cache");
    const failure = await buildTemplate(root, {
      ...switchOn(),
      CAMOX_INTERNAL_SDK_BUNDLE_CACHE: empty,
      CAMOX_INTERNAL_RELEASE: "dry-run",
      [HOSTED_BUILD_ENV]: "1",
    }).then(
      () => assert.fail("the build passed"),
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    assert.deepEqual(sdkBundleMissingIn(`vp build\n${failure}\n`), names);
    assert.equal(existsSync(empty) && (await readdir(empty)).length > 0, false);
  });

  void test("with the switch off, builds the whole app and names no SDK Bundle", async () => {
    const whole = await buildTemplate(root, { ...switchOn(), CAMOX_INTERNAL_SDK_BUNDLE: "0" });
    assert.equal(existsSync(join(whole.workerDir, SDK_BUNDLE_BUILD_MANIFEST)), false);
    const reactModules = [...whole.modules.values()]
      .flat()
      .filter((id) => /node_modules[/\\](\.pnpm[/\\])?react-dom[@/\\]/.test(id));
    assert.ok(reactModules.length > 0);
  });
});
