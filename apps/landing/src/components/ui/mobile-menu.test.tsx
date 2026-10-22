import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MobileMenu } from "./mobile-menu";

describe("MobileMenu", () => {
  it("collapses the links behind a button that opens them without JS", () => {
    const html = renderToStaticMarkup(
      <MobileMenu label="Menu">
        <a href="/docs">Docs</a>
        <a href="https://github.com/remidej/camox">GitHub</a>
      </MobileMenu>,
    );

    // The links render once, inside the popover the button targets.
    const list =
      /<div[^>]*\spopover="auto"[^>]*\sid="([^"]+)"|<div[^>]*\sid="([^"]+)"[^>]*\spopover="auto"/i.exec(
        html,
      );
    expect(list).not.toBeNull();
    const id = list![1] ?? list![2];
    expect(html).toMatch(
      new RegExp(`<button[^>]*popovertarget="${id}"[^>]*aria-label="Menu"`, "i"),
    );
    expect(html.match(/href="\/docs"/g)).toHaveLength(1);
    expect(html.slice(html.indexOf('popover="auto"'))).toContain('href="/docs"');
  });
});
