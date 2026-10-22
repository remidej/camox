import { describe, expect, it } from "vite-plus/test";

import stylesheet from "./styles.css?inline";

/**
 * The properties each selector of a stylesheet declares, comments stripped. Declarations
 * inside a nested at-rule (Tailwind wraps `color-mix()` fallbacks in `@supports`) count for
 * the rule around it.
 */
function declarationsBySelector(css: string) {
  const declared = new Map<string, Set<string>>();
  const open: string[][] = [];
  let buffer = "";
  const flushDeclaration = () => {
    const property = /^\s*([\w-]+)\s*:/.exec(buffer)?.[1];
    if (property) {
      for (const selector of open.at(-1) ?? []) {
        declared.set(selector, (declared.get(selector) ?? new Set()).add(property));
      }
    }
    buffer = "";
  };
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      const prelude = buffer.trim();
      open.push(
        prelude.startsWith("@") ? (open.at(-1) ?? []) : prelude.split(",").map((s) => s.trim()),
      );
      buffer = "";
    } else if (char === ";") {
      flushDeclaration();
    } else if (char === "}") {
      flushDeclaration();
      open.pop();
    } else {
      buffer += char;
    }
  }
  return declared;
}

describe("the landing page's Theme", () => {
  const declared = declarationsBySelector(stylesheet);

  // The page default and the four schemes a block's "Color scheme" setting offers. Camox's
  // editor reads its variables from the page, so they must follow whichever color scheme a
  // highlight or an empty image sits in.
  it.each([":root", ".light", ".dark", ".brand", ".tint"])(
    "%s is a color scheme that gives Camox's editor its variables",
    (selector) => {
      const properties = declared.get(selector) ?? new Set();
      expect([...properties]).toEqual(
        expect.arrayContaining([
          "color-scheme",
          "--camox-highlight",
          "--camox-placeholder",
          "--camox-placeholder-ink",
        ]),
      );
    },
  );

  // `--color-line` and the other role aliases are resolved once on :root, so a rule reading
  // them would ignore the color scheme around it. Rules read the per-scheme variables instead.
  it("reads color roles from the surrounding color scheme", () => {
    const rawRoleAlias =
      /var\(--color-(canvas|panel|ink|ink-muted|line|brand|ink-on-brand|success|warning|error)\)/g;
    expect(stylesheet.match(rawRoleAlias) ?? []).toEqual([]);
  });
});
