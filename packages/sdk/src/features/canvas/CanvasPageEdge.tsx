/** A device pixel, in the CSS pixels of the Canvas world the camera scales. */
const DEVICE_PIXEL = "calc(1px / (var(--canvas-zoom, 1) * var(--canvas-pixel-ratio, 1)))";

/**
 * The edge of a Page or block frame in the Canvas, drawn over the frame. Where
 * the edge falls partway through a screen pixel, the blocks and the site's
 * background under them each cover only part of that pixel, and the background
 * shows through as a light line. One opaque band, from a device pixel outside the
 * edge to one inside, covers that pixel whole, in the colors of the ring and
 * Canvas around the frame.
 */
export function CanvasPageEdge({ shaded }: { shaded: boolean }) {
  const band = (color: string) => `inset 0 0 0 calc(2 * ${DEVICE_PIXEL}) ${color}`;
  const layers = [
    "rgb(0 0 0 / 0.1)",
    shaded && "color-mix(in oklab, var(--color-foreground) 5%, transparent)",
    "var(--color-muted)",
  ].filter((color): color is string => !!color);
  return (
    <div
      aria-hidden
      data-canvas-page-edge
      className="pointer-events-none absolute"
      style={{ inset: `calc(-1 * ${DEVICE_PIXEL})`, boxShadow: layers.map(band).join(", ") }}
    />
  );
}
