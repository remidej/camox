import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createArtifactPage } from "../../core/artifactProtocol.fixtures";
import { connectArtifactHost } from "../../core/lib/artifactHost";
import { ARTIFACT_RUNTIME } from "../../core/lib/artifactRuntime";
import {
  minifyArtifactRuntimeModule,
  transformArtifactRuntime,
} from "./artifactRuntimeMinification";

const runtimeModule = new URL("../../core/lib/artifactRuntime.ts", import.meta.url);

/** The runtime as the SDK's build ships it. */
function minifiedRuntime() {
  const code = minifyArtifactRuntimeModule(readFileSync(runtimeModule, "utf8"));
  const literal = /export const ARTIFACT_RUNTIME = (".*");/.exec(code);
  assert.ok(literal, "the minified module still exports ARTIFACT_RUNTIME");
  return JSON.parse(literal[1]) as string;
}

void test("the build ships a smaller runtime", () => {
  assert.ok(minifiedRuntime().length < ARTIFACT_RUNTIME.length);
});

void test("the minified runtime still connects, and shares data, studio and theme", async () => {
  const harness = createArtifactPage();
  const style = harness.page.document.createElement("style");
  style.textContent = ":root { --primary: #336699; --radius: 0.5rem; }";
  harness.page.document.head.append(style);
  const frame = harness.addFrame();
  const data = { label: "Uptime" };
  connectArtifactHost(frame, { studio: { editMode: true, canvas: false }, data });
  const artifact = harness.load(
    frame,
    `<!doctype html><script>${minifiedRuntime()}</script>` +
      `<script type="application/json" data-camox-data>${JSON.stringify(data)}</script>` +
      `<title>Gauge</title>`,
  );
  await harness.settle();

  assert.equal(artifact.camox.data.label, "Uptime");
  assert.equal(artifact.camox.studio?.editMode, true);
  assert.equal(artifact.camox.theme.tokens["--radius"], "0.5rem");
  assert.deepEqual({ ...artifact.camox.theme.colors["--primary"] }, { r: 51, g: 102, b: 153 });
});

void test("the build transform only rewrites the runtime module", () => {
  const code = readFileSync(runtimeModule, "utf8");
  assert.equal(transformArtifactRuntime(code, "/sdk/src/core/lib/artifact.ts"), null);
  assert.equal(transformArtifactRuntime(code, "/sdk/dist/core/lib/artifactRuntime.js"), null);
  assert.notEqual(transformArtifactRuntime(code, "/sdk/src/core/lib/artifactRuntime.ts"), null);
  assert.notEqual(transformArtifactRuntime(code, "/sdk/src/core/lib/artifactRuntime.ts?v=1"), null);
});

void test("a runtime with an interpolation fails the build instead of shipping unminified", () => {
  assert.throws(
    () => minifyArtifactRuntimeModule("export const ARTIFACT_RUNTIME = `(() => ${x})();`;"),
    /interpolations/,
  );
});
