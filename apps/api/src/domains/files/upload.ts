import { isPrivateOrLocalHost } from "agents/webfetch";
import { Effect } from "effect";
import type { z } from "zod";

import { InvalidInputError } from "../../lib/errors";
import { isRasterImage } from "../../lib/image-transform";
import type { ServiceContext } from "../_shared/service-context";
import { accessTo } from "../drafts/access";
import { imageDimensions } from "./image-dimensions";
import * as service from "./service";
import { optimizeVideo } from "./video-optimization";

/** The largest file the upload route takes. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Stores an uploaded file as a new file in the draft the context names, or as new content for
 * `targetId`, keeping its id. The blob is stored before the row is written, and deleted again
 * when the write fails. Stored files' URLs start with `apiOrigin`, where `/files/serve` serves
 * them.
 */
export const storeUpload = (
  ctx: ServiceContext,
  upload: {
    projectId: number;
    file: File;
    metadata: z.output<typeof service.fileMetadataInput>;
    apiOrigin: string;
    /** The file whose content the upload replaces. */
    targetId?: string;
    /** A client-minted id for the new file, for optimistic inserts. */
    newId?: string;
  },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { projectId, file, metadata, apiOrigin, targetId, newId } = upload;
      const filename = file.name.split(/[\\/]/).pop() || "upload";
      // Reject a missing target before storing any blob.
      const bound = { ...ctx, projectId };
      const target =
        targetId === undefined ? undefined : yield* accessTo(bound, { file: targetId }, "write");
      const { scope } = target ?? (yield* accessTo(bound, { project: projectId }, "write"));

      // Keep storage URLs independent of filenames (spaces, Unicode, URL delimiters).
      const key = `${projectId}/${crypto.randomUUID()}`;
      yield* Effect.promise(() =>
        ctx.env.FILES_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } }),
      );
      const optimized = yield* optimizeVideo(file, key, ctx.env.FILES_BUCKET, ctx.env.MEDIA);
      // Image headers sit near the start of the file: a JPEG's frame follows its metadata.
      const dimensions = isRasterImage(file.type)
        ? imageDimensions(
            new Uint8Array(yield* Effect.promise(() => file.slice(0, 512 * 1024).arrayBuffer())),
          )
        : null;
      const asset = {
        blobId: key,
        path: key,
        url: `${apiOrigin}/files/serve/${optimized?.key ?? key}`,
        filename,
        mimeType: file.type,
        size: file.size,
        optimizedSize: optimized?.size ?? null,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      };

      const now = Date.now();
      const write = target
        ? service.replaceFileContent(ctx, target, asset, metadata)
        : service.createFile(
            ctx,
            {
              ...(newId === undefined ? {} : { id: newId }),
              ...asset,
              projectId,
              createdAt: now,
              updatedAt: now,
            },
            metadata,
            scope,
          );
      // A failed write must not leave an orphaned blob.
      return yield* write.pipe(Effect.onError(() => service.deleteUnreferencedBlobs(ctx, [key])));
    }),
  );

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const mimeTypeOf = (filename: string) =>
  MIME_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** A URL path's last segment, decoded when it can be. */
const lastSegment = (pathname: string) => {
  const segment = pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const downloadFailed = (message: string) => new InvalidInputError({ message });

/** A public HTTP(S) URL, which a download may start at or be redirected to. */
const httpUrl = (value: string, base?: URL) =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(value, base),
      catch: () => downloadFailed("The file's URL isn't a valid URL."),
    });
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return yield* downloadFailed("The file's URL must be HTTP(S), with no credentials in it.");
    }
    // As the agent's `web_fetch` does: a download never reaches a private or local address.
    if (isPrivateOrLocalHost(url.hostname)) {
      return yield* downloadFailed("The file's URL is a private or local address.");
    }
    return url;
  });

/**
 * Downloads a public file to upload it, as a `File` named after the last path segment of the
 * URL it ends at, unless `filename` names it. Follows a few redirects, and stops at `maxBytes`.
 * Errors never repeat the URL, which may hold a signature.
 */
export const downloadUpload = Effect.fn("files.downloadUpload")(function* (
  source: string,
  { maxBytes, filename: named }: { maxBytes: number; filename?: string },
) {
  const tooLarge = () =>
    downloadFailed(`The file is larger than the ${maxBytes / 1024 / 1024} MiB limit.`);
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let url = yield* httpUrl(source);
  for (let redirects = 0; ; redirects++) {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { redirect: "manual", signal }),
      catch: () => downloadFailed("The file couldn't be downloaded (network error or timeout)."),
    });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      yield* Effect.promise(async () => response.body?.cancel());
      if (!location || redirects === MAX_REDIRECTS) {
        return yield* downloadFailed("The file's URL redirects too many times, or nowhere.");
      }
      url = yield* httpUrl(location, url);
      continue;
    }
    if (!response.ok || !response.body) {
      yield* Effect.promise(async () => response.body?.cancel());
      return yield* downloadFailed(`The file couldn't be downloaded (HTTP ${response.status}).`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      yield* Effect.promise(() => response.body!.cancel());
      return yield* tooLarge();
    }
    const body = response.body;
    const chunks = yield* Effect.tryPromise({
      try: async () => {
        const read: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of body) {
          size += chunk.byteLength;
          // Returning ends the iteration, which cancels the rest of the download.
          if (size > maxBytes) return null;
          read.push(chunk);
        }
        return read;
      },
      catch: () => downloadFailed("The file couldn't be downloaded (network error or timeout)."),
    });
    if (!chunks) return yield* tooLarge();
    const filename = named ?? (lastSegment(url.pathname) || "upload");
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    const mimeType = type && type !== "application/octet-stream" ? type : mimeTypeOf(filename);
    return new File(chunks, filename, { type: mimeType });
  }
});
