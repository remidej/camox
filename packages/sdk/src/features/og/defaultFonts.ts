/**
 * Decoded default fonts for the OG image wrapper.
 *
 * Takumi's wasm renderer ships with no embedded fonts — rendering without
 * `fonts` produces zero text runs and OG images come out as featureless
 * rectangles. We always inject Geist Variable so text has something to render
 * with; the user can still pass their own `fonts:` through the ImageResponse
 * constructor and override this default.
 *
 * Decoded once at module load. Takumi keys registered fonts by their bytes, so
 * passing the same `data` on every render registers Geist only once per
 * isolate.
 */

import { GEIST_VARIABLE_TTF_BASE64 } from "./geist-variable-ttf-base64";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const DEFAULT_FONTS = [
  {
    name: "Geist",
    data: decodeBase64(GEIST_VARIABLE_TTF_BASE64),
    weight: 400,
    style: "normal" as const,
  },
];
