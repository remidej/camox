export function isSiteStyle(element: Pick<Element, "hasAttribute">) {
  return !element.hasAttribute("data-camox-studio");
}

export const EMPTY_PREVIEW_DOCUMENT =
  '<!doctype html><html><head></head><body><div id="root" data-camox-preview-root></div></body></html>';
