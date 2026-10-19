/**
 * What assistive technology gets from a client navigation, which the browser only provides for
 * document loads: focus that starts over on the new page, and the new page's name read out.
 */

/** Focuses `element` without scrolling, even if it can't take focus by itself. */
function focusWithoutScrolling(element: HTMLElement) {
  if (element.tabIndex >= 0 || element.hasAttribute("tabindex")) {
    element.focus({ preventScroll: true });
    return;
  }
  element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  // Only programmatic focus lands on it: Tab still skips it, and once left it's plain again.
  element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
}

/**
 * Moves focus within the page `doc` just rendered, as a document load would: to the fragment's
 * element, so Tab continues from there, or else to the start of the page. Focus outside the page,
 * like in Studio, stays where it is.
 */
export function focusNewPage(doc: Document, fragment: Element | null) {
  if (!doc.hasFocus()) return;
  const target = (fragment ?? doc.body) as HTMLElement | null;
  if (target) focusWithoutScrolling(target);
}

const visuallyHidden =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";

/**
 * A live region in `doc` that reads out each page navigated to. It exists before the first
 * announcement, as screen readers only read changes to regions they already know.
 */
export function createRouteAnnouncer(doc: Document) {
  const region = doc.createElement("div");
  region.setAttribute("aria-live", "assertive");
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("data-camox-route-announcer", "");
  region.setAttribute("style", visuallyHidden);
  doc.body.append(region);
  return {
    /** Reads out the page `page` shows: its title, else its main heading, else its path. */
    announce(page: Document, pathname: string) {
      const name =
        doc.title || page.title || page.querySelector("h1")?.textContent?.trim() || pathname;
      region.textContent = name;
    },
    dispose() {
      region.remove();
    },
  };
}
