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
  /**
   * A package websites share with camox: the bundle holds it only when the website installs it,
   * so the website's copy and camox's are one.
   */
  shared?: true;
  /** Whether a page loads it at first paint: its code goes in the browser's `page` chunk. */
  page?: true;
}

/**
 * lucide's icon helper, which draws every icon. The website keeps its own icons, and they draw
 * with the bundle's helper: a website's icon module imports it by relative path, from inside the
 * package.
 */
export const LUCIDE_ICON_HELPER = "lucide-react/dist/esm/createLucideIcon.mjs";

const SPECIFIERS: readonly SdkBundleSpecifier[] = [
  // Camox's public entry points.
  { specifier: "camox/createCollection" },
  { specifier: "camox/dom" },
  { specifier: "camox/createApp", page: true },
  { specifier: "camox/createBlock", page: true },
  { specifier: "camox/createLayout", page: true },
  { specifier: "camox/document", page: true },
  { specifier: "camox/CamoxPreview" },
  { specifier: "camox/CamoxContent" },
  { specifier: "camox/CamoxProvider" },
  { specifier: "camox/CamoxStudio" },
  { specifier: "camox/navigation", page: true },
  // The entry points the website's generated modules import.
  { specifier: "camox/_internal/pageClient", only: "browser", page: true },
  { specifier: "camox/_internal/studioClient", only: "browser" },
  { specifier: "camox/_internal/rendererClient", only: "browser" },
  { specifier: "camox/_internal/pageServer", only: "workerd" },
  { specifier: "camox/_internal/studioServer", only: "workerd" },
  { specifier: "camox/_internal/runtime", only: "workerd" },
  { specifier: "camox/_internal/imageResponse", only: "workerd" },
  { specifier: "camox/_internal/workerRuntime", only: "workerd" },
  // React, React DOM and TanStack Query: one copy for camox and the website.
  { specifier: "react", page: true },
  { specifier: "react/jsx-runtime", page: true },
  { specifier: "react/compiler-runtime", page: true },
  { specifier: "react-dom", page: true },
  { specifier: "react-dom/client", only: "browser", page: true },
  { specifier: "react-dom/server", only: "workerd" },
  { specifier: "@tanstack/react-query" },
  // The npm packages websites share with camox.
  { specifier: "tailwind-merge", shared: true, page: true },
  { specifier: "clsx", shared: true, page: true },
  { specifier: "class-variance-authority", shared: true, page: true },
  { specifier: LUCIDE_ICON_HELPER, shared: true, page: true },
];

/**
 * The bare specifiers an SDK Bundle's `target` version holds, each with an entry of its own, for
 * a website that installs `websitePackages`.
 */
export function sdkBundleSpecifiers(
  target: SdkBundleTarget,
  websitePackages: ReadonlySet<string>,
): string[] {
  return SPECIFIERS.filter(
    ({ specifier, only, shared }) =>
      (!only || only === target) && (!shared || websitePackages.has(packageOfSpecifier(specifier))),
  ).map(({ specifier }) => specifier);
}

/**
 * Whether a page loads `specifier` at first paint: the camox entry points a page's code imports,
 * the page's own client, React, and the packages websites share with camox. A page that imports
 * another of camox's entry points loads one more chunk.
 */
export function loadsAtFirstPaint(specifier: string): boolean {
  return SPECIFIERS.some((entry) => entry.specifier === specifier && entry.page);
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
  return `${specifier.replace(/\.[cm]?js$/, "").replaceAll("/", "~")}.mjs`;
}
