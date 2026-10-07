import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { mp4Metadata, optimizeVideo } from "./video-optimization";

function box(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(payload, 8);
  return bytes;
}

function mp4(seconds: number, width = 1280, height = 720, size = 1024 * 1024 + 1024): File {
  const mvhd = new Uint8Array(20);
  const view = new DataView(mvhd.buffer);
  view.setUint32(12, 1000);
  view.setUint32(16, seconds * 1000);
  const tkhd = new Uint8Array(8);
  new DataView(tkhd.buffer).setUint32(0, width * 65536);
  new DataView(tkhd.buffer).setUint32(4, height * 65536);
  return new File(
    [
      box("ftyp", new Uint8Array(4)),
      box("mdat", new Uint8Array(size)),
      box("moov", new Uint8Array([...box("mvhd", mvhd), ...box("trak", box("tkhd", tkhd))])),
    ],
    "clip.mp4",
    { type: "video/mp4" },
  );
}

describe("video optimization", () => {
  it("reads movie duration and dimensions even when metadata follows video data", async () => {
    expect(await mp4Metadata(mp4(60))).toEqual({ duration: 60, width: 1280, height: 720 });
    expect(await mp4Metadata(mp4(61))).toEqual({ duration: 61, width: 1280, height: 720 });
    expect(await mp4Metadata(new File(["not an MP4"], "bad.mp4"))).toBeNull();
    expect(
      await mp4Metadata(new File([box("moov", box("mvhd", new Uint8Array()))], "bad.mp4")),
    ).toBeNull();
  });

  it("uses a shorter optimized rendition only when it is at least 10% smaller", async () => {
    const put = vi.fn().mockResolvedValue({});
    const bucket = { put } as unknown as R2Bucket;
    const rendition = mp4(12, 1280, 720, 100_000);
    const response = vi.fn().mockResolvedValue(new Response(rendition));
    const transform = vi.fn().mockReturnValue({ output: vi.fn().mockReturnValue({ response }) });
    const input = vi.fn().mockReturnValue({ transform });
    const media = {
      input,
    } as unknown as MediaBinding;
    const file = mp4(12);
    expect(await Effect.runPromise(optimizeVideo(file, "1/file", bucket, media))).toEqual({
      key: "1/file.optimized.mp4",
      size: rendition.size,
    });
    expect(put).toHaveBeenCalledWith("1/file.optimized.mp4", expect.any(Uint8Array), {
      httpMetadata: { contentType: "video/mp4" },
    });
    expect(transform).toHaveBeenCalledWith({ width: 1280, height: 720, fit: "scale-down" });
    expect(await Effect.runPromise(optimizeVideo(mp4(61), "1/long", bucket, media))).toBeNull();
    expect(input).toHaveBeenCalledTimes(1);

    response.mockResolvedValueOnce(new Response(new Uint8Array(file.size)));
    expect(
      await Effect.runPromise(optimizeVideo(mp4(12, 3024, 1888), "1/not-smaller", bucket, media)),
    ).toBeNull();
    expect(transform).toHaveBeenLastCalledWith({ width: 2000, height: 1888, fit: "scale-down" });
    expect(put).toHaveBeenCalledTimes(1);

    response.mockResolvedValueOnce(new Response(mp4(12, 640, 360, 100_000)));
    expect(
      await Effect.runPromise(optimizeVideo(file, "1/low-resolution", bucket, media)),
    ).toBeNull();
    expect(put).toHaveBeenCalledTimes(1);
  });
});
