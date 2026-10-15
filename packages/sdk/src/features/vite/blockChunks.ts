import { relative } from "node:path";

interface BundleChunk {
  type: "chunk";
  fileName: string;
  imports: string[];
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
}

type Bundle = Record<string, BundleChunk | { type: "asset" }>;

const BLOCK_MODULE = /^src\/(camox\/)?blocks\/[^/]+\.tsx?$/;

/**
 * The chunks the browser must load to render each block, by the block's module path (as the
 * app's globs name it). Chunks every entry already loads are left out: they need no preload.
 */
export function collectBlockChunks(bundle: Bundle, root: string): Record<string, string[]> {
  const chunks = new Map<string, BundleChunk>();
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") chunks.set(output.fileName, output);
  }
  const withImports = (fileName: string, into = new Set<string>()) => {
    if (into.has(fileName)) return into;
    into.add(fileName);
    for (const imported of chunks.get(fileName)?.imports ?? []) withImports(imported, into);
    return into;
  };

  const loadedByEntries = new Set<string>();
  for (const chunk of chunks.values()) {
    if (chunk.isEntry) withImports(chunk.fileName, loadedByEntries);
  }

  const blockChunks: Record<string, string[]> = {};
  for (const chunk of chunks.values()) {
    if (!chunk.isDynamicEntry || !chunk.facadeModuleId) continue;
    const modulePath = relative(root, chunk.facadeModuleId).replaceAll("\\", "/");
    if (!BLOCK_MODULE.test(modulePath)) continue;
    blockChunks[`/${modulePath}`] = [...withImports(chunk.fileName)].filter(
      (fileName) => !loadedByEntries.has(fileName),
    );
  }
  return blockChunks;
}
