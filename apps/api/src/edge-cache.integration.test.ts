import { artifactSourceHash } from "@camox/api-contract";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture } from "../test/fixtures";
import app from "./index";
import { artifactSources } from "./schema";
import type { Bindings } from "./types";

const bucket = () => (env as unknown as Bindings).FILES_BUCKET;

/** Stores a file's bytes as an upload does, under a key of its own. */
async function storedFile(bytes: string) {
  const key = `1/${crypto.randomUUID()}`;
  await bucket().put(key, bytes, { httpMetadata: { contentType: "text/plain" } });
  return { key, url: `https://api.camox.ai/files/serve/${key}` };
}

describe("a stored file, as the edge caches it", () => {
  it("is answered whole, kept for good and tagged with its key, so its deletion can purge it", async () => {
    const { key, url } = await storedFile("0123456789");

    const response = await SELF.fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("Cache-Tag")).toBe(`file:${key}`);
  });

  it("answers a Range request with the bytes it names", async () => {
    const { url } = await storedFile("0123456789");

    const response = await SELF.fetch(url, { headers: { Range: "bytes=2-5" } });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
  });

  it("answers a suffix Range request with the file's last bytes", async () => {
    const { url } = await storedFile("0123456789");

    const response = await SELF.fetch(url, { headers: { Range: "bytes=-3" } });

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("789");
  });

  it("answers HEAD with the file's length and no body", async () => {
    const { url } = await storedFile("0123456789");

    const response = await SELF.fetch(url, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(await response.text()).toBe("");
  });

  it("is not kept when it's missing, so a file stored later isn't hidden", async () => {
    const response = await SELF.fetch(`https://api.camox.ai/files/serve/1/${crypto.randomUUID()}`);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("a project's Live cache key", () => {
  it("is tagged with its project, so a change to its Live purges it", async () => {
    const { project } = await createProjectFixture(`live-key-${crypto.randomUUID()}`);

    const response = await SELF.fetch(`https://api.camox.ai/live-cache-keys/${project.uuid}`);

    expect(response.status).toBe(200);
    expect(await response.text()).not.toBe("");
    expect(response.headers.get("Cache-Control")).toMatch(/^public, max-age=\d+$/);
    expect(response.headers.get("Cache-Tag")).toBe(`live:${project.id}`);
  });

  it("is not found for a project that doesn't exist, and the edge doesn't keep that", async () => {
    const response = await SELF.fetch(
      `https://api.camox.ai/live-cache-keys/${crypto.randomUUID()}`,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("a project's favicon", () => {
  it("is tagged with its project, also while the default stands in for it", async () => {
    const { project } = await createProjectFixture(`favicon-tag-${crypto.randomUUID()}`);

    const response = await SELF.fetch(
      `https://api.camox.ai/favicons/${project.id}?v=1&default=camox`,
    );

    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Tag")).toBe(`favicon:${project.id}`);
  });
});

describe("a project's artifact source", () => {
  it("is kept for good once stored, since its hash names one source for good", async () => {
    const { db, project } = await createProjectFixture(`artifact-edge-${crypto.randomUUID()}`);
    const source = `<title>Kept</title><p>${crypto.randomUUID()}</p>`;
    const hash = await artifactSourceHash(source);
    await db
      .insert(artifactSources)
      .values({ projectId: project.id, hash, source, createdAt: Date.now() });

    const response = await SELF.fetch(
      `https://api.camox.ai/artifact-sources/${project.uuid}/${hash}`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(source);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("is not kept while it's missing, by the edge or from the API's own answer, so a source stored later isn't hidden", async () => {
    const { project } = await createProjectFixture(`artifact-edge-${crypto.randomUUID()}`);
    const hash = await artifactSourceHash(crypto.randomUUID());
    const path = `/artifact-sources/${project.uuid}/${hash}`;

    const throughEdge = await SELF.fetch(`https://api.camox.ai${path}`);
    // The API's answer before the edge entrypoint sees it, as any cache in front of it would.
    const fromApi = await app.request(path, {}, env);

    for (const response of [throughEdge, fromApi]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});
