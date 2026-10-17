import * as React from "react";

import type { PageRenderInput } from "./runtime";

type RuntimeChromeModule = { default: typeof import("./RuntimeChrome").RuntimeChrome };

let loadedModule: RuntimeChromeModule | undefined;
let loading: Promise<RuntimeChromeModule> | undefined;

/**
 * Studio chrome is only for members, so anonymous visitors never download it. Load it before
 * rendering or hydrating a member's document: both then render it in place, without suspending.
 */
export function loadRuntimeChrome() {
  loading ??= import("./RuntimeChrome").then((module) => {
    loadedModule = { default: module.RuntimeChrome };
    return loadedModule;
  });
  return loading;
}

const LazyRuntimeChrome = React.lazy(() => {
  if (!loadedModule) return loadRuntimeChrome();
  const module = loadedModule;
  // React reads a thenable that resolves synchronously without suspending. A promise never does.
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- React.lazy needs a thenable, see above
    then: (resolve: (value: RuntimeChromeModule) => void) => resolve(module),
  } as Promise<RuntimeChromeModule>;
});

/** Shows `fallback` while the chrome loads, when a visitor signs in without a reload. */
export function RuntimeChromeSlot({
  fallback,
  ...props
}: {
  input: PageRenderInput;
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  return (
    <React.Suspense fallback={fallback}>
      <LazyRuntimeChrome {...props} />
    </React.Suspense>
  );
}
