/**
 * Builds a website's SDK Bundle: Camox, React and what they reach, once for the browser and once
 * for workerd, from the packages the website installed. Runs in Node, from the website's folder.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { type InlineConfig, type Plugin, type Rolldown, build } from "vite-plus";

import {
  SDK_BUNDLE_BUILDER_VERSION,
  type SdkBundleSettings,
  sdkBundleName,
  sdkBundlePath,
  sdkBundleSpecifiersFor,
} from "./sdkBundleName";
import {
  SDK_BUNDLE_TARGETS,
  type SdkBundleTarget,
  loadsAtFirstPaint,
  sdkBundleEntryFile,
} from "./specifiers";

/** The manifest each target's folder holds, beside its files. */
export const SDK_BUNDLE_MANIFEST = "sdk-bundle.json";

export interface SdkBundleManifest {
  name: string;
  target: SdkBundleTarget;
  builderVersion: string;
  /** Each specifier's entry file, from the folder. */
  entries: Record<string, string>;
}

/** One target's version of a built SDK Bundle. */
export interface BuiltSdkBundle {
  name: string;
  /** Its files, every one at the root: entries, chunks and assets. */
  dir: string;
}

export type SdkBundleBuild = Record<SdkBundleTarget, BuiltSdkBundle>;

/** The lockfile a website installed from, and the website's importer in it. */
export async function readSdkBundleLockfile(
  root: string,
): Promise<{ lockfile: string; importer: string }> {
  const website = resolve(root);
  for (let dir = website; ; dir = dirname(dir)) {
    const file = join(dir, "pnpm-lock.yaml");
    if (existsSync(file)) {
      const importer = relative(dir, website).split(sep).join("/") || ".";
      return { lockfile: await readFile(file, "utf8"), importer };
    }
    if (dirname(dir) === dir)
      throw new Error(`Camox: no pnpm-lock.yaml in ${website} or any folder above it.`);
  }
}

/** The names of the website's SDK Bundle, per target, from its lockfile and settings. */
export async function sdkBundleNamesFor({
  root,
  settings,
}: {
  root: string;
  settings: SdkBundleSettings;
}): Promise<Record<SdkBundleTarget, string>> {
  const { lockfile, importer } = await readSdkBundleLockfile(root);
  const [browser, workerd] = await Promise.all(
    SDK_BUNDLE_TARGETS.map((target) => sdkBundleName({ lockfile, importer, target, settings })),
  );
  return { browser: browser!, workerd: workerd! };
}

/**
 * Builds the SDK Bundle of the website in `root`, with its installed packages, into
 * `<outDir>/browser` and `<outDir>/workerd`. Each folder is served or loaded as is, under its own
 * name's path.
 */
export async function buildSdkBundle({
  root,
  outDir,
  settings,
}: {
  root: string;
  outDir: string;
  settings: SdkBundleSettings;
}): Promise<SdkBundleBuild> {
  const names = await sdkBundleNamesFor({ root, settings });
  const { lockfile, importer } = await readSdkBundleLockfile(root);
  const result = {} as SdkBundleBuild;
  for (const target of SDK_BUNDLE_TARGETS) {
    const dir = join(outDir, target);
    const specifiers = sdkBundleSpecifiersFor({ lockfile, importer, target });
    const entries = await buildTarget({
      root: resolve(root),
      dir,
      target,
      specifiers,
      names,
      settings,
    });
    const manifest: SdkBundleManifest = {
      name: names[target],
      target,
      builderVersion: SDK_BUNDLE_BUILDER_VERSION,
      entries,
    };
    await writeFile(join(dir, SDK_BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    result[target] = { name: names[target], dir };
  }
  return result;
}

const ENTRY_PREFIX = "\0camox-sdk-bundle-entry:";
const VIRTUAL_STUDIO_CSS = "virtual:camox-studio-css";
const VIRTUAL_OVERLAY_CSS = "virtual:camox-overlay-css";

/** The conditions the Cloudflare plugin resolves the Worker's packages with. */
const WORKERD_CONDITIONS = ["workerd", "worker", "module", "browser", "production"];

async function buildTarget({
  root,
  dir,
  target,
  specifiers,
  names,
  settings,
}: {
  root: string;
  dir: string;
  target: SdkBundleTarget;
  specifiers: string[];
  names: Record<SdkBundleTarget, string>;
  settings: SdkBundleSettings;
}): Promise<Record<string, string>> {
  const entryName = (specifier: string) => sdkBundleEntryFile(specifier).replace(/\.mjs$/, "");
  const workerd = target === "workerd";
  const config: InlineConfig = {
    configFile: false,
    root,
    mode: "production",
    logLevel: "warn",
    // The settings `camox()` compiles in: they're part of the bundle's name.
    define: {
      __CAMOX_ICON_IDS__: JSON.stringify(settings.iconIds),
      __CAMOX_TELEMETRY_DISABLED__: JSON.stringify(settings.telemetryDisabled),
      __CAMOX_API_URL__: JSON.stringify(settings.apiUrl),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    plugins: [
      entries(root),
      camoxStylesheets({ root, target, browserName: names.browser }),
      ...(workerd ? [wasmModules()] : []),
    ],
    resolve: {
      // The ESM build of tslib, as `camox()` resolves it.
      alias: [{ find: /^tslib$/, replacement: "tslib/tslib.es6.mjs" }],
      ...(workerd && { conditions: WORKERD_CONDITIONS }),
    },
    ...(workerd && {
      ssr: {
        noExternal: true,
        target: "webworker",
        resolve: { conditions: WORKERD_CONDITIONS, externalConditions: WORKERD_CONDITIONS },
      },
    }),
    build: {
      outDir: dir,
      emptyOutDir: true,
      ssr: workerd,
      // The Worker's WebAssembly modules are files of its own.
      emitAssets: true,
      target: workerd ? "esnext" : undefined,
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      // Size warnings are for a website's own chunks: a bundle holds whole packages.
      chunkSizeWarningLimit: Infinity,
      modulePreload: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: Object.fromEntries(
          specifiers.map((specifier) => [entryName(specifier), `${ENTRY_PREFIX}${specifier}`]),
        ),
        // Each entry exports exactly what its specifier does.
        preserveEntrySignatures: "strict",
        ...(workerd && {
          platform: "neutral",
          // workerd provides them, with `nodejs_compat` for Node's.
          external: [/^cloudflare:/, /^node:/],
        }),
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE" || log.code === "EVAL") return;
          handler(level, log);
        },
        output: {
          // Flat, so a module's relative imports are its only imports: workerd resolves any
          // other specifier from the importing module's folder.
          entryFileNames: "[name].mjs",
          chunkFileNames: (chunk) =>
            !workerd && FIRST_PAINT_CHUNKS.has(chunk.name) ? "[name]-[hash].mjs" : "c-[hash].mjs",
          assetFileNames: "[name]-[hash][extname]",
        },
      },
    },
  };
  if (!workerd) {
    const input = config.build!.rolldownOptions!.input as Record<string, string>;
    const pageInput = Object.fromEntries(
      specifiers
        .filter(loadsAtFirstPaint)
        .map((specifier) => [entryName(specifier), input[entryName(specifier)]!]),
    );
    // What a page loads at first paint goes in one `page` chunk, and React in a `react` one.
    const pageModules = await modulesLoadedStatically(config, pageInput);
    const output = config.build!.rolldownOptions!.output as Rolldown.OutputOptions;
    output.codeSplitting = {
      groups: [
        {
          name: "react",
          test: (id) => pageModules.has(id) && REACT_MODULE.test(id),
          priority: 2,
        },
        { name: "page", test: (id) => pageModules.has(id), priority: 1 },
      ],
    };
  }
  await build(config);
  return Object.fromEntries(
    specifiers.map((specifier) => [specifier, sdkBundleEntryFile(specifier)]),
  );
}

/**
 * The chunks a page loads at first paint, beside the entry files it imports: its code, React, and
 * the helpers Rolldown keeps in a chunk of their own.
 */
const FIRST_PAINT_CHUNKS = new Set(["page", "react", "rolldown-runtime"]);

const REACT_MODULE = /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/;

/**
 * The modules the browser loads when it imports `input`'s entries, without what they import
 * lazily: a first build of those entries alone, so what they import but never use is left out,
 * as their own build would.
 */
async function modulesLoadedStatically(
  config: InlineConfig,
  input: Record<string, string>,
): Promise<Set<string>> {
  const result = await build({
    ...config,
    build: {
      ...config.build,
      write: false,
      rolldownOptions: { ...config.build!.rolldownOptions, input },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = new Map<string, Rolldown.OutputChunk>();
  for (const { output } of outputs)
    for (const file of output) if (file.type === "chunk") chunks.set(file.fileName, file);
  const loaded = new Set<string>();
  const visit = (fileName: string) => {
    if (loaded.has(fileName)) return;
    loaded.add(fileName);
    for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
  };
  for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName);
  const modules = new Set<string>();
  for (const fileName of loaded) {
    for (const [id, module] of Object.entries(chunks.get(fileName)?.modules ?? {}))
      if (module.renderedLength > 0) modules.add(id);
  }
  return modules;
}

/** One entry per specifier, exporting what it exports, CommonJS packages included. */
function entries(root: string): Plugin {
  return {
    name: "camox:sdk-bundle-entries",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith(ENTRY_PREFIX)) return id;
    },
    async load(id) {
      if (!id.startsWith(ENTRY_PREFIX)) return;
      const specifier = id.slice(ENTRY_PREFIX.length);
      const resolved = await this.resolve(specifier, join(root, "package.json"));
      if (!resolved) this.error(`Camox: the website doesn't install ${specifier}.`);
      const imported = JSON.stringify(specifier);
      if (isCommonJs(resolved.id)) {
        // A CommonJS module has no static exports to re-export: name each one it sets.
        const names = Object.keys(createRequire(resolved.id)(resolved.id) as object).filter(
          (name) => name !== "default" && name !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(name),
        );
        return [
          `import * as module from ${imported};`,
          "const exports = module.default ?? module;",
          "export default exports;",
          ...names.map((name) => `export const ${name} = exports.${name};`),
        ].join("\n");
      }
      const source = readFileSync(resolved.id, "utf8");
      const hasDefault = /\bexport\s+default\b|\bas\s+default\b/.test(source);
      return `export * from ${imported};\n${hasDefault ? `export { default } from ${imported};\n` : ""}`;
    },
  };
}

/** Whether Node would load `file` as CommonJS. */
function isCommonJs(file: string): boolean {
  const extension = extname(file);
  if (extension === ".cjs") return true;
  if (extension !== ".js") return false;
  for (let dir = dirname(file); dirname(dir) !== dir; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest))
      return (JSON.parse(readFileSync(manifest, "utf8")) as { type?: string }).type !== "module";
  }
  return true;
}

/**
 * The Studio's stylesheets, which camox's modules import as virtual modules. The browser finds
 * the Studio's from the module that asks, and the Worker from the browser bundle's path: the name
 * is known before building, so no prefix is read at runtime.
 */
function camoxStylesheets({
  root,
  target,
  browserName,
}: {
  root: string;
  target: SdkBundleTarget;
  browserName: string;
}): Plugin {
  // The camox the website installed, which this builder ships in.
  const studioCss = createRequire(join(root, "package.json")).resolve("camox/studio.css");
  const resolved = (id: string) => `\0${id}`;
  return {
    name: "camox:sdk-bundle-stylesheets",
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL_STUDIO_CSS || id === VIRTUAL_OVERLAY_CSS) return resolved(id);
    },
    load(id) {
      if (id === resolved(VIRTUAL_OVERLAY_CSS)) {
        const css = readFileSync(join(dirname(studioCss), "studio-overlays.css"), "utf8");
        return `export default ${JSON.stringify(css)};`;
      }
      if (id !== resolved(VIRTUAL_STUDIO_CSS)) return;
      const css = readFileSync(studioCss, "utf8");
      const fileName = `camox-studio-${createHash("sha256").update(css).digest("hex").slice(0, 8)}.css`;
      if (target === "browser") {
        this.emitFile({ type: "asset", fileName, source: css });
        return `export default new URL(/* @vite-ignore */ ${JSON.stringify(`./${fileName}`)}, import.meta.url).href;`;
      }
      return `export default ${JSON.stringify(sdkBundlePath(browserName) + fileName)};`;
    },
  };
}

/** WebAssembly the Worker imports, as modules of their own beside the bundle's. */
function wasmModules(): Plugin {
  return {
    name: "camox:sdk-bundle-wasm",
    enforce: "pre",
    async resolveId(id, importer) {
      if (!id.endsWith(".wasm")) return;
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (!resolved) return;
      const file = basename(resolved.id);
      this.emitFile({ type: "asset", fileName: file, source: await readFile(resolved.id) });
      return { id: `./${file}`, external: true };
    },
  };
}
