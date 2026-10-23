// PROTOTYPE, throwaway (issue #520): correctness against the native scanner and the CLI, and
// Node timings. Run `node make-site.mjs` first.
import { Scanner } from "@tailwindcss/oxide";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { compileTheme, draftCss, extract, union } from "./tailwind-per-save.js";

const { src, tailwind } = JSON.parse(readFileSync("site.json", "utf8"));
const theme = src["styles.css"];
const code = Object.entries(src).filter(([f]) => !f.endsWith(".css"));
const ms = (t) => +(performance.now() - t).toFixed(2);
const time = async (fn, n = 20) => {
  const runs = [];
  let out;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    out = await fn();
    runs.push(ms(t));
  }
  runs.sort((a, b) => a - b);
  return { out, median: runs[n >> 1], min: runs[0], max: runs.at(-1) };
};

// 1. Reference: the real CLI (native scanner) on a copy of src/.
const dir = "out/site";
rmSync("out", { recursive: true, force: true });
for (const [f, c] of Object.entries(src)) {
  mkdirSync(dirname(join(dir, f)), { recursive: true });
  writeFileSync(join(dir, f), c);
}
let t = performance.now();
execFileSync(new URL("./node_modules/.bin/tailwindcss", import.meta.url).pathname, ["-i", "styles.css", "-o", "../ref.css"], { cwd: dir, stdio: "pipe" });
const cliMs = ms(t);
const ref = readFileSync("out/ref.css", "utf8");

// 2. Candidates: plain-JS extractor against the native scanner, file by file.
const scanner = new Scanner({});
const byFile = new Map();
const missing = [];
let jsCount = 0, nativeCount = 0;
for (const [f, c] of code) {
  const js = extract(c);
  byFile.set(f, js);
  const native = scanner.scanFiles([{ content: c, extension: f.split(".").pop() }]);
  const nativeHere = new Scanner({}).scanFiles([{ content: c, extension: f.split(".").pop() }]);
  jsCount += js.size; nativeCount += nativeHere.length;
  for (const n of nativeHere) if (!js.has(n)) missing.push(`${f}: ${n}`);
}

// 3. Output: the prototype's CSS against the CLI's.
const css = await draftCss(theme, tailwind, byFile);
const rules = (s) => new Set(s.split("\n").filter((l) => /^\s*\.[^ ]/.test(l) && l.trim().endsWith("{")).map((l) => l.trim()));
const refRules = rules(ref), protoRules = rules(css);
const onlyRef = [...refRules].filter((r) => !protoRules.has(r));
const onlyProto = [...protoRules].filter((r) => !refRules.has(r));

// 4. Timings.
const compileCold = await time(() => compileTheme(theme, tailwind), 1);
const extractAll = await time(() => code.map(([, c]) => extract(c)), 50);
const compileWarm = await time(() => compileTheme(theme, tailwind));
const compiler = compileWarm.out;
const all = union(byFile);
const buildFresh = await time(async () => (await compileTheme(theme, tailwind)).build(all));
const hero = src["blocks/hero.tsx"].replace('className="', 'className="p-2 px-4 tracking-tight underline-offset-4 ');
const save = await time(async () => {
  const m = new Map(byFile);
  m.set("blocks/hero.tsx", extract(hero));
  return draftCss(theme, tailwind, m);
});
const themeEdit = theme
  .replace("--brand-color: oklch(0.52 0.2 262)", "--brand-color: oklch(0.55 0.18 30)")
  .replace('--font-heading: "Hanken Grotesk Variable"', '--font-heading: "Fraunces"')
  .replace("--radius-card: 0.875rem", "--radius-card: 0")
  .replace("--spacing-section: clamp(4rem, 2.75rem + 5vw, 7.5rem)", "--spacing-section: clamp(3rem, 2rem + 4vw, 6rem)");
const themeSave = await time(() => draftCss(themeEdit, tailwind, byFile));

// 5. Why not "Live's CSS plus the new classes": appending reorders the cascade.
const liveCompiler = await compileTheme(theme, tailwind);
const liveCss = liveCompiler.build(all);
const deltaCandidates = [...extract(hero)].filter((c) => !all.includes(c));
const appended = liveCss + (await compileTheme(theme, tailwind)).build(deltaCandidates);
const posIn = (s, sel) => s.indexOf(`\n  ${sel} {`);

console.log(JSON.stringify({
  site: { files: code.length, bytes: code.reduce((a, [, c]) => a + c.length, 0) },
  candidates: { jsExtractor: jsCount, nativeScanner: nativeCount, union: all.length, nativeMissedByJs: missing },
  output: { cssBytes: css.length, cliBytes: ref.length, rulesOnlyInCli: onlyRef, rulesOnlyInPrototype: onlyProto, themeEditBytes: themeSave.out.length },
  ms: {
    cliWholeRun: cliMs,
    compileThemeFirst: compileCold.median,
    extractAllFiles: extractAll.median,
    compileThemeWarm: compileWarm.median,
    compilePlusBuildAll: buildFresh.median,
    saveOneBlock: save.median,
    saveThemeEdit: themeSave.median,
    ranges: { save: [save.min, save.max], theme: [themeSave.min, themeSave.max] },
  },
  appendOrder: {
    note: "`p-2 px-4` on one element: px-4 must come after p-2. In Live's CSS px-4 exists, p-2 is appended at the end.",
    fullRebuild: { p2: posIn(save.out, ".p-2"), px4: posIn(save.out, ".px-4") },
    appended: { p2: posIn(appended, ".p-2"), px4: posIn(appended, ".px-4") },
  },
}, null, 1));
