import { openAsBlob } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import type { resolveCommandContext } from "./dispatch";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

export type UploadOptions = {
  file?: string;
  url?: string;
  filename?: string;
  alt?: string;
  aiMetadata?: "on" | "off";
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { __cliError: { code, message } });
}

export function validateMetadata(options: Pick<UploadOptions, "alt" | "aiMetadata">) {
  if (options.alt !== undefined && options.aiMetadata === "on") {
    fail("INVALID_ARGS", "--alt cannot be combined with --ai-metadata on.");
  }
}

export function validateUpload(options: UploadOptions) {
  if ((options.file !== undefined) === (options.url !== undefined)) {
    fail("INVALID_ARGS", "Pass exactly one of --file or --url.");
  }
  validateMetadata(options);
  validateFilename(options.filename);
}

export function validateFilename(filename?: string) {
  if (
    filename !== undefined &&
    (!filename.trim() ||
      /[\\/]/.test(filename) ||
      filename
        .split("")
        .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      filename === "." ||
      filename === "..")
  ) {
    fail(
      "INVALID_ARGS",
      "--filename must be a non-empty filename without directories or control characters.",
    );
  }
}

function httpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("DOWNLOAD_FAILED", "Invalid media URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    fail("DOWNLOAD_FAILED", "Media URLs must use HTTP(S) without embedded credentials.");
  }
  return url;
}

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain",
  ".json": "application/json",
};

function mimeType(filename: string) {
  return MIME_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

async function download(source: string, destination: string) {
  // Never include the URL (which may contain signing credentials) in errors.
  try {
    let url = httpUrl(source);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await fetch(url, { redirect: "manual", signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) {
          fail("DOWNLOAD_FAILED", "Missing redirect location or too many redirects.");
        }
        url = httpUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        fail("DOWNLOAD_FAILED", `Media download failed (HTTP ${response.status}).`);
      }
      if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) {
        await response.body.cancel();
        fail("FILE_TOO_LARGE", "File exceeds the 100 MiB limit.");
      }
      const file = await open(destination, "w");
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > MAX_FILE_BYTES) fail("FILE_TOO_LARGE", "File exceeds the 100 MiB limit.");
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      const filename = basename(decodeURIComponent(url.pathname)) || "upload";
      return {
        filename,
        mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || mimeType(filename),
      };
    }
    return fail("DOWNLOAD_FAILED", "Too many redirects.");
  } catch (error) {
    if (error && typeof error === "object" && "__cliError" in error) throw error;
    return fail(
      "DOWNLOAD_FAILED",
      "Could not download media (network, timeout, or local I/O failure).",
    );
  }
}

export async function uploadFile(
  context: Awaited<ReturnType<typeof resolveCommandContext>>,
  options: UploadOptions,
  targetId?: number,
): Promise<unknown> {
  validateUpload(options);
  let temporaryDirectory: string | undefined;
  try {
    let path = options.file;
    let filename = path ? basename(path) : "upload";
    let type = mimeType(filename);
    if (options.url !== undefined) {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "camox-upload-"));
      path = join(temporaryDirectory, "download");
      const downloaded = await download(options.url, path);
      filename = downloaded.filename;
      type = downloaded.mimeType;
    }
    if (!path) fail("INVALID_ARGS", "Provide a file path.");
    const info = await stat(path);
    if (!info.isFile()) fail("INVALID_ARGS", "Upload source must be a regular file.");
    if (info.size > MAX_FILE_BYTES) fail("FILE_TOO_LARGE", "File exceeds the 100 MiB limit.");
    const body = new FormData();
    if (type === "application/octet-stream") type = mimeType(options.filename ?? filename);
    body.set("file", await openAsBlob(path, { type }), options.filename ?? filename);
    body.set("projectId", String(context.projectId));
    if (options.alt !== undefined) body.set("alt", options.alt);
    if (options.aiMetadata !== undefined || options.alt !== undefined) {
      body.set(
        "aiMetadataEnabled",
        String(options.alt === undefined && options.aiMetadata === "on"),
      );
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${context.token}`,
      "x-camox-client": "cli",
      "x-environment-name": context.environmentName,
    };
    if (context.disableTelemetry) headers["x-camox-telemetry-disabled"] = "1";
    let response: Response;
    try {
      const endpoint = targetId === undefined ? "/files/upload" : `/files/${targetId}/content`;
      response = await fetch(`${context.apiUrl}${endpoint}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      return fail(
        "UPLOAD_FAILED",
        targetId === undefined
          ? "Media upload failed (network or timeout). Check files list before retrying."
          : `File replacement failed (network or timeout). Check files get --id ${targetId} before retrying.`,
      );
    }
    if (!response.ok) {
      // Do not echo arbitrary server bodies, which may contain sensitive data.
      const operation = targetId === undefined ? "Media upload" : "File replacement";
      fail("UPLOAD_FAILED", `${operation} failed (HTTP ${response.status}).`);
    }
    return await response.json();
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
