import { describe, expect, it } from "vite-plus/test";

import { LOOK_SIZES } from "./capture";
import {
  ELEMENT_SCREENS,
  elementClip,
  fittingJpeg,
  IMAGE_CAP_BYTES,
  JPEG_QUALITIES,
} from "./framing";

// How a capture's image is framed and kept under Browser Run's size cap, apart from the browser.

const screen = LOOK_SIZES.mobile.height;
const limit = ELEMENT_SCREENS * screen;

describe("an element capture's clip", () => {
  it("shows the whole element when it's no taller than its screens, at its place on the page", () => {
    const box = { x: 10, y: 40, width: 300, height: limit };

    expect(elementClip(box, 500, screen)).toEqual({
      clip: { x: 10, y: 540, width: 300, height: limit },
      cut: false,
    });
  });

  it("cuts an element taller than its screens at their height, and says so", () => {
    const box = { x: 0, y: 0, width: 300, height: limit + 1 };

    expect(elementClip(box, 0, screen)).toEqual({
      clip: { x: 0, y: 0, width: 300, height: limit },
      cut: true,
    });
  });
});

/** An encoder whose image at each quality is `size(quality)` bytes, each byte the quality. */
const encoder = (size: (quality: number) => number) => async (quality: number) =>
  new Uint8Array(size(quality)).fill(quality);

describe("a capture's JPEG", () => {
  it("keeps the first quality's image when it's under the cap", async () => {
    const image = await fittingJpeg(encoder(() => IMAGE_CAP_BYTES - 1));

    expect(image[0]).toBe(JPEG_QUALITIES[0]);
  });

  it("is encoded again at a lower quality when it's over the cap, until it's under", async () => {
    const [first, second] = JPEG_QUALITIES;
    const image = await fittingJpeg(
      encoder((quality) => (quality === first ? IMAGE_CAP_BYTES + 1 : IMAGE_CAP_BYTES - 1)),
    );

    expect(image.byteLength).toBeLessThan(IMAGE_CAP_BYTES);
    expect(image[0]).toBe(second);
  });

  it("fails with an error naming the cap when even the lowest quality is over it", async () => {
    await expect(fittingJpeg(encoder(() => IMAGE_CAP_BYTES + 1))).rejects.toThrow(/over the 1 MB/);
  });
});
