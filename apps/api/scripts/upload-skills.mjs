// Uploads the skills `camox` ships, packages/sdk/skills, to the API's `SKILLS` bucket under the
// SDK's version, as one JSON object of each file's path under `skills/` to its text. The agent
// mounts the skills of the version a project's lockfile installs (src/domains/code/skills.ts).
//
//   node apps/api/scripts/upload-skills.mjs [--camox-version X.Y.Z] [--local]
//
// CI runs it after every SDK publish, in the `upload-skills` job of .github/workflows/deploy.yml,
// with CLOUDFLARE_ACCOUNT_ID and a CLOUDFLARE_API_TOKEN allowed to edit R2. `--local` writes to the
// bucket `pnpm dev` serves instead. `--camox-version` defaults to packages/sdk's version.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SDK_ROOT = path.join(API_ROOT, "../../packages/sdk");
const BUCKET = "camox-skills";

const { values: args } = parseArgs({
  options: { "camox-version": { type: "string" }, local: { type: "boolean" } },
});
const version =
  args["camox-version"] ??
  JSON.parse(readFileSync(path.join(SDK_ROOT, "package.json"), "utf-8")).version;

const skillsDir = path.join(SDK_ROOT, "skills");
const files = Object.fromEntries(
  readdirSync(skillsDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
    .map((file) => [
      path.relative(skillsDir, file).split(path.sep).join("/"),
      readFileSync(file, "utf-8"),
    ]),
);
const object = path.join(mkdtempSync(path.join(tmpdir(), "camox-skills-")), `${version}.json`);
writeFileSync(object, JSON.stringify(files));

const require = createRequire(import.meta.url);
// Wrangler's exports map hides its bin, so locate it from the exported package.json.
const wrangler = path.join(
  path.dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
execFileSync(
  process.execPath,
  [
    wrangler,
    "r2",
    "object",
    "put",
    `${BUCKET}/${version}.json`,
    "--file",
    object,
    "--content-type",
    "application/json",
    args.local ? "--local" : "--remote",
  ],
  { cwd: API_ROOT, stdio: "inherit" },
);
console.info(`[upload-skills] ${Object.keys(files).length} files of camox ${version}`);
