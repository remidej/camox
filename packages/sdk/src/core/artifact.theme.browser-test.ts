import assert from "node:assert/strict";
import { test } from "node:test";

import { launchArtifactBrowser, openArtifact } from "./artifact.browser.fixtures";

const SOURCE = `<!doctype html>
<title>Swatch</title>
<style>body { margin: 0; background: var(--background); color: var(--foreground); }</style>
<p>Swatch</p>`;

const css = `
  :root { --background: #ffffff; --foreground: #111111; }
  .dark { --background: #102030; --foreground: #eeeeee; }
`;

const browser = await launchArtifactBrowser();
try {
  for (const load of ["inline", "url"] as const) {
    const loaded = load === "inline" ? "inlined" : "loaded by URL";
    await test(`an Artifact Document ${loaded} paints with the theme tokens at its frame's position`, async () => {
      const artifact = await openArtifact(browser, SOURCE, {
        css,
        html: `<section class="dark" data-artifact></section>`,
        load,
      });
      try {
        await artifact.frame.waitForFunction(
          () => getComputedStyle(document.body).visibility !== "hidden",
        );
        const painted = await artifact.frame.evaluate(() => {
          const style = getComputedStyle(document.body);
          return { background: style.backgroundColor, text: style.color };
        });
        assert.deepEqual(painted, { background: "rgb(16, 32, 48)", text: "rgb(238, 238, 238)" });
      } finally {
        await artifact.close();
      }
    });
  }
} finally {
  await browser.close();
}
