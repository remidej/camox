import { readdirSync } from "node:fs";
import { posix } from "node:path";

import { buildsAgainstSdkBundle, ensureLocalSdkBundle } from "../sdkBundle/localSdkBundle";
import {
  SDK_BUNDLE_BUILD_MANIFEST,
  type SdkBundleNames,
  type SdkBundleSettings,
  type SdkBundleTarget,
  sdkBundleEntryFile,
  sdkBundlePath,
  sdkBundleSpecifiers,
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
   * Where a bare specifier the bundle holds points in the output of an environment for `consumer`, or undefined for
   * the website's own imports. The browser imports it by absolute URL under the bundle's prefix.
   * workerd resolves a bare specifier from the importing module's folder, so the Worker imports
   * the bundle's modules by path, from `_camox/sdk/<name>/` beside its own: see
   * `relativizeWorkerImports`.
   */
  resolve(id: string, consumer: "client" | "server"): { id: string; external: true } | undefined;
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
  const specifiers: Record<SdkBundleTarget, Set<string>> = {
    browser: new Set(sdkBundleSpecifiers("browser")),
    workerd: new Set(sdkBundleSpecifiers("workerd")),
  };
  return {
    names,
    built,
    studioStylesheetUrl: sdkBundlePath(names.browser) + stylesheet,
    manifest: { fileName: SDK_BUNDLE_BUILD_MANIFEST, source: `${JSON.stringify(names)}\n` },
    resolve(id, consumer) {
      const target: SdkBundleTarget = consumer === "client" ? "browser" : "workerd";
      if (!specifiers[target].has(id)) return;
      return { id: sdkBundlePath(names[target]) + sdkBundleEntryFile(id), external: true };
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
