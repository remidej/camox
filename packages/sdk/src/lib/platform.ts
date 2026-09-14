// Self-contained: serialized into the studio head, before any chrome can paint.
export function bootstrapPlatform() {
  document.documentElement.dataset.camoxPlatform = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "mac"
    : "other";
}

export const PLATFORM_SCRIPT = `(${bootstrapPlatform.toString()})();`;
export const PLATFORM_LABEL_CSS = `
.camox-platform-mac{display:none}
:root[data-camox-platform="mac"] .camox-platform-mac{display:inline}
:root[data-camox-platform="mac"] .camox-platform-other{display:none}
`;
