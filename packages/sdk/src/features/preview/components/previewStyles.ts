/**
 * Whether a style or stylesheet is the site's. The studio marks its own, including those it adds
 * to a frame's document, with `data-camox-studio`.
 */
export function isSiteStyle(element: Pick<Element, "hasAttribute">) {
  return !element.hasAttribute("data-camox-studio");
}

export const EMPTY_PREVIEW_DOCUMENT =
  '<!doctype html><html><head></head><body><div id="root" data-camox-preview-root></div></body></html>';

/**
 * The stylesheets of a document's head that are the site document's: not the studio's, nor those
 * React hoists there for the blocks rendering in it (`data-precedence`).
 */
const SITE_STYLESHEETS = 'link[rel~="stylesheet"], style';
const siteStylesheetsOf = (head: HTMLHeadElement) =>
  Array.from(head.querySelectorAll<HTMLElement>(SITE_STYLESHEETS)).filter(
    (element) =>
      element.parentElement === head &&
      isSiteStyle(element) &&
      !element.hasAttribute("data-precedence"),
  );

/**
 * Gives a frame's document the site stylesheets of `html`, a site document: the ones it no
 * longer has go, and its new ones are added, the rest of the frame left as it is.
 */
export function restyle(frame: Window, html: string) {
  const doc = frame.document;
  const { DOMParser } = frame as Window & typeof globalThis;
  const wanted = siteStylesheetsOf(new DOMParser().parseFromString(html, "text/html").head);
  const held = siteStylesheetsOf(doc.head);
  const wantedMarkup = new Set(wanted.map((element) => element.outerHTML));
  const heldMarkup = new Set(held.map((element) => element.outerHTML));
  for (const element of held) if (!wantedMarkup.has(element.outerHTML)) element.remove();
  for (const element of wanted) {
    if (!heldMarkup.has(element.outerHTML)) doc.head.appendChild(doc.importNode(element, true));
  }
}
