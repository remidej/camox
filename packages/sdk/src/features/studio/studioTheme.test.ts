import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { STUDIO_THEME_SCRIPT } from "./studioTheme";

void test("the head bootstrap chooses the saved studio theme before CSS/hydration", () => {
  for (const [saved, legacy, systemDark, expected] of [
    ["dark", "light", false, "dark"],
    ["light", "dark", true, "light"],
    ["system", "light", true, "dark"],
    [null, "dark", false, "dark"],
    [null, null, false, "light"],
    ["invalid", null, true, "dark"],
  ] as const) {
    const classes = new Set(["site-class", "light"]);
    const root = {
      classList: {
        add: (value: string) => classes.add(value),
        remove: (...values: string[]) => values.forEach((value) => classes.delete(value)),
      },
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
    };
    runInNewContext(STUDIO_THEME_SCRIPT, {
      document: { documentElement: root },
      localStorage: { getItem: (key: string) => (key === "camox:studio:theme" ? saved : legacy) },
      matchMedia: () => ({ matches: systemDark }),
    });
    assert.equal(root.dataset.camoxStudioTheme, expected);
    assert.equal(root.style.colorScheme, expected);
    assert.equal(classes.has(expected), true);
    assert.equal(classes.has("site-class"), true);
  }
});

void test("blocked localStorage still gets the system theme on first paint", () => {
  const root = {
    classList: { add() {}, remove() {} },
    dataset: {} as Record<string, string>,
    style: {},
  };
  runInNewContext(STUDIO_THEME_SCRIPT, {
    document: { documentElement: root },
    localStorage: {
      getItem() {
        throw new Error("Storage blocked");
      },
    },
    matchMedia: () => ({ matches: true }),
  });
  assert.equal(root.dataset.camoxStudioTheme, "dark");
});
