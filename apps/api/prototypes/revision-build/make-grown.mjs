// PROTOTYPE, throwaway (issue #550): grows a clone of `template-default` to 40x.
// node make-grown.mjs <template-clone> <out-dir>
// Every block and UI component gets 39 copies. Copy k of a block has its own id and imports
// copy k of the components, so the build compiles and bundles every copy.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true, filter: (p) => !/\/(node_modules|dist|\.git)(\/|$)/.test(p) });

const ui = `${out}/src/components/ui`;
const blocks = `${out}/src/blocks`;
const uiNames = readdirSync(ui).map((f) => f.replace(/\.tsx$/, ""));
const withCopy = (text, k) =>
  text.replace(/@\/components\/ui\/([\w-]+)/g, (m, n) => (uiNames.includes(n) ? `${m}-${k}` : m));
for (let k = 1; k < 40; k++) {
  for (const n of uiNames) {
    const text = readFileSync(`${ui}/${n}.tsx`, "utf8");
    writeFileSync(`${ui}/${n}-${k}.tsx`, withCopy(text, k).replace(/from "\.\/([\w-]+)"/g, `from "./$1-${k}"`));
  }
  for (const f of readdirSync(blocks).filter((f) => /^[a-z-]+\.tsx$/.test(f))) {
    const text = readFileSync(`${blocks}/${f}`, "utf8");
    writeFileSync(
      `${blocks}/${f.replace(/\.tsx$/, `-${k}.tsx`)}`,
      withCopy(text, k).replace(/\n  id: "([\w-]+)"/, `\n  id: "$1-${k}"`),
    );
  }
}
