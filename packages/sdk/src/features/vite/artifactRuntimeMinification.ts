import { minifySync } from "vite-plus";

/** The runtime's source module, also with the query Vite's dev server may add to it. */
const RUNTIME_MODULE = /[\\/]src[\\/]core[\\/]lib[\\/]artifactRuntime\.ts(\?.*)?$/;
const RUNTIME_EXPORT = /export const ARTIFACT_RUNTIME = `([^`]*)`;/;

/**
 * Minifies the `camox` runtime in the source of `artifactRuntime.ts`. Every artifact frame inlines
 * the runtime in its `srcDoc`, so the website's HTML carries one copy per artifact, and the SDK's
 * bundle is otherwise left unminified. Throws when the module no longer holds the runtime as one
 * plain template literal, rather than shipping it unminified.
 */
export function minifyArtifactRuntimeModule(code: string) {
  const match = RUNTIME_EXPORT.exec(code);
  if (!match) throw new Error("artifactRuntime.ts no longer exports ARTIFACT_RUNTIME as `…`.");
  const runtime = match[1];
  if (runtime.includes("\\") || runtime.includes("${")) {
    throw new Error("The artifact runtime must have no backslashes or interpolations.");
  }
  const { code: minified, errors } = minifySync("artifactRuntime.js", runtime);
  if (errors.length > 0) {
    throw new Error(`The artifact runtime failed to minify: ${errors[0].message}`);
  }
  return code.replace(
    match[0],
    () => `export const ARTIFACT_RUNTIME = ${JSON.stringify(minified.trim())};`,
  );
}

/**
 * A build `transform` that minifies the runtime's source module and leaves every other module
 * alone. The SDK's own build applies it, and so does the `camox` Vite plugin, for apps that
 * compile the SDK from source.
 */
export function transformArtifactRuntime(code: string, id: string) {
  if (!RUNTIME_MODULE.test(id)) return null;
  // The module is one minified string with nothing worth mapping back to.
  return { code: minifyArtifactRuntimeModule(code), map: { mappings: "" } };
}
