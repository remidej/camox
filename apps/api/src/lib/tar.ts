/** A file to archive: its content, or where a symlink points, by path from the archive's root. */
export type TarEntry =
  | { path: string; mode: number; content: Uint8Array }
  | { path: string; symlink: string };

const BLOCK = 512;
const encoder = new TextEncoder();

/** A ustar header for `name`, with a PAX record of the whole path before it when it's long. */
function header(
  entry: { path: string; type: "0" | "2" | "x"; mode: number; size: number; link?: string },
  name: string,
) {
  const block = new Uint8Array(BLOCK);
  const put = (at: number, length: number, value: string) =>
    block.set(encoder.encode(value).subarray(0, length), at);
  const octal = (at: number, length: number, value: number) =>
    put(at, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
  put(0, 100, name);
  octal(100, 8, entry.mode);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, entry.size);
  octal(136, 12, 0);
  put(148, 8, "        ");
  put(156, 1, entry.type);
  if (entry.link) put(157, 100, entry.link);
  put(257, 8, "ustar\u000000");
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  put(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

const padding = (size: number) => new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);

/** A PAX extended header recording `path`, for a path ustar's name field can't hold. */
function longPath(path: string) {
  const record = (length: number) => `${length} path=${path}\n`;
  let length = encoder.encode(record(0)).byteLength;
  while (encoder.encode(record(length)).byteLength !== length) {
    length = encoder.encode(record(length)).byteLength;
  }
  const body = encoder.encode(record(length));
  return [
    header({ path, type: "x", mode: 0o644, size: body.byteLength }, "././@PaxHeader"),
    body,
    padding(body.byteLength),
  ];
}

/** A tar archive of `entries`, as `tar -xf` reads it. */
export function tar(entries: TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const name = encoder.encode(entry.path).byteLength > 100 ? entry.path.slice(-100) : entry.path;
    if (name !== entry.path) parts.push(...longPath(entry.path));
    if ("symlink" in entry) {
      parts.push(
        header({ path: entry.path, type: "2", mode: 0o777, size: 0, link: entry.symlink }, name),
      );
    } else {
      const size = entry.content.byteLength;
      parts.push(header({ path: entry.path, type: "0", mode: entry.mode, size }, name));
      parts.push(entry.content, padding(size));
    }
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    archive.set(part, at);
    at += part.byteLength;
  }
  return archive;
}

/**
 * The regular files of a gzipped tar archive, by path. It reads ustar names with their prefix,
 * and long names from PAX `path` records (bsdtar, and `tar()`) or GNU `L` records (GNU tar, which
 * the revision sandboxes run). Mirrored from apps/dispatch/src/tar.ts: keep the two in sync.
 */
export async function untarGzip(archive: ReadableStream<Uint8Array>) {
  const tar = new Uint8Array(
    await new Response(archive.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
  );
  const decoder = new TextDecoder();
  const field = (at: number, length: number) =>
    decoder.decode(tar.subarray(at, at + length)).replace(/\0.*$/s, "");
  const files = new Map<string, Uint8Array>();
  let longPath: string | undefined;
  for (let at = 0; at + BLOCK <= tar.byteLength;) {
    const name = field(at, 100);
    if (!name) break;
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const type = field(at + 156, 1);
    const magic = field(at + 257, 6);
    // POSIX ustar has a name prefix there; GNU tar (magic "ustar  ") keeps other fields there.
    const prefix = magic === "ustar" ? field(at + 345, 155) : "";
    const body = tar.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      longPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(decoder.decode(body))?.[1] ?? longPath;
      continue;
    }
    if (type === "L") {
      longPath = decoder.decode(body).replace(/\0.*$/s, "");
      continue;
    }
    const path = longPath ?? (prefix ? `${prefix}/${name}` : name);
    longPath = undefined;
    if (type === "0" || type === "") files.set(path.replace(/^\.\//, ""), body);
  }
  return files;
}
