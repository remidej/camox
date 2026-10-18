/**
 * OG image renderer for the Worker.
 *
 * Under the `workerd` export condition, `@takumi-rs/image-response` picks Takumi's wasm
 * backend, which imports the wasm binary itself. The Cloudflare Vite plugin turns that
 * `.wasm` import into a `WebAssembly.Module`, and Takumi lazy-inits it inside the
 * response stream.
 *
 * Geist is bundled in `./defaultFonts` to compensate for the wasm renderer shipping with
 * no embedded fonts.
 */

import {
  ImageResponse as TakumiImageResponse,
  type ImageResponseOptions,
} from "@takumi-rs/image-response";
import type { ReactNode } from "react";

import { DEFAULT_FONTS } from "./defaultFonts";

export type { ImageResponseOptions };

export class ImageResponse extends TakumiImageResponse {
  constructor(component: ReactNode, options?: ImageResponseOptions) {
    // Honor user-provided fonts; otherwise inject Geist as a default so text
    // has something to render with.
    super(component, { ...options, fonts: options?.fonts ?? DEFAULT_FONTS });
  }
}
