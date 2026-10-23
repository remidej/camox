import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { publicFilesInHashedDirs, staticAssetHeaders, unhashedEntries } from "./staticAssetHeaders";

/** The headers a file gets, as Workers Static Assets applies `_headers` rules. */
function headersFor(file: string, headers: string): Map<string, string[]> {
  const applied = new Map<string, string[]>();
  let matches = false;
  for (const line of headers.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\S/.test(line)) {
      const pattern = new RegExp(`^${line.replaceAll(".", "\\.").replace("*", ".*")}$`);
      matches = pattern.test(file);
    } else if (matches) {
      const detached = /^\s+!\s*(.+)$/.exec(line);
      if (detached) applied.delete(detached[1]!.trim().toLowerCase());
      else {
        const [name, ...value] = line.trim().split(":");
        const key = name!.toLowerCase();
        applied.set(key, [...(applied.get(key) ?? []), value.join(":").trim()]);
      }
    }
  }
  return applied;
}

const bundle = {
  "_chunks/camox-page-client.mjs": {
    type: "chunk" as const,
    fileName: "_chunks/camox-page-client.mjs",
    isEntry: true,
  },
  "_chunks/camox-studio-client.mjs": {
    type: "chunk" as const,
    fileName: "_chunks/camox-studio-client.mjs",
    isEntry: true,
  },
  "_chunks/hero-Bx7f.mjs": {
    type: "chunk" as const,
    fileName: "_chunks/hero-Bx7f.mjs",
    isEntry: false,
  },
  "assets/styles-XZscXl4x.css": { type: "asset" as const, fileName: "assets/styles-XZscXl4x.css" },
};

void test("files named by their content's hash are kept for good", () => {
  const headers = staticAssetHeaders({ unhashedFiles: unhashedEntries(bundle) });

  for (const file of ["/assets/styles-XZscXl4x.css", "/_chunks/hero-Bx7f.mjs"]) {
    assert.deepEqual(
      headersFor(file, headers).get("cache-control"),
      ["public, max-age=31536000, immutable"],
      file,
    );
  }
});

void test("the entry chunks pages load by a fixed name keep revalidating", () => {
  const headers = staticAssetHeaders({ unhashedFiles: unhashedEntries(bundle) });

  for (const file of ["/_chunks/camox-page-client.mjs", "/_chunks/camox-studio-client.mjs"]) {
    assert.equal(headersFor(file, headers).get("cache-control"), undefined, file);
  }
});

void test("files the public directory puts under the hashed directories keep revalidating", () => {
  const publicDir = mkdtempSync(join(tmpdir(), "camox-public-"));
  mkdirSync(join(publicDir, "assets/logos"), { recursive: true });
  writeFileSync(join(publicDir, "assets/logos/brand.svg"), "<svg/>");
  writeFileSync(join(publicDir, "robots.txt"), "");

  const unhashedFiles = publicFilesInHashedDirs(publicDir);
  const headers = staticAssetHeaders({ unhashedFiles });

  assert.deepEqual(unhashedFiles, ["assets/logos/brand.svg"]);
  assert.equal(headersFor("/assets/logos/brand.svg", headers).get("cache-control"), undefined);
});

void test("the app's own _headers rules are kept", () => {
  const headers = staticAssetHeaders({
    ownHeaders: "/*\n  X-Frame-Options: DENY\n",
    unhashedFiles: [],
  });

  assert.deepEqual(headersFor("/assets/a-1.css", headers).get("x-frame-options"), ["DENY"]);
  assert.deepEqual(headersFor("/assets/a-1.css", headers).get("cache-control"), [
    "public, max-age=31536000, immutable",
  ]);
});

void test("a build whose _headers would hold more rules than Workers read fails, saying why", () => {
  const unhashedFiles = Array.from({ length: 100 }, (_, index) => `assets/file-${index}.png`);

  assert.throws(() => staticAssetHeaders({ unhashedFiles }), /past Workers Static Assets' 100/);
});
