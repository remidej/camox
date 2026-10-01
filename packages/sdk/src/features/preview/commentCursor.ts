/** The bottom-left tip marks the comment's anchor point. */
export const COMMENT_CURSOR_PATH = "M16 1a15 15 0 0 1 0 30H1V16A15 15 0 0 1 16 1Z";

// SVG data URLs cannot inherit CSS variables. Keep these aligned with the
// selected overlay colors in studio-overlays.css.
export const COMMENT_CURSOR_COLOR = "#f472b6";
export const COMMENT_CURSOR_SYNCED_COLOR = "#c084fc";

function cursor(color: string) {
  return `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32"><path d="${COMMENT_CURSOR_PATH}" fill="${color}" stroke="white" stroke-width="2"/></svg>`,
  )}") 1 23, crosshair`;
}

export const COMMENT_CURSOR = cursor(COMMENT_CURSOR_COLOR);

export const COMMENT_CURSOR_STYLES = `
html, [data-camox-overlay-mode] {
  --camox-comment-cursor: ${COMMENT_CURSOR};
}
[data-camox-overlay-mode="synced"], [data-camox-overlay-mode="reference"] {
  --camox-comment-cursor: ${cursor(COMMENT_CURSOR_SYNCED_COLOR)};
}
html, html * { cursor: var(--camox-comment-cursor) !important; }
`;
