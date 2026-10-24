/**
 * The regular files of a gzipped tar archive, by path. It reads ustar names with their prefix,
 * and long names from PAX `path` records (bsdtar, and the API's own `tar()`) or GNU `L` records
 * (GNU tar, which the revision sandboxes run).
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
  for (let at = 0; at + 512 <= tar.byteLength;) {
    const name = field(at, 100);
    if (!name) break;
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const type = field(at + 156, 1);
    const magic = field(at + 257, 6);
    // POSIX ustar has a name prefix there; GNU tar (magic "ustar  ") keeps other fields there.
    const prefix = magic === "ustar" ? field(at + 345, 155) : "";
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
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
