import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { openRouterModel } from "./open-router-model";

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@tanstack/ai", () => ({ chat }));

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

const request = {
  url: "http://localhost/files/serve/test.png",
  mimeType: "image/png",
  filename: "test.png",
};

/** Asks the adapter for an image's metadata, past every retry. */
async function imageMetadata() {
  const result = Effect.runPromise(openRouterModel("test-api-key").imageMetadata(request));
  const settled = result.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  return settled;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  chat.mockReset();
});

describe("image metadata", () => {
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

  it.each(failures)("fails on $name without asking the model", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));

    expect(await imageMetadata()).toMatchObject({ _tag: "AiCallError" });
    expect(chat).not.toHaveBeenCalled();
  });

  it("shows the model the image, as data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(png, { headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
        ),
    );
    const metadata = { filename: "generated", alt: "Generated description" };
    chat.mockResolvedValue(metadata);

    expect(await imageMetadata()).toEqual(metadata);
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
  });
});
