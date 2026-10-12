import assert from "node:assert/strict";
import { test } from "node:test";

import { createArtifactPage, type ArtifactWindow } from "./artifactProtocol.fixtures";
import { artifactFrameProps } from "./lib/artifact";
import { connectArtifactHost } from "./lib/artifactHost";

const srcDoc = artifactFrameProps("<!doctype html><title>Orbit</title><svg></svg>").srcDoc;

const themeCss = `
  :root { --background: #ffffff; --foreground: #111111; --radius: 0.5rem; }
  .dark { --background: #000000; --foreground: #eeeeee; }
  [data-theme="brand"] { --background: #ff0000; }
`;

/** A page styled with `themeCss`, holding one artifact frame inside `<section class=…>`. */
function themedPage(sectionClass = "") {
  const harness = createArtifactPage();
  const { document } = harness.page;
  const style = document.createElement("style");
  style.textContent = themeCss;
  document.head.append(style);
  const section = document.createElement("section");
  section.className = sectionClass;
  document.body.append(section);
  const frame = document.createElement("iframe") as unknown as HTMLIFrameElement;
  section.append(frame as never);
  return { harness, section, frame };
}

/** A custom property as the artifact's own `:root` resolves it. */
function rootToken(artifact: ArtifactWindow, name: string) {
  return artifact.getComputedStyle(artifact.document.documentElement).getPropertyValue(name).trim();
}

void test("an artifact's :root gets the theme tokens at its frame's position", async () => {
  const { harness, frame } = themedPage();
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  assert.equal(rootToken(artifact, "--background"), "#ffffff");
  assert.equal(rootToken(artifact, "--radius"), "0.5rem");
});

void test("an artifact inside a .dark section gets the dark tokens", async () => {
  const { harness, frame } = themedPage("dark");
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  assert.equal(rootToken(artifact, "--background"), "#000000");
  assert.equal(rootToken(artifact, "--foreground"), "#eeeeee");
  assert.equal(rootToken(artifact, "--radius"), "0.5rem");
});

void test("changing an ancestor's class rethemes the artifact and notifies onTheme", async () => {
  const { harness, section, frame } = themedPage();
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  const seen: string[] = [];
  artifact.camox.onTheme((theme) => seen.push(theme.tokens["--background"]));

  section.classList.add("dark");
  await harness.settle();
  assert.equal(rootToken(artifact, "--background"), "#000000");
  assert.equal(artifact.camox.theme.tokens["--background"], "#000000");
  assert.deepEqual(seen, ["#000000"]);

  section.classList.remove("dark");
  await harness.settle();
  assert.equal(rootToken(artifact, "--background"), "#ffffff");
  assert.deepEqual(seen, ["#000000", "#ffffff"]);
});

void test("changing an ancestor's data attributes or style rethemes the artifact", async () => {
  const { harness, section, frame } = themedPage();
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();

  harness.page.document.body.dataset.theme = "brand";
  await harness.settle();
  assert.equal(rootToken(artifact, "--background"), "#ff0000");

  section.style.setProperty("--radius", "1rem");
  await harness.settle();
  assert.equal(rootToken(artifact, "--radius"), "1rem");
});

void test("an onTheme callback stops once unsubscribed", async () => {
  const { harness, section, frame } = themedPage();
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();
  let calls = 0;
  const unsubscribe = artifact.camox.onTheme(() => calls++);
  unsubscribe();
  section.classList.add("dark");
  await harness.settle();
  assert.equal(calls, 0);
});

void test("camox.theme exposes color tokens as sRGB, including oklch() tokens", async () => {
  const harness = createArtifactPage();
  const { document } = harness.page;
  const style = document.createElement("style");
  style.textContent = `:root {
    --red: oklch(62.8% 0.2577 29.23);
    --white: oklch(1 0 0);
    --translucent-black: oklch(0 0 0 / 50%);
    --steel: #336699;
    --green: hsl(120 100% 25%);
    --amber: rgb(255 191 0);
    --radius: 0.5rem;
  }`;
  document.head.append(style);
  const frame = harness.addFrame();
  connectArtifactHost(frame, { studio: null });
  const artifact = harness.load(frame, srcDoc);
  await harness.settle();

  const { colors, tokens } = artifact.camox.theme;
  assert.deepEqual(JSON.parse(JSON.stringify(colors)), {
    "--red": { r: 255, g: 0, b: 0 },
    "--white": { r: 255, g: 255, b: 255 },
    "--translucent-black": { r: 0, g: 0, b: 0 },
    "--steel": { r: 51, g: 102, b: 153 },
    "--green": { r: 0, g: 128, b: 0 },
    "--amber": { r: 255, g: 191, b: 0 },
  });
  assert.equal(tokens["--red"], "oklch(62.8% 0.2577 29.23)");
  assert.equal(tokens["--radius"], "0.5rem");
});

function bodyVisibility(artifact: ArtifactWindow) {
  return artifact.getComputedStyle(artifact.document.body).visibility;
}

void test("an artifact's body stays hidden until its theme arrives", async () => {
  const { harness, frame } = themedPage();
  const artifact = harness.load(frame, srcDoc);
  assert.equal(bodyVisibility(artifact), "hidden");
  connectArtifactHost(frame, { studio: null });
  await harness.settle();
  assert.notEqual(bodyVisibility(artifact), "hidden");
});

void test("an artifact that never gets a theme still shows its body", async () => {
  const { harness, frame } = themedPage();
  const artifact = harness.load(frame, srcDoc);
  assert.equal(bodyVisibility(artifact), "hidden");
  const deadline = Date.now() + 5000;
  while (bodyVisibility(artifact) === "hidden" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.notEqual(bodyVisibility(artifact), "hidden");
});
