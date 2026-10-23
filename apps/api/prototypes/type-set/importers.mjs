// PROTOTYPE, throwaway (#556). The working copy's import graph, from source text alone (no
// parser, no type set): what a Durable Object could run on every turn before the check.
//
// Edges: `import … from`, `export … from`, `import "x"`, `import("x")`, for specifiers that
// are relative or start with the tsconfig's `@/` alias. Package imports are not edges.

const IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s[^'"]*?\sfrom\s*["']([^"']+)["']|(?:^|[;\s])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
const EXTS = ["", ".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"];

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function resolve(files, from, spec) {
  let base;
  if (spec.startsWith("@/")) base = "/project/src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = new URL(spec, "file://" + from).pathname;
  else return null;
  for (const ext of EXTS) if (files[base + ext] !== undefined) return base + ext;
  return undefined; // unresolved: a new file the check will report anyway
}

/** { importers: Map<file, Set<file>>, imports: Map<file, Set<file>> } over /project/src/. */
export function importGraph(files) {
  const imports = new Map();
  const importers = new Map();
  const src = Object.keys(files).filter((p) => p.startsWith("/project/src/") && /\.tsx?$/.test(p));
  for (const f of src) { imports.set(f, new Set()); importers.set(f, new Set()); }
  for (const f of src) {
    for (const m of stripComments(files[f]).matchAll(IMPORT_RE)) {
      const to = resolve(files, f, m[1] ?? m[2] ?? m[3]);
      if (!to) continue;
      imports.get(f).add(to);
      importers.get(to)?.add(f);
    }
  }
  return { imports, importers, src };
}

/** Files whose types can't be found from import edges: ambient declarations, tsconfig. */
export function isAmbient(path, text) {
  return path === "/project/tsconfig.json" || path.endsWith(".d.ts") || /\bdeclare\s+(global|module)\b/.test(text ?? "");
}

export function directImporters(graph, changed) {
  const out = new Set(changed);
  for (const c of changed) for (const i of graph.importers.get(c) ?? []) out.add(i);
  return out;
}

export function transitiveImporters(graph, changed) {
  const out = new Set(changed);
  const queue = [...changed];
  while (queue.length) for (const i of graph.importers.get(queue.pop()) ?? []) if (!out.has(i)) { out.add(i); queue.push(i); }
  return out;
}

export function transitiveImports(graph, roots) {
  const out = new Set(roots);
  const queue = [...roots];
  while (queue.length) for (const i of graph.imports.get(queue.pop()) ?? []) if (!out.has(i)) { out.add(i); queue.push(i); }
  return out;
}
