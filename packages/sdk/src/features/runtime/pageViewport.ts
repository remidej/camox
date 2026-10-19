import * as React from "react";

/**
 * Lets the surface that shows the page, when it isn't the visitor's window, take part in
 * navigation: Studio's frame scrolls and focuses each page as its navigation asks, and loads the
 * pages its links lead to ahead.
 */
export interface PageViewport {
  /**
   * `viewport` shows the page from now on: each navigation scrolls and focuses it once the next
   * page renders. Returns the release for when it no longer does, like a Studio frame placed in
   * the Canvas.
   */
  attach(viewport: Window): () => void;
  /** `viewport` rendered its first page, at `href`: back to where it was left, as on reload. */
  opened(viewport: Window, href: string): void;
  /** The page at `href` was placed otherwise, like where the Canvas showed it: don't scroll it. */
  placed(href: string): void;
  /** Starts loading the page `anchor` leads to, if the runtime renders it. */
  prefetchLink(anchor: HTMLAnchorElement): void;
}

export const PageViewportContext = React.createContext<PageViewport | null>(null);
