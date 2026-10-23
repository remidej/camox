// PROTOTYPE, throwaway (#556). Does checking "changed files + their importers" catch every
// error a whole-src/ check catches? Applies agent-like edits to the Template and compares.
// node reach.mjs <site> <typeSet.json>
import fs from "node:fs";
import { check, workingCopy } from "./check.mjs";
import { importGraph, directImporters, transitiveImporters, transitiveImports, isAmbient } from "./importers.mjs";

const [site, setPath] = process.argv.slice(2);
const typeSet = JSON.parse(fs.readFileSync(setPath, "utf8"));
const base = { ...typeSet, ...workingCopy(site) };
const S = (p) => "/project/src/" + p;
const short = (p) => p.replace("/project/src/", "");

// 1. The graph, cross-checked against what tsrs actually reads from src/ for one root.
const g = importGraph(base);
console.log("== import graph of the Template");
for (const f of g.src) {
  const d = directImporters(g, [f]).size - 1, t = transitiveImporters(g, [f]).size - 1;
  const fwd = transitiveImports(g, [f]);
  console.log(`  ${short(f).padEnd(32)} importers: ${String(d).padStart(2)} direct, ${String(t).padStart(2)} transitive   imports (closure): ${fwd.size - 1}`);
}
const probe = S("layouts/default.tsx");
const r = check(base, [probe]);
const expected = transitiveImports(g, [probe]).size + g.src.filter((p) => p.endsWith(".d.ts")).length;
console.log(`  cross-check: tsrs read ${r.srcReads} src files for ${short(probe)}; the graph predicts ${expected}`);

// 2. Agent-like edits. `add` writes new files first (an earlier turn), `edit` is this turn.
const wrapper = {
  [S("components/ui/cta-button.tsx")]: `import type { ComponentProps } from "react";\n\nimport { Button } from "@/components/ui/button";\n\n/** A large call-to-action button. */\nexport function CtaButton(props: ComponentProps<typeof Button>) {\n  return <Button size="lg" {...props} />;\n}\n`,
  [S("blocks/cta.tsx")]: `import { createBlock } from "camox/createBlock";\n\nimport { CtaButton } from "@/components/ui/cta-button";\nimport { Container } from "@/components/ui/container";\nimport { colorSchemeSetting, Section } from "@/components/ui/section";\n\nconst cta = createBlock({\n  id: "cta",\n  title: "Call to action",\n  description: "A centered call to action.",\n  content: {},\n  settings: (setting) => ({ scheme: colorSchemeSetting(setting, "brand") }),\n  component: CtaComponent,\n});\n\nfunction CtaComponent() {\n  return (\n    <Section scheme={cta.useSetting("scheme")}>\n      <Container>\n        <CtaButton href="/contact" variant="outline">Contact us</CtaButton>\n      </Container>\n    </Section>\n  );\n}\n\nexport { cta as block };\n`,
};
const sub = (path, from, to) => (files) => {
  if (!files[path].includes(from)) throw new Error(`"${from}" not in ${path}`);
  return { [path]: files[path].replace(from, to) };
};
const cases = [
  { name: "remove the button's outline variant", edit: sub(S("components/ui/button.tsx"), `outline: "border-line text-ink hover:bg-ink/5",`, "") },
  { name: "rename the button's plain variant", edit: sub(S("components/ui/button.tsx"), "plain:", "ghost:") },
  { name: "rename the dark color scheme", edit: sub(S("components/ui/section.tsx"), "dark:", "night:") },
  { name: "cn() takes strings only", edit: sub(S("lib/utils.ts"), "...inputs: ClassValue[]", "...inputs: string[]") },
  { name: "footer exports `footer`, not `block`", edit: sub(S("blocks/footer.tsx"), "as block", "as footer") },
  { name: "agent's wrapper: remove the outline variant", add: wrapper, edit: sub(S("components/ui/button.tsx"), `outline: "border-line text-ink hover:bg-ink/5",`, "") },
  { name: "agent's wrapper: narrow its props", add: wrapper, edit: sub(S("components/ui/cta-button.tsx"), "props: ComponentProps<typeof Button>", "props: { href: string; children: string }") },
  { name: "delete components/ui/container.tsx", edit: () => ({ [S("components/ui/container.tsx")]: undefined }) },
  { name: "a global (icons.gen.d.ts) loses an id", add: { [S("blocks/hero.tsx")]: base[S("blocks/hero.tsx")] + `\nexport const icon: keyof CamoxIconRegistry = "ids";\n` }, edit: sub(S("camox/icons.gen.d.ts"), "ids: never;", "names: never;") },
];

const errorFiles = (res) => [...new Set(res.diagnostics.map((d) => d.split(":")[0]))].sort();
console.log("\n== edits: errors found by each check");
for (const c of cases) {
  const before = { ...base, ...(c.add ?? {}) };
  const changes = c.edit(before);
  const files = { ...before, ...changes };
  for (const [p, v] of Object.entries(changes)) if (v === undefined) delete files[p]; // a deleted file
  const changed = Object.keys(changes);
  const graph = importGraph(files);
  // Importers from both sides of the turn: a deleted or renamed file's importers are only in the old graph.
  const old = importGraph(before);
  const both = { importers: new Map([...graph.importers].map(([k, v]) => [k, new Set([...v, ...(old.importers.get(k) ?? [])])])) };
  for (const [k, v] of old.importers) if (!both.importers.has(k)) both.importers.set(k, v);
  const ambient = changed.some((p) => isAmbient(p, files[p] ?? before[p]));
  const full = check(files);
  const truth = errorFiles(full);
  const live = (set) => [...set].filter((p) => files[p] !== undefined);
  const direct = live(directImporters(graph, changed));
  const trans = live(transitiveImporters(graph, changed));
  const transBoth = live(transitiveImporters(both, changed));
  const dRes = check(files, direct), tRes = check(files, trans), bRes = check(files, transBoth);
  const show = (res, roots) => `${roots.length} roots, ${res.ms} ms, ${res.linearMiB} MiB -> ${errorFiles(res).join(", ") || "no errors"}${errorFiles(res).join() === truth.join() ? "" : "   MISSES"}`;
  console.log(`- ${c.name}${ambient ? " (ambient file changed)" : ""}`);
  console.log(`    whole src/:            ${full.ms} ms, ${full.linearMiB} MiB -> ${truth.join(", ") || "no errors"}`);
  console.log(`    changed + direct:      ${show(dRes, direct)}`);
  console.log(`    changed + transitive:  ${show(tRes, trans)}`);
  console.log(`    ... old + new graph:   ${show(bRes, transBoth)}`);
}
