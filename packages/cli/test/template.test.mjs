import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  copyTemplateSource,
  makeStandalone,
  personalize,
  readCatalog,
  readWorkspaceCatalog,
  replaceProjectId,
} from "../src/lib/template.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

let root;
let source;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "camox-template-test-"));
  source = join(root, "source");
  await mkdir(join(source, "src/routes/_camox"), { recursive: true });
  await mkdir(join(source, "node_modules/react"), { recursive: true });
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "@camox/template-default",
      version: "0.0.0",
      dependencies: { camox: "workspace:*", react: "catalog:", clsx: "^2.1.1" },
      devDependencies: { "@types/react": "catalog:" },
    }),
  );
  await writeFile(
    join(source, "vite.config.ts"),
    [
      "export default {",
      '  projectId: "template-project-id", // camox-cli:replace-project-id',
      "  // camox-cli:dev-only-start",
      "  _internal: { apiUrl: 'http://localhost:8787' },",
      "  // camox-cli:dev-only-end",
      "  port: 7400,",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(join(source, "src/index.ts"), 'export const title = "{{projectName}}";\n');
  await writeFile(join(source, "src/routeTree.gen.ts"), "// generated\n");
  await writeFile(join(source, "src/routes/_camox/page.tsx"), "// generated\n");
  await writeFile(join(source, ".env"), "SECRET=1\n");
  await writeFile(join(source, ".gitignore"), "node_modules\n");
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const catalog = readCatalog(
  [
    "packages:",
    '  - "apps/*"',
    "catalog:",
    '  "@types/react": ^19.3.0',
    "  react: ^19.3.1",
    "",
  ].join("\n"),
);

void test("the copy leaves out generated, installed and local files", async () => {
  const dest = join(root, "copy-excluded");
  copyTemplateSource(source, dest, catalog);

  assert.ok(existsSync(join(dest, "src/index.ts")));
  for (const excluded of [
    "node_modules",
    "src/routeTree.gen.ts",
    "src/routes/_camox",
    ".env",
    ".gitignore",
  ]) {
    assert.equal(existsSync(join(dest, excluded)), false, `${excluded} was copied`);
  }
});

void test("the copy replaces catalog ranges with the workspace catalog's", async () => {
  const dest = join(root, "copy-catalog");
  copyTemplateSource(source, dest, catalog);

  const pkg = JSON.parse(await readFile(join(dest, "package.json"), "utf-8"));
  assert.equal(pkg.dependencies.react, "^19.3.1");
  assert.equal(pkg.devDependencies["@types/react"], "^19.3.0");
  assert.equal(pkg.dependencies.clsx, "^2.1.1");
});

void test("a catalog range missing from the catalog fails the copy", () => {
  assert.throws(
    () => copyTemplateSource(source, join(root, "copy-missing"), {}),
    /No catalog entry for "react"/,
  );
});

void test("a standalone project depends on the published camox and drops development-only lines", async () => {
  const dest = join(root, "standalone");
  copyTemplateSource(source, dest, catalog);
  makeStandalone(dest, { camoxVersion: "1.2.3", packageManager: "pnpm" });

  const pkg = JSON.parse(await readFile(join(dest, "package.json"), "utf-8"));
  assert.equal(pkg.dependencies.camox, "^1.2.3");
  assert.equal(pkg.version, undefined);
  assert.equal(pkg.packageManager, "pnpm@11.1.3");

  const viteConfig = await readFile(join(dest, "vite.config.ts"), "utf-8");
  assert.equal(
    viteConfig,
    [
      "export default {",
      '  projectId: "template-project-id", // camox-cli:replace-project-id',
      "  port: 7400,",
      "};",
      "",
    ].join("\n"),
  );
});

void test("a standalone project ignores what it installs and generates, and links Camox's agent skills", async () => {
  const dest = join(root, "standalone-files");
  copyTemplateSource(source, dest, catalog);
  makeStandalone(dest, { camoxVersion: "1.2.3", packageManager: "pnpm" });

  const gitignore = (await readFile(join(dest, ".gitignore"), "utf-8")).split("\n");
  for (const ignored of ["node_modules", ".env", "src/routeTree.gen.ts", "src/routes/(camox)/"]) {
    assert.ok(gitignore.includes(ignored), `.gitignore misses ${ignored}`);
  }
  for (const skill of ["camox", "camox-cli", "camoxify", "camox-expand"]) {
    assert.equal(
      await readlink(join(dest, `.agents/skills/${skill}`)),
      `../../node_modules/camox/skills/${skill}`,
    );
    assert.equal(
      await readlink(join(dest, `.claude/skills/${skill}`)),
      `../../.agents/skills/${skill}`,
    );
  }
});

void test("a standalone pnpm project lets Camox's own packages install as soon as they're published", async () => {
  const dest = join(root, "standalone-pnpm");
  copyTemplateSource(source, dest, catalog);
  makeStandalone(dest, { camoxVersion: "1.2.3", packageManager: "pnpm" });

  const workspace = await readFile(join(dest, "pnpm-workspace.yaml"), "utf-8");
  assert.match(workspace, /minimumReleaseAgeExclude:\n {2}- camox\n {2}- "@camox\/\*"/);
  assert.match(workspace, /allowBuilds:\n(?: {2}.+\n)* {2}workerd: true/);
});

void test("a standalone npm project has no pnpm workspace", async () => {
  const dest = join(root, "standalone-npm");
  copyTemplateSource(source, dest, catalog);
  makeStandalone(dest, { camoxVersion: "1.2.3", packageManager: "npm" });

  assert.equal(existsSync(join(dest, "pnpm-workspace.yaml")), false);
  const pkg = JSON.parse(await readFile(join(dest, "package.json"), "utf-8"));
  assert.equal(pkg.packageManager, "npm@11.6.2");
});

void test("replacing the Project ID drops its marker", () => {
  assert.equal(
    replaceProjectId(
      '  "name": "template-project-id", // camox-cli:replace-project-id\n',
      "acme-id",
    ),
    '  "name": "acme-id",\n',
  );
});

void test("the Template becomes a standalone project with no workspace or development-only leftovers", async () => {
  const dest = join(root, "real-template");
  copyTemplateSource(join(repoRoot, "apps/template-default"), dest, readWorkspaceCatalog(repoRoot));
  makeStandalone(dest, { camoxVersion: "1.2.3", packageManager: "pnpm" });

  const pkg = JSON.parse(await readFile(join(dest, "package.json"), "utf-8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field])) {
      assert.doesNotMatch(range, /^(workspace|catalog):/, `${name} keeps ${range}`);
    }
  }
  for (const file of ["vite.config.ts", "wrangler.jsonc"]) {
    const content = await readFile(join(dest, file), "utf-8");
    assert.doesNotMatch(content, /camox-cli:dev-only|_internal|CAMOX_DEV_/, file);
  }
});

void test("a project made from the Template is named after its slug and points at its Project ID", async () => {
  const dest = join(root, "personalized");
  copyTemplateSource(join(repoRoot, "apps/template-default"), dest, readWorkspaceCatalog(repoRoot));
  makeStandalone(dest, { camoxVersion: "1.2.3", packageManager: "pnpm" });
  personalize(dest, { slug: "acme", projectId: "0f8e1b2c-0000-7000-8000-000000000001" });

  const pkg = JSON.parse(await readFile(join(dest, "package.json"), "utf-8"));
  assert.equal(pkg.name, "acme");
  for (const file of ["vite.config.ts", "wrangler.jsonc"]) {
    const content = await readFile(join(dest, file), "utf-8");
    assert.match(content, /"0f8e1b2c-0000-7000-8000-000000000001"/, file);
    assert.doesNotMatch(content, /camox-cli:replace-project-id/, file);
  }
});
