// PROTOTYPE, throwaway (issue #521): builds the test repos from a clone of `template-default`.
// node make-repos.mjs <template-clone> <out-dir>
//
// Each repo has `main`, a `draft` branch that forked from it, and `draft-conflict`, which edits
// the same line of faq.tsx as main does after the fork. Main then moves on (another draft
// published, an Upgrade), so merging main into the drafts has work to do.
//   tpl:   the Template.
//   grown: the Template with src/blocks and src/components grown to 40x.
//   long:  the Template after 20,000 agent turns; the drafts forked 500 turns ago and have
//          100 turns of their own.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const [src, out] = process.argv.slice(2);
const git = (cwd, args, input) =>
  execFileSync("git", args, { cwd, input, maxBuffer: 1 << 30 });

// The Template's files: path -> { mode, data }.
const base = new Map();
for (const line of git(src, ["ls-tree", "-r", "HEAD"]).toString().trim().split("\n")) {
  const [meta, path] = line.split("\t");
  const [mode, , hash] = meta.split(" ");
  base.set(path, { mode, data: git(src, ["cat-file", "blob", hash]) });
}

const editable = [...base.keys()].filter((p) => /^src\/.*\.(tsx|ts|css)$/.test(p) && !p.endsWith(".d.ts"));

// One agent turn's edit: a changing comment at the end of the file, plus a changed string in the
// middle every few turns, so the history has real deltas.
function edit(files, path, turn) {
  const file = files.get(path);
  let text = file.data.toString().replace(/\n\/\* turn \d+ \*\/\n$/, "\n");
  if (turn % 3 === 0) text = text.replace(/"([^"\n]{4,40})"/, `"$1 ${turn % 97}"`);
  files.set(path, { ...file, data: Buffer.from(`${text}\n/* turn ${turn} */\n`) });
}

function grow(files, times) {
  for (const [path, file] of [...files]) {
    if (!/^src\/(blocks|components\/ui)\//.test(path)) continue;
    for (let k = 1; k < times; k++) files.set(path.replace(/\.tsx$/, `-${k}.tsx`), file);
  }
}

// A fast-import stream, written as commits are made.
function makeRepo(name, build) {
  const dir = `${out}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  const chunks = [];
  let mark = 0;
  let time = 1_760_000_000;
  const tips = {};
  const commit = (branch, from, before, after, message) => {
    const m = ++mark;
    const lines = [`commit refs/heads/${branch}`, `mark :${m}`, `committer Camox <noreply@camox.ai> ${time++} +0000`, `data ${Buffer.byteLength(message)}`, message];
    if (from) lines.push(`from :${from}`);
    chunks.push(Buffer.from(`${lines.join("\n")}\n`));
    for (const [path, file] of after) {
      if (before?.get(path)?.data === file.data) continue;
      chunks.push(Buffer.from(`M ${file.mode} inline ${path}\ndata ${file.data.length}\n`), file.data, Buffer.from("\n"));
    }
    for (const path of before?.keys() ?? []) if (!after.has(path)) chunks.push(Buffer.from(`D ${path}\n`));
    tips[branch] = m;
    return m;
  };
  build(commit);
  git(dir, ["fast-import", "--quiet"], Buffer.concat(chunks));
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["gc", "-q"]);
  console.log(name, git(dir, ["count-objects", "-vH"]).toString().match(/size-pack: .*/)[0], git(dir, ["rev-list", "--count", "main"]).toString().trim(), "commits on main");
}

const clone = (files) => new Map([...files].map(([p, f]) => [p, { ...f }]));

// Shared shape: history -> fork -> draft turns, main's own turns -> main moves on.
function scenario(commit, files, { turns, forkBack, draftTurns }) {
  let tip = commit("main", 0, null, files, "Create Prototype");
  let forkAt = tip;
  let forkFiles = files;
  const mainEditable = editable.filter((p) => p !== "src/blocks/hero.tsx" && p !== "src/blocks/faq.tsx");
  for (let t = 1; t <= turns; t++) {
    const before = files;
    files = clone(files);
    for (let i = 0; i < 1 + (t % 3); i++) edit(files, mainEditable[(t * 7 + i * 3) % mainEditable.length], t);
    tip = commit("main", tip, before, files, `Turn ${t}`);
    if (t === turns - forkBack) [forkAt, forkFiles] = [tip, files];
  }
  if (turns === 0) [forkAt, forkFiles] = [tip, files];

  // The drafts: new blocks and hero edits; draft-conflict also edits faq.tsx's first string.
  for (const branch of ["draft", "draft-conflict"]) {
    let dTip = forkAt;
    let d = forkFiles;
    for (let t = 1; t <= draftTurns; t++) {
      const before = d;
      d = clone(d);
      edit(d, "src/blocks/hero.tsx", 100_000 + t);
      if (t % 10 === 1) d.set(`src/blocks/new-${t}.tsx`, { mode: "100644", data: d.get("src/blocks/faq.tsx").data });
      if (branch === "draft-conflict" && t === 1) {
        const faq = d.get("src/blocks/faq.tsx");
        d.set("src/blocks/faq.tsx", { ...faq, data: Buffer.from(faq.data.toString().replace(/"([^"\n]{4,40})"/, '"Draft says this"')) });
      }
      dTip = commit(branch, dTip, before, d, `Draft turn ${t}`);
    }
  }

  // Main moves on: a published draft (navbar, faq's first string) and an Upgrade.
  let before = files;
  files = clone(files);
  edit(files, "src/blocks/navbar.tsx", 900_001);
  const faq = files.get("src/blocks/faq.tsx");
  files.set("src/blocks/faq.tsx", { ...faq, data: Buffer.from(faq.data.toString().replace(/"([^"\n]{4,40})"/, '"Live says this"')) });
  tip = commit("main", tip, before, files, "Publish another draft");
  before = files;
  files = clone(files);
  const pkg = files.get("package.json");
  files.set("package.json", { ...pkg, data: Buffer.from(pkg.data.toString().replace(/"camox": "[^"]+"/, '"camox": "0.49.0"')) });
  const lock = files.get("pnpm-lock.yaml");
  files.set("pnpm-lock.yaml", { ...lock, data: Buffer.from(lock.data.toString().replaceAll("0.48.0", "0.49.0")) });
  commit("main", tip, before, files, "Update the Template to camox 0.49.0");
}

makeRepo("tpl", (commit) => scenario(commit, clone(base), { turns: 0, forkBack: 0, draftTurns: 3 }));
makeRepo("grown", (commit) => {
  const files = clone(base);
  grow(files, 40);
  scenario(commit, files, { turns: 0, forkBack: 0, draftTurns: 3 });
});
makeRepo("long", (commit) => scenario(commit, clone(base), { turns: 20_000, forkBack: 500, draftTurns: 100 }));
