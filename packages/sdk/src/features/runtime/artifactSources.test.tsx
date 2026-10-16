import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import { renderToString } from "react-dom/server";

import { artifactFrameProps } from "../../core/lib/artifact";
import { omitArtifactSources, restoreArtifactSources } from "./artifactSources";

const orbit = `<!doctype html><title>Orbit & "rings" — it's <b>bold</b></title><svg></svg>`;
const gauge = "<!doctype html><title>Gauge</title><script>if (1 < 2) camox;</script>";
const fontLinks = '<link rel="stylesheet" href="https://fonts.test/css?family=Inter&amp;x=1">';

/** A dehydrated state shaped like the page's, holding `sources` as artifact field values. */
function stateWith(...sources: string[]) {
  return {
    mutations: [],
    queries: [
      {
        queryKey: ["camox", "blocks", "get", "1"],
        state: {
          data: {
            block: { content: { heading: "How it works" } },
            repeatableItems: sources.map((illustration, id) => ({ id, content: { illustration } })),
          },
        },
      },
    ],
  };
}

/** The server's HTML for frames of `sources`, as React renders them. */
function framesHtml(...sources: string[]) {
  return renderToString(
    <main>
      {sources.map((source, index) => (
        <iframe key={index} {...artifactFrameProps(source, { fontLinks, data: { index } })} />
      ))}
    </main>,
  );
}

/** The client's root after the browser parsed `html`. */
function parse(html: string) {
  const root = new Window().document.createElement("div");
  root.innerHTML = html;
  return root as unknown as Pick<ParentNode, "querySelectorAll">;
}

void test("the HTML's hydration data leaves out the sources its frames hold, and the client takes them back", () => {
  const state = stateWith(orbit, gauge);
  const html = framesHtml(orbit, gauge);

  const omitted = omitArtifactSources(state, html);
  const serialized = JSON.stringify(omitted);
  assert.ok(!serialized.includes("Orbit"));
  assert.ok(!serialized.includes("Gauge"));
  assert.ok(serialized.includes("How it works"));

  assert.deepEqual(restoreArtifactSources(omitted, parse(html)), state);
});

void test("sources the HTML doesn't render stay in the hydration data", () => {
  const state = stateWith(orbit, gauge);
  const omitted = omitArtifactSources(state, framesHtml(orbit));
  assert.ok(!JSON.stringify(omitted).includes("Orbit"));
  assert.ok(JSON.stringify(omitted).includes("Gauge"));
});

void test("a page without artifacts keeps its hydration data as is", () => {
  const state = stateWith();
  assert.equal(omitArtifactSources(state, "<main><iframe src='/x'></iframe></main>"), state);
});

void test("a source with CR LF line endings comes back as the browser parsed it", () => {
  const windows = "<!doctype html>\r\n<title>Lines</title>\r\n<p>One</p>";
  const parsed = windows.replaceAll("\r\n", "\n");
  const omitted = omitArtifactSources(stateWith(windows), framesHtml(windows));
  assert.ok(!JSON.stringify(omitted).includes("Lines"));
  // Browsers normalize line endings as they parse the HTML.
  const root = parse(framesHtml(parsed));
  assert.deepEqual(restoreArtifactSources(omitted, root), stateWith(parsed));
});

void test("a frame missing before hydration leaves its artifact empty", (t) => {
  const error = t.mock.method(console, "error", () => {});
  const omitted = omitArtifactSources(stateWith(orbit), framesHtml(orbit));
  assert.deepEqual(restoreArtifactSources(omitted, parse("<main></main>")), stateWith(""));
  assert.equal(error.mock.callCount(), 1);
});
