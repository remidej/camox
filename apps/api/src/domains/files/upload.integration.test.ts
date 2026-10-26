import { MAX_DOWNLOAD_BYTES } from "@camox/ai-tools";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import type { AppEnv } from "../../types";
import { callTool } from "../agent/service";
import { fileHonoRoutes } from "./routes";

/** The fake public website the tests download from (test/release-fakes.js). */
const WEBSITE = "https://website.camox.test";
const API_ORIGIN = "https://api.camox.test";

async function fixture() {
  const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
  // Tool writes land in a draft, which the first one starts: Live is read-only.
  const draft = { id: generateUuidv7(), create: true };
  const ctx = { ...createServiceContext(db, memberUser), draft, apiOrigin: API_ORIGIN };
  const invoke = (name: string, args: unknown) =>
    runService(callTool(ctx, { projectId: project.id, name, arguments: args }));
  const app = new Hono<AppEnv>().route("/files", fileHonoRoutes);
  /** The bytes the API serves at a stored file's URL. */
  const served = async (url: string) => {
    expect(url.startsWith(`${API_ORIGIN}/files/serve/`)).toBe(true);
    const response = await app.request(url.slice(API_ORIGIN.length), {}, env);
    return new TextDecoder().decode(await response.arrayBuffer());
  };
  const stored = async () =>
    (await env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects.length;
  return { invoke, served, stored };
}

describe("uploading a file from a URL", () => {
  it("stores a copy in the draft, served by the API under the URL's filename and type", async () => {
    const { invoke, served } = await fixture();

    const uploaded = await invoke("uploadFile", {
      url: `${WEBSITE}/media/team%20photo.png?type=image/png`,
      alt: "The team",
    });

    expect(uploaded).toMatchObject({
      ok: true,
      result: { filename: "team photo.png", mimeType: "image/png", alt: "The team" },
    });
    const { result } = uploaded as { result: { id: string; url: string } };
    expect(await served(result.url)).toBe("bytes of /media/team%20photo.png");
    expect(await invoke("listFiles", {})).toMatchObject({ ok: true, result: [{ id: result.id }] });
  });

  it("follows redirects, naming and typing the file after where they end", async () => {
    const { invoke, served } = await fixture();

    const uploaded = await invoke("uploadFile", {
      url: `${WEBSITE}/redirect?to=/media/brochure.pdf`,
      alt: "",
    });

    expect(uploaded).toMatchObject({
      ok: true,
      result: { filename: "brochure.pdf", mimeType: "application/pdf" },
    });
    expect(await served((uploaded as { result: { url: string } }).result.url)).toBe(
      "bytes of /media/brochure.pdf",
    );
  });

  it("names the file as asked", async () => {
    const { invoke } = await fixture();

    const uploaded = await invoke("uploadFile", {
      url: `${WEBSITE}/media/IMG_0042.jpg`,
      filename: "storefront.jpg",
      alt: "Our storefront",
    });

    expect(uploaded).toMatchObject({
      ok: true,
      result: { filename: "storefront.jpg", mimeType: "image/jpeg" },
    });
  });

  it("refuses private and local addresses, even through a redirect, storing nothing", async () => {
    const { invoke, stored } = await fixture();

    for (const url of [
      "http://localhost:8787/files/serve/secret",
      "http://10.0.0.1/logo.png",
      `${WEBSITE}/redirect?to=${encodeURIComponent("http://127.0.0.1/logo.png")}`,
    ]) {
      expect(await invoke("uploadFile", { url })).toMatchObject({
        ok: false,
        error: { message: expect.stringContaining("private or local address") },
      });
    }
    expect(await stored()).toBe(0);
  });

  it("refuses a file over the limit, storing nothing", async () => {
    const { invoke, stored } = await fixture();

    const uploaded = await invoke("uploadFile", {
      url: `${WEBSITE}/bytes?count=${MAX_DOWNLOAD_BYTES + 1}`,
    });

    expect(uploaded).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("larger than") },
    });
    expect(await stored()).toBe(0);
  });

  it("fails on a URL that doesn't answer with a file, without repeating the URL", async () => {
    const { invoke, stored } = await fixture();
    const url = `${WEBSITE}/redirect?signature=s3cr3t`;

    const uploaded = await invoke("uploadFile", { url });

    expect(uploaded).toMatchObject({ ok: false });
    expect(JSON.stringify(uploaded)).not.toContain("s3cr3t");
    expect(await stored()).toBe(0);
  });
});
