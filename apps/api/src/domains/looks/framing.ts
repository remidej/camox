// How a capture's image is framed and kept under Browser Run's size cap: the browser-free part of
// Browser Run's captures (browser-run.ts), so it's tested without a browser.

/** How many screens of its size an element capture shows at most, before it's cut. */
export const ELEMENT_SCREENS = 2;

/** The most bytes one image may be: Browser Run's cap on a screenshot. */
export const IMAGE_CAP_BYTES = 1_000_000;

/**
 * The qualities a capture's JPEG is encoded at, in turn, until its image is under the cap. The
 * first is enough for one or two screens; the others are for a page heavy with detail.
 */
export const JPEG_QUALITIES = [80, 60, 40] as const;

/** A region of the page, in CSS pixels. */
export type Region = { x: number; y: number; width: number; height: number };

/**
 * The page's region an element capture shows, for the element at `box` in the viewport of a
 * page scrolled to `scrollY`: the whole element, cut at `ELEMENT_SCREENS` screens of
 * `screenHeight`, and whether it was cut.
 */
export function elementClip(
  box: Region,
  scrollY: number,
  screenHeight: number,
): { clip: Region; cut: boolean } {
  const maxHeight = screenHeight * ELEMENT_SCREENS;
  return {
    clip: {
      x: box.x,
      y: box.y + scrollY,
      width: box.width,
      height: Math.min(box.height, maxHeight),
    },
    cut: box.height > maxHeight,
  };
}

/**
 * The image `encode` gives at the highest of `JPEG_QUALITIES` it's under the cap at. Throws when
 * even the lowest is over it, failing that capture.
 */
export async function fittingJpeg<Image extends { byteLength: number }>(
  encode: (quality: number) => Promise<Image>,
): Promise<Image> {
  for (const quality of JPEG_QUALITIES) {
    const image = await encode(quality);
    if (image.byteLength < IMAGE_CAP_BYTES) return image;
  }
  throw new Error(
    "The image was over the 1 MB a capture may be, even at its lowest quality: capture a " +
      "smaller part of the page.",
  );
}
