/**
 * Node / Bun / Nitro entry — resolves via the `default` exports condition.
 *
 * Uses the same wasm renderer as workerd (one engine across runtimes — easier
 * to reason about, identical output, avoids pulling in NAPI bindings on Node
 * deploys). The split between this file and `imageResponse.workerd.ts` isn't
 * about which engine to use any more — it's only about *how* the wasm module
 * gets loaded:
 *
 *   - Here, we import the wasm module and `initSync` it ourselves before
 *     constructing a `Renderer`. The static `?module` import lets Nitro emit
 *     the asset into the deployment instead of relying on a runtime
 *     `require.resolve` that dependency tracing cannot reliably discover.
 *
 *   - In `imageResponse.workerd.ts` there's no filesystem; instead we pass a
 *     `WebAssembly.Module` reference via `?module` import and let the
 *     ImageResponse stream lazy-init the wasm.
 *
 * We use the BYO-renderer path of `@takumi-rs/image-response/wasm` so the
 * `module:` option isn't needed here — the renderer is already alive.
 */

import { ImageResponse as WasmImageResponse } from "@takumi-rs/image-response/wasm";
import wasmModule from "@takumi-rs/wasm/next";
import { Renderer, initSync } from "@takumi-rs/wasm/no-bundler";
import type { ReactNode } from "react";

import { DEFAULT_FONTS } from "./defaultFonts";

type WasmCtorOptions = ConstructorParameters<typeof WasmImageResponse>[1];

/**
 * Resolve and initialise the wasm module once at module load. `initSync`
 * compiles the wasm and wires up the JS bindings; subsequent `new Renderer()`
 * calls are cheap.
 */
initSync({ module: wasmModule });

/**
 * Module-scoped singleton — building the renderer compiles the wasm module
 * and loads Geist; not free, and there's no reason to do it per request.
 */
const renderer = new Renderer({ fonts: DEFAULT_FONTS });

/** Same shape as the wasm options minus the `renderer` field we inject ourselves. */
export type ImageResponseOptions = Omit<WasmCtorOptions, "renderer" | "module">;

export class ImageResponse extends WasmImageResponse {
  constructor(component: ReactNode, options?: ImageResponseOptions) {
    super(component, { ...options, renderer } as unknown as WasmCtorOptions);
  }
}
