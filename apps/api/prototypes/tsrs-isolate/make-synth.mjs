// A project with no npm types that just needs lots of compiler memory.
import fs from "node:fs";
const n = +process.argv[2], files = {};
let index = "";
for (let m = 0; m < n; m++) {
  let src = "";
  for (let i = 0; i < 1500; i++) src += `export interface I${i} { a${i}: string; b: number; c: { d: I${(i + 1) % 1500}[] } }\nexport const v${i}: I${i}["c"] = { d: [] };\n`;
  files[`/project/src/m${m}.ts`] = src;
  index += `export * as m${m} from "./m${m}";\n`;
}
files["/project/src/index.ts"] = index + "export const bad: number = 'x';\n";
files["/project/tsconfig.json"] = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["es2022"], skipLibCheck: true }, include: ["src/**/*.ts"] });
fs.writeFileSync(process.argv[3], JSON.stringify(files));
