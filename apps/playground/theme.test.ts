import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const stylesheet = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");

/** Top-level `selector { declarations }` rules, comments stripped. */
function parseRules(css: string) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Array<{ selectors: string[]; properties: Set<string> }> = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    const properties = new Set(
      match[2]
        .split(";")
        .map((declaration) => declaration.split(":")[0].trim())
        .filter(Boolean),
    );
    rules.push({ selectors, properties });
  }
  return rules;
}

function propertiesOf(selector: string) {
  const properties = new Set<string>();
  for (const rule of parseRules(stylesheet)) {
    if (rule.selectors.includes(selector)) for (const p of rule.properties) properties.add(p);
  }
  return properties;
}

// The page default and the five schemes a block's "Color scheme" setting offers.
const colorSchemeSelectors = [":root", ".light", ".dark", ".brand", ".accent", ".tint"];

for (const selector of colorSchemeSelectors) {
  void test(`${selector} is a color scheme that gives Camox's editor its variables`, () => {
    const properties = propertiesOf(selector);
    assert.ok(properties.has("color-scheme"), `${selector} sets no color-scheme`);
    for (const variable of [
      "--camox-highlight",
      "--camox-placeholder",
      "--camox-placeholder-ink",
    ]) {
      assert.ok(properties.has(variable), `${selector} doesn't declare ${variable}`);
    }
  });
}

// `--color-line` and the other role aliases are resolved once on :root, so a rule reading
// them would ignore the color scheme around it. Rules read the per-scheme variables instead.
void test("rules read color roles from the surrounding color scheme", () => {
  const rawRoleAlias =
    /var\(--color-(canvas|panel|ink|ink-muted|line|brand|ink-on-brand|accent|ink-on-accent|success|warning|error)\)/g;
  assert.deepEqual(stylesheet.replace(/\/\*[\s\S]*?\*\//g, "").match(rawRoleAlias) ?? [], []);
});
