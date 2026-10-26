/**
 * OG image renderer for the Worker.
 *
 * Under the `workerd` export condition, `takumi-js` picks Takumi's wasm backend, which imports
 * the wasm binary itself. The Cloudflare Vite plugin turns that `.wasm` import into a
 * `WebAssembly.Module`, and Takumi lazy-inits it inside the response stream. The wasm build
 * ships Geist, which renders text no loaded font covers.
 */

import type { ReactElement } from "react";

export { ImageResponse };
import { type GoogleFontFamily, googleFonts } from "takumi-js/helpers";
import { ImageResponse } from "takumi-js/response";

export interface ImageStyle {
  /** The site's compiled stylesheet, which the image's `className`s match. */
  css?: string;
  /** The Google Fonts families the site loads, in fallback order. */
  fonts: GoogleFontFamily[];
}

/** Renders `element` as a PNG response, styled like the site. */
export async function createImageResponse(
  element: ReactElement,
  size: { width: number; height: number },
  { css, fonts }: ImageStyle,
): Promise<Response> {
  return new ImageResponse(element, {
    ...size,
    css,
    fonts: await loadFonts(fonts),
  });
}

/** The families' font files, loaded lazily. Without them, the image falls back to Geist. */
async function loadFonts(families: GoogleFontFamily[]) {
  if (families.length === 0) return [];
  try {
    return await googleFonts(families);
  } catch (error) {
    console.warn("[camox] Page image fonts failed to load; rendering with Geist.", error);
    return [];
  }
}
