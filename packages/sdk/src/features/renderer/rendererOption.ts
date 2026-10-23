/**
 * The studio option that renders the Website Section through the renderer frame (ADR 0023). Off
 * by default until the renderer frame is the only way the studio renders pages (#570). A member
 * turns it on for their browser by setting this localStorage key to `on`, and reloads.
 */
export const RENDERER_FRAME_OPTION_KEY = "camox:renderer-frame";

let enabled: boolean | undefined;

/** Whether this studio renders through the renderer frame: read once per document. */
export function rendererFrameEnabled(): boolean {
  if (enabled !== undefined) return enabled;
  try {
    enabled =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(RENDERER_FRAME_OPTION_KEY) === "on";
  } catch {
    // Storage can be unavailable (privacy settings): the option stays off.
    enabled = false;
  }
  return enabled;
}
