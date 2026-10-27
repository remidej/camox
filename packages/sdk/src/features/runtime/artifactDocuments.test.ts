import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

import { artifactSourceHash } from "@camox/api-contract";

import type { CamoxDocument } from "../../core/defineDocument";
import { artifactFontLinks, artifactShellHash } from "../../core/lib/artifact";
import { ARTIFACT_RUNTIME } from "../../core/lib/artifactRuntime";
import { handleCamoxRequest, isPublicRequest, type RuntimeOptions } from "./runtime";
import { shouldHandleRequest } from "./workerRequest";

const source = "<!doctype html><title>Orbit diagram</title><svg></svg>";
const fontLink = '<link rel="stylesheet" href="https://fonts.test/inter.css">';
const document: CamoxDocument = {
  title: "Real website",
  link: [{ rel: "stylesheet", href: "https://fonts.test/inter.css" }],
};

/** The API's artifact source store, holding `stored`, and the requests it gets. */
function mockSourceStore(t: TestContext, stored: readonly string[] = [source]) {
  const requests: Request[] = [];
  t.mock.method(globalThis, "fetch", async (input: Request | string, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const match = /^\/artifact-sources\/([^/]+)\/([^/]+)$/.exec(new URL(request.url).pathname);
    if (!match || new URL(request.url).origin !== "https://api.test" || match[1] !== "project-1")
      throw new Error(`Unexpected API request ${request.url}`);
    for (const candidate of stored)
      if ((await artifactSourceHash(candidate)) === match[2])
        return new Response(candidate, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  });
  return requests;
}

function runtimeOptions(website: CamoxDocument = document): RuntimeOptions {
  return {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "project-1",
    getDocument: async () => website,
    renderPage: async () => {
      throw new Error("An artifact's document is not a page");
    },
  };
}

async function currentShellHash(website: CamoxDocument = document) {
  return artifactShellHash(artifactFontLinks(website));
}

function artifactRequest(shellHash: string, sourceHash: string, init?: RequestInit) {
  return new Request(`https://site.test/_camox/artifacts/${shellHash}/${sourceHash}`, init);
}

function assertSandboxed(response: Response) {
  assert.match(response.headers.get("Content-Type")!, /^text\/html/);
  assert.equal(response.headers.get("Content-Security-Policy"), "sandbox allow-scripts");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
}

void test("an artifact's URL serves its source inside the runtime and font links, cached for a year", async (t) => {
  mockSourceStore(t);
  const response = await handleCamoxRequest(
    artifactRequest(await currentShellHash(), await artifactSourceHash(source)),
    runtimeOptions(),
  );

  assert.equal(response?.status, 200);
  assertSandboxed(response!);
  const cacheControl = response!.headers.get("Cache-Control")!.split(/,\s*/);
  assert.ok(cacheControl.includes("public"));
  assert.ok(cacheControl.includes("immutable"));
  assert.ok(cacheControl.includes(`max-age=${365 * 24 * 60 * 60}`));
  const html = await response!.text();
  const shell = `<!doctype html><script>${ARTIFACT_RUNTIME}</script>`;
  assert.ok(html.startsWith(shell));
  assert.ok(html.endsWith(source));
  // Only the font links between them: nothing else from the website's head, and no inline data
  // script, which the runtime would prefer over the URL's fragment.
  assert.equal(html.slice(shell.length, -source.length), fontLink);
});

void test("a stale shell hash still gets the current shell, but nothing keeps it", async (t) => {
  mockSourceStore(t);
  const stale = await currentShellHash({ link: [{ rel: "stylesheet", href: "/old.css" }] });
  const response = await handleCamoxRequest(
    artifactRequest(stale, await artifactSourceHash(source)),
    runtimeOptions(),
  );

  assert.equal(response?.status, 200);
  assertSandboxed(response!);
  assert.equal(response!.headers.get("Cache-Control"), "no-store");
  const html = await response!.text();
  assert.ok(html.includes(fontLink));
  assert.ok(!html.includes("/old.css"));
  assert.ok(html.endsWith(source));
});

void test("an unknown source hash is a 404 nothing keeps", async (t) => {
  mockSourceStore(t);
  const response = await handleCamoxRequest(
    artifactRequest(await currentShellHash(), await artifactSourceHash("<p>Never stored</p>")),
    runtimeOptions(),
  );

  assert.equal(response?.status, 404);
  assert.equal(response!.headers.get("Cache-Control"), "no-store");
});

void test("a release that changes neither the runtime nor the font links keeps the shell hash", async (t) => {
  mockSourceStore(t);
  const sourceHash = await artifactSourceHash(source);
  const before = await currentShellHash();
  const nextRelease = runtimeOptions({
    ...document,
    title: "Renamed website",
    meta: [{ name: "description", content: "New description" }],
    script: [{ src: "/analytics.js" }],
  });
  const kept = await handleCamoxRequest(artifactRequest(before, sourceHash), nextRelease);
  assert.match(kept!.headers.get("Cache-Control")!, /immutable/);

  const newFonts = runtimeOptions({
    link: [{ rel: "stylesheet", href: "https://fonts.test/geist.css" }],
  });
  const replaced = await handleCamoxRequest(artifactRequest(before, sourceHash), newFonts);
  assert.equal(replaced!.headers.get("Cache-Control"), "no-store");
});

void test("an artifact's document is the same for every visitor, and never a page", async (t) => {
  const requests = mockSourceStore(t);
  const options = runtimeOptions();
  const request = artifactRequest(await currentShellHash(), await artifactSourceHash(source), {
    headers: { Accept: "*/*", Cookie: "camox_auth_cookie=member-token" },
  });

  assert.equal(shouldHandleRequest(request, ""), true);
  assert.equal(
    isPublicRequest(request, options),
    false,
    "it's cached by its URL, not as a public render",
  );
  const response = await handleCamoxRequest(request, options);
  assert.equal(response?.status, 200);
  assert.match(response!.headers.get("Cache-Control")!, /public/);
  assert.equal(response!.headers.get("Set-Cookie"), null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.headers.get("Cookie"), null);
});

void test("a mounted runtime serves artifacts under its base path", async (t) => {
  mockSourceStore(t);
  const path = `/site/_camox/artifacts/${await currentShellHash()}/${await artifactSourceHash(source)}`;
  const request = new Request(`https://site.test${path}`);

  assert.equal(shouldHandleRequest(request, "/site"), true);
  const response = await handleCamoxRequest(request, {
    ...runtimeOptions(),
    runtimeBasePath: "/site",
  });
  assert.equal(response?.status, 200);
  assert.ok((await response!.text()).endsWith(source));
});
