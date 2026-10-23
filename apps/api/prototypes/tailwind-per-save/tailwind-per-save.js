// PROTOTYPE, throwaway (issue #520): Tailwind CSS for a draft, in plain JavaScript.
// No native class scanner, no Lightning CSS. The same code runs in Node and in a Worker.
import { compile } from "tailwindcss";

// The class scanner is native, so candidates come from splitting the file's text, as
// Tailwind v3's default extractor did. Junk tokens are fine: build() ignores what isn't a
// utility. Each token is also added with punctuation trimmed off its ends, for `cn("a",`.
const SPLIT = /[\s"'`]+/;
const TRIM_START = /^[({,;<>=]+/;
const TRIM_END = /[),;:}{>.]+$/;
// Arbitrary values and variants can hold quotes (`[&_svg:not([class*='size-'])]:size-4`), so
// a second pass splits on whitespace only and keeps tokens with brackets.
function bracketed(content) {
  return content.split(/[\s"`]+/).filter((t) => t.includes("['") || t.includes("='"));
}
export function extract(content) {
  const out = new Set();
  for (const token of [...content.split(SPLIT), ...bracketed(content)]) {
    if (!token || token.length > 200) continue;
    out.add(token);
    const trimmed = token.replace(TRIM_START, "").replace(TRIM_END, "");
    if (trimmed && trimmed !== token) out.add(trimmed);
  }
  return out;
}

// Compiles the Theme. `@import "tailwindcss"` is served from Tailwind's own CSS files,
// bundled as text, so nothing is read from disk.
export function compileTheme(themeCss, tailwindFiles) {
  return compile(themeCss, {
    base: "/",
    async loadStylesheet(id, base) {
      const name = id === "tailwindcss" ? "index.css" : id.replace(/^tailwindcss\//, "").replace(/^\.\//, "");
      const content = tailwindFiles[name];
      if (content == null) throw new Error(`prototype: no stylesheet ${id} from ${base}`);
      return { path: name, base: "/", content };
    },
  });
}

export function union(candidatesByFile) {
  const all = new Set();
  for (const set of candidatesByFile.values()) for (const c of set) all.add(c);
  return [...all];
}

// A draft's whole stylesheet: the Theme compiled fresh, then built from every site file's
// candidates. Recomputed whole on each save, so utilities keep Tailwind's own order.
export async function draftCss(themeCss, tailwindFiles, candidatesByFile) {
  const compiler = await compileTheme(themeCss, tailwindFiles);
  return compiler.build(union(candidatesByFile));
}
