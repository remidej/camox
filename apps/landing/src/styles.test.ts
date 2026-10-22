import { describe, expect, it } from "vite-plus/test";

import stylesheet from "./styles.css?inline";

/** The custom properties each selector of the compiled stylesheet declares. */
function declarationsBySelector(css: string) {
  const declared = new Map<string, Set<string>>();
  // Innermost rules only: a selector list, then declarations without nested blocks.
  for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const properties = [...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name);
    for (const selector of selectorList.split(",")) {
      const key = selector.trim();
      const set = declared.get(key) ?? new Set<string>();
      for (const property of properties) set.add(property);
      declared.set(key, set);
    }
  }
  return declared;
}

describe("the landing page's Theme", () => {
  const declared = declarationsBySelector(stylesheet);

  // Camox's editor reads these from the page, so they must follow whichever color scheme a
  // highlight or an empty image sits in.
  it.each([":root", ".light", ".dark", ".brand", ".tint"])(
    "declares the variables Camox reads on the %s color scheme",
    (selector) => {
      const properties = declared.get(selector) ?? new Set();
      expect([...properties]).toEqual(
        expect.arrayContaining([
          "--camox-highlight",
          "--camox-placeholder",
          "--camox-placeholder-ink",
        ]),
      );
    },
  );
});
