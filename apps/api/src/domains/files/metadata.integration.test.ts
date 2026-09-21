import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProjectFixture } from "../../../test/fixtures";
import { files } from "../../schema";
import { executeFileMetadata } from "./service";

const { chat } = vi.hoisted(() => {
  vi.resetModules();
  return { chat: vi.fn() };
});
vi.mock("@tanstack/ai", () => ({ chat }));

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

async function fixture() {
  const { db, project, environment } = await createProjectFixture(crypto.randomUUID());
  const file = await db
    .insert(files)
    .values({
      projectId: project.id,
      environmentId: environment.id,
      url: "http://localhost/files/serve/test.png",
      alt: "Existing description",
      filename: "existing.png",
      mimeType: "image/png",
      size: png.length,
      blobId: crypto.randomUUID(),
      path: "/",
      aiMetadataEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning()
    .get();
  return { db, file };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("metadata image validation", () => {
  const failures = [
    { name: "network failure", response: () => Promise.reject(new Error("Network failure")) },
    {
      name: "HTTP 404",
      response: () => new Response(png, { status: 404, headers: { "content-type": "image/png" } }),
    },
    { name: "HTTP 500", response: () => new Response("Server error", { status: 500 }) },
    {
      name: "HTML",
      response: () =>
        new Response("<html>Not found</html>", { headers: { "content-type": "text/html" } }),
    },
    { name: "missing content type", response: () => new Response(png) },
    {
      name: "unsupported image type",
      response: () => new Response(png, { headers: { "content-type": "image/svg+xml" } }),
    },
    {
      name: "unsupported raster type",
      response: () => new Response(png, { headers: { "content-type": "image/avif" } }),
    },
    {
      name: "HTML labeled as an image",
      response: () =>
        new Response("<html>Not found</html>", { headers: { "content-type": "image/jpeg" } }),
    },
    {
      name: "empty image",
      response: () => new Response(null, { headers: { "content-type": "image/webp" } }),
    },
    {
      name: "mismatched image type",
      response: () => new Response(png, { headers: { "content-type": "image/jpeg" } }),
    },
    {
      name: "body read failure",
      response: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("Read failed"));
            },
          }),
          { headers: { "content-type": "image/png" } },
        ),
    },
  ];

  it.each(failures)(
    "rejects $name without invoking AI or changing metadata",
    async ({ response }) => {
      const { db, file } = await fixture();
      vi.stubGlobal("fetch", vi.fn().mockImplementation(response));

      await expect(executeFileMetadata(db, "test-api-key", file.id)).rejects.toThrow();

      expect(chat).not.toHaveBeenCalled();
      expect(await db.select().from(files).where(eq(files.id, file.id)).get()).toEqual(file);
    },
  );

  it("generates and saves metadata for a valid image", async () => {
    const { db, file } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(png, {
          headers: { "content-type": "IMAGE/PNG; charset=binary" },
        }),
      ),
    );
    const metadata = { filename: "generated", alt: "Generated description" };
    chat.mockResolvedValue(metadata);

    await executeFileMetadata(db, "test-api-key", file.id);

    expect(chat).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image",
                source: {
                  type: "data",
                  value: btoa(String.fromCharCode(...png)),
                  mimeType: "image/png",
                },
              }),
            ]),
          }),
        ],
      }),
    );
    expect(await db.select().from(files).where(eq(files.id, file.id)).get()).toMatchObject(
      metadata,
    );
  });
});
