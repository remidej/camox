import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, resolve as resolvePath } from "node:path";

import { SDK_BUNDLE_MANIFEST, type SdkBundleManifest } from "../sdkBundle/buildSdkBundle";
import { buildsAgainstSdkBundle, ensureLocalSdkBundle } from "../sdkBundle/localSdkBundle";
import {
  SDK_BUNDLE_BUILD_MANIFEST,
  type SdkBundleNames,
  type SdkBundleSettings,
  type SdkBundleTarget,
  sdkBundleEntryFile,
  sdkBundlePath,
} from "../sdkBundle/sdkBundleName";

/** What `camox()` needs while a website builds against its SDK Bundle. */
export interface SdkBundleBuildState {
  names: SdkBundleNames;
  /** Whether this build built the bundle into its cache. */
  built: boolean;
  /** The Studio stylesheet's URL, in the browser bundle. */
  studioStylesheetUrl: string;
  /** The file the server build names its SDK Bundle in. */
  manifest: { fileName: string; source: string };
  /**
   * Where an import the bundle holds points in the output of an environment for `consumer`, or
   * undefined for the website's own imports: a bare specifier, or a relative import of a file the
   * bundle holds by path, like lucide's icon helper from the website's icons. The browser imports
   * it by absolute URL under the bundle's prefix. workerd resolves a bare specifier from the importing module's folder, so the Worker imports
   * the bundle's modules by path, from `_camox/sdk/<name>/` beside its own: see
   * `relativizeWorkerImports`.
   */
  resolve(
    id: string,
    importer: string | undefined,
    consumer: "client" | "server",
  ): { id: string; external: "absolute" } | undefined;
  /** A Worker chunk with its imports of the bundle made relative to the chunk's folder. */
  relativizeWorkerImports(code: string, fileName: string): string | undefined;
}

/**
 * The SDK Bundle a build builds against, from the local cache, or undefined when the switch is
 * off and the build is whole-app.
 */
export async function sdkBundleBuildState({
  root,
  settings,
  mayBuild,
}: {
  root: string;
  settings: SdkBundleSettings;
  mayBuild: boolean;
}): Promise<SdkBundleBuildState | undefined> {
  if (!buildsAgainstSdkBundle()) return;
  let built = false;
  const bundle = await ensureLocalSdkBundle({
    root,
    settings,
    mayBuild,
    onBuild: () => {
      built = true;
    },
  });
  const names = { browser: bundle.browser.name, workerd: bundle.workerd.name };
  const stylesheet = readdirSync(bundle.browser.dir).find((file) =>
    /^camox-studio-.*\.css$/.test(file),
  );
  if (!stylesheet)
    throw new Error(`Camox: the SDK Bundle ${names.browser} has no Studio stylesheet.`);
  const websiteRequire = createRequire(join(root, "package.json"));
  /** What each target holds: its entry files by specifier, and by the file a path specifier names. */
  const held = (dir: string) => {
    const { entries } = JSON.parse(
      readFileSync(join(dir, SDK_BUNDLE_MANIFEST), "utf8"),
    ) as SdkBundleManifest;
    const byFile = new Map<string, string>();
    for (const specifier of Object.keys(entries)) {
      if (/\.[cm]?js$/.test(specifier))
        byFile.set(websiteRequire.resolve(specifier), sdkBundleEntryFile(specifier));
    }
    return { entries, byFile };
  };
  const holds: Record<SdkBundleTarget, ReturnType<typeof held>> = {
    browser: held(bundle.browser.dir),
    workerd: held(bundle.workerd.dir),
  };
  return {
    names,
    built,
    studioStylesheetUrl: sdkBundlePath(names.browser) + stylesheet,
    manifest: { fileName: SDK_BUNDLE_BUILD_MANIFEST, source: `${JSON.stringify(names)}\n` },
    resolve(id, importer, consumer) {
      const target: SdkBundleTarget = consumer === "client" ? "browser" : "workerd";
      const { entries, byFile } = holds[target];
      const file = Object.hasOwn(entries, id)
        ? entries[id]
        : id.startsWith(".") && importer
          ? byFile.get(resolvePath(dirname(importer), id))
          : undefined;
      if (!file) return;
      // As is, even when the import was relative: the bundle is under its own prefix.
      return { id: sdkBundlePath(names[target]) + file, external: "absolute" };
    },
    relativizeWorkerImports(code, fileName) {
      const prefix = sdkBundlePath(names.workerd);
      if (!code.includes(prefix)) return;
      const toRoot = posix.relative(posix.dirname(fileName), "") || ".";
      return code.replaceAll(
        new RegExp(`(["'\`])${prefix.replaceAll("/", "\\/")}`, "g"),
        `$1${toRoot}${prefix}`,
      );
    },
  };
}
