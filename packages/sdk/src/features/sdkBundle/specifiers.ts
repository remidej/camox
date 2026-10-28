/**
 * What an SDK Bundle holds: the bare specifiers a website's build leaves to it. The SDK owns this
 * list, so an SDK release can change it. Each specifier gets one entry in each target it's for.
 */

/** Who loads an SDK Bundle's version: visitors' browsers, or the Worker in workerd. */
export type SdkBundleTarget = "browser" | "workerd";

export const SDK_BUNDLE_TARGETS: readonly SdkBundleTarget[] = ["browser", "workerd"];

interface SdkBundleSpecifier {
  specifier: string;
  /** The one target that holds it, when not both. */
  only?: SdkBundleTarget;
}

const SPECIFIERS: readonly SdkBundleSpecifier[] = [
  // Camox's public entry points.
  { specifier: "camox/createCollection" },
  { specifier: "camox/dom" },
  { specifier: "camox/createApp" },
  { specifier: "camox/createBlock" },
  { specifier: "camox/createLayout" },
  { specifier: "camox/document" },
  { specifier: "camox/CamoxPreview" },
  { specifier: "camox/CamoxContent" },
  { specifier: "camox/CamoxProvider" },
  { specifier: "camox/CamoxStudio" },
  { specifier: "camox/navigation" },
  // The entry points the website's generated modules import.
  { specifier: "camox/_internal/pageClient", only: "browser" },
  { specifier: "camox/_internal/studioClient", only: "browser" },
  { specifier: "camox/_internal/rendererClient", only: "browser" },
  { specifier: "camox/_internal/pageServer", only: "workerd" },
  { specifier: "camox/_internal/studioServer", only: "workerd" },
  { specifier: "camox/_internal/runtime", only: "workerd" },
  { specifier: "camox/_internal/imageResponse", only: "workerd" },
  // React, React DOM and TanStack Query: one copy for camox and the website.
  { specifier: "react" },
  { specifier: "react/jsx-runtime" },
  { specifier: "react/compiler-runtime" },
  { specifier: "react-dom" },
  { specifier: "react-dom/client", only: "browser" },
  { specifier: "react-dom/server", only: "workerd" },
  { specifier: "@tanstack/react-query" },
];

/** The bare specifiers an SDK Bundle's `target` version holds, each with an entry of its own. */
export function sdkBundleSpecifiers(target: SdkBundleTarget): string[] {
  return SPECIFIERS.filter(({ only }) => !only || only === target).map(
    ({ specifier }) => specifier,
  );
}

/** The npm package a bare specifier imports from: `@tanstack/react-query` for itself. */
export function packageOfSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/**
 * The file a specifier's entry is, in its target's folder: `react/jsx-runtime` is
 * `react~jsx-runtime.mjs`. Every entry sits at the folder's root, so the website's build can point
 * at it from the bundle's name alone.
 */
export function sdkBundleEntryFile(specifier: string): string {
  return `${specifier.replaceAll("/", "~")}.mjs`;
}
