// A Git bundle, as `git bundle create` writes it and `camox push` sends it: a header naming the
// commits the bundle's own build on (its prerequisites) and the refs it carries, then a packfile.
// Only v2 bundles, SHA-1 repos', are read: v3 only adds capabilities Camox's repos don't use.

const SIGNATURE = "# v2 git bundle\n";
const OID = /^[0-9a-f]{40}$/;

export type Bundle = {
  /** The commits the bundle's commits build on, which it doesn't hold. */
  prerequisites: string[];
  /** The refs it carries, with the commits they point to. */
  refs: { ref: string; oid: string }[];
  /** Its objects, as a packfile, maybe thin: deltas may build on the prerequisites' objects. */
  pack: Uint8Array;
};

/** Reads a bundle, or returns undefined when `bytes` isn't one. */
export function parseBundle(bytes: Uint8Array): Bundle | undefined {
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(0, SIGNATURE.length)) !== SIGNATURE) return undefined;
  const prerequisites: string[] = [];
  const refs: Bundle["refs"] = [];
  let at = SIGNATURE.length;
  for (;;) {
    const end = bytes.indexOf(0x0a, at);
    if (end === -1) return undefined;
    const line = decoder.decode(bytes.subarray(at, end));
    at = end + 1;
    if (line === "") break;
    if (line.startsWith("-")) {
      const oid = line.slice(1, 41);
      if (!OID.test(oid)) return undefined;
      prerequisites.push(oid);
      continue;
    }
    const [oid, ref] = line.split(" ");
    if (!oid || !OID.test(oid) || !ref) return undefined;
    refs.push({ oid, ref });
  }
  const pack = bytes.subarray(at);
  if (decoder.decode(pack.subarray(0, 4)) !== "PACK") return undefined;
  return { prerequisites, refs, pack };
}
