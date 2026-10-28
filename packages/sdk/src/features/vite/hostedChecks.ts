import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { type ESTree, Visitor, parseSync } from "vite-plus";

/**
 * Set by Camox's revision and release sandboxes: a hosted project's build checks the code an
 * agent may have written (ADR 0021). Dev mode never sets it.
 */
export const HOSTED_BUILD_ENV = "CAMOX_INTERNAL_HOSTED";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** `camox`'s public entry points, as `camox/<path>`: its exports, less its internal ones. */
function camoxEntryPoints(): Set<string> {
  const { exports } = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  return new Set(
    Object.keys(exports)
      .filter((path) => !path.startsWith("./_internal/"))
      .map((path) => `camox${path.slice(1)}`),
  );
}

/** What a hosted project's code may import, and where its code lives. */
export interface HostedProject {
  root: string;
  src: string;
  /** The packages `package.json` lists in `dependencies`. */
  dependencies: Set<string>;
  camoxEntryPoints: Set<string>;
}

export function readHostedProject(root: string): HostedProject {
  const { dependencies = {} } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return {
    root,
    src: join(root, "src"),
    dependencies: new Set(Object.keys(dependencies)),
    camoxEntryPoints: camoxEntryPoints(),
  };
}

const withoutQuery = (path: string) => path.replace(/[?#].*$/, "");
const isInside = (dir: string, path: string) => path.startsWith(dir + sep);
const displayPath = (project: HostedProject, file: string) =>
  relative(project.root, file).split(sep).join("/");

/** The project's own file an importer names, when it is one of `src/`'s: the code it checks. */
function sourceFile(project: HostedProject, importer: string | undefined) {
  if (!importer || importer.startsWith("\0")) return;
  const file = withoutQuery(importer);
  return isAbsolute(file) && isInside(project.src, file) ? file : undefined;
}

function isAllowedImport(project: HostedProject, specifier: string, importer: string): boolean {
  // Plugins' own modules, such as the helpers Vite adds to a module it transforms.
  if (specifier.startsWith("\0")) return true;
  const path = withoutQuery(specifier);
  let file: string | undefined;
  if (path.startsWith("./") || path.startsWith("../")) file = resolve(dirname(importer), path);
  else if (path.startsWith("@/")) file = resolve(project.src, path.slice(2));
  else if (path.startsWith("/"))
    // Vite reads `/…` from the project's root.
    file = isInside(project.root, path) ? resolve(path) : resolve(project.root, `.${path}`);
  if (file !== undefined) return isInside(project.src, file);

  if (path === "camox" || path.startsWith("camox/")) return project.camoxEntryPoints.has(path);
  const [scopeOrName, name] = path.split("/");
  const packageName = scopeOrName!.startsWith("@") ? `${scopeOrName}/${name}` : scopeOrName!;
  return project.dependencies.has(packageName);
}

/**
 * Why a file of `src/` can't import `specifier`, or nothing when it may: files of `src/`,
 * `camox`'s public entry points and `package.json`'s `dependencies`.
 */
export function forbiddenImport(
  project: HostedProject,
  specifier: string,
  importer: string | undefined,
): string | undefined {
  const file = sourceFile(project, importer);
  if (!file || isAllowedImport(project, specifier, file)) return;
  return (
    `${displayPath(project, file)} imports "${specifier}", which a hosted project can't import. ` +
    "It can import files in src/, camox's public entry points and the packages package.json " +
    "lists in dependencies."
  );
}

/** The modules the registry loads blocks from, as its globs name them. */
const BLOCK_MODULE = /^src\/(?:camox\/)?blocks\/([^/]+)\.tsx?$/;

/** A string an expression spells out, without running it. */
function literalString(node: ESTree.Expression | undefined): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
}

/**
 * Whether `callee` calls `createBlock`: by its name, the names a module imports it as
 * (`import { createBlock as defineBlock }`), or as a namespace's member.
 */
function isCreateBlock(callee: ESTree.Expression, names: Set<string>): boolean {
  if (callee.type === "Identifier") return names.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "createBlock"
  );
}

/** The local names a module calls `createBlock` by: its own name, and its imports' aliases. */
function createBlockNames(program: ESTree.Program): Set<string> {
  const names = new Set(["createBlock"]);
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported;
      const name = imported.type === "Identifier" ? imported.name : imported.value;
      if (name === "createBlock") names.add(specifier.local.name);
    }
  }
  return names;
}

/** The `id` a block definition's object literal spells out. */
function definitionId(definition: ESTree.Argument | undefined): ESTree.Expression | undefined {
  if (definition?.type !== "ObjectExpression") return;
  for (const property of definition.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const key = property.key;
    if (
      (key.type === "Identifier" && key.name === "id") ||
      (key.type === "Literal" && key.value === "id")
    )
      return property.value;
  }
}

/**
 * Why a block's module breaks the registry, or nothing when it doesn't. The browser finds a block
 * by its file name, so a block's file must be named after its id: the build reads the id from the
 * `createBlock()` call, and needs it written as a string.
 */
export function misnamedBlock(
  project: HostedProject,
  moduleId: string,
  code: string,
): { message: string; at: number } | undefined {
  const file = sourceFile(project, moduleId);
  if (!file) return;
  const path = displayPath(project, file);
  const fileName = BLOCK_MODULE.exec(path)?.[1];
  if (!fileName) return;
  const { program, errors } = parseSync(file, code);
  // The bundler reports syntax errors itself.
  if (errors.length > 0) return;

  let problem: { message: string; at: number } | undefined;
  const names = createBlockNames(program);
  new Visitor({
    CallExpression(call) {
      if (problem || !isCreateBlock(call.callee, names)) return;
      const id = literalString(definitionId(call.arguments[0]));
      // Where the problem is: the id, or the call when it has none.
      const at = definitionId(call.arguments[0])?.start ?? call.start;
      if (id === undefined) {
        problem = {
          message:
            `${path} calls createBlock() without its id as a string literal, which the build ` +
            `needs to check that the file is named after it: write \`id: "${fileName}"\`.`,
          at,
        };
      } else if (id !== fileName) {
        problem = {
          message:
            `${path} defines the block "${id}", but its file is named "${fileName}": a block's ` +
            `file is named after its id. Rename the file to ${id}${file.slice(file.lastIndexOf("."))} ` +
            `or the id to "${fileName}".`,
          at,
        };
      }
    },
  }).visit(program);
  return problem;
}
