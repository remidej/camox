import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

type Bundle = Record<
  string,
  { type: "chunk"; fileName: string; isEntry: boolean } | { type: "asset"; fileName: string }
>;

/** Where the client build puts the files it names by their content's hash. */
const HASHED_DIRS = ["assets", "_chunks"] as const;
const IMMUTABLE = "public, max-age=31536000, immutable";
/** Where a build against an SDK Bundle serves its files, under the bundle's name (ADR 0029). */
const SDK_BUNDLE_DIR = "_camox/sdk";
/** Workers Static Assets reads at most this many rules. */
const MAX_RULES = 100;

/**
 * The `_headers` file Workers Static Assets serves the client build with. Files under
 * `/assets/` and `/_chunks/` are named by their content's hash, so browsers keep them for good;
 * the files there named otherwise, the entry chunks pages load by a fixed name and whatever the
 * app's public directory puts there, keep the default, which revalidates. A build against an
 * SDK Bundle has its files under `/_camox/sdk/<name>/`, which never change under a name either.
 * The app's own `_headers` comes first, as it wrote it.
 */
export function staticAssetHeaders({
  ownHeaders,
  unhashedFiles,
  sdkBundle = false,
}: {
  /** The app's own `_headers`, from its public directory. */
  ownHeaders?: string;
  /** The files under the hashed directories not named by their hash, relative to the root. */
  unhashedFiles: readonly string[];
  /** Whether the build is against an SDK Bundle, rather than whole-app. */
  sdkBundle?: boolean;
}): string {
  const immutableDirs = sdkBundle ? [...HASHED_DIRS, SDK_BUNDLE_DIR] : HASHED_DIRS;
  const rules = [
    ...immutableDirs.map((dir) => `/${dir}/*\n  Cache-Control: ${IMMUTABLE}`),
    ...[...unhashedFiles].sort().map((file) => `/${file}\n  ! Cache-Control`),
  ];
  const own = ownHeaders?.trimEnd();
  const ownRules = own
    ? own.split("\n").filter((line) => /^\S/.test(line) && !line.startsWith("#"))
    : [];
  if (ownRules.length + rules.length > MAX_RULES) {
    throw new Error(
      `Camox: _headers would hold ${ownRules.length + rules.length} rules, past Workers Static Assets' ${MAX_RULES}. Move the public directory's files out of /assets/ and /_chunks/, or drop rules from public/_headers.`,
    );
  }
  return [
    ...(own ? [own] : []),
    "# Camox: files named by their content's hash never change.",
    ...rules,
    "",
  ].join("\n");
}

/** The entry chunks of a bundle under the hashed directories, which pages load by name. */
export function unhashedEntries(bundle: Bundle): string[] {
  return Object.values(bundle)
    .flatMap((output) => (output.type === "chunk" && output.isEntry ? [output.fileName] : []))
    .filter(inHashedDir);
}

/** The files a public directory puts under the hashed directories, relative to it. */
export function publicFilesInHashedDirs(publicDir: string): string[] {
  if (!publicDir) return [];
  return HASHED_DIRS.flatMap((dir) => filesUnder(join(publicDir, dir))).map((file) =>
    relative(publicDir, file).replaceAll("\\", "/"),
  );
}

/** The app's own `_headers`, if its public directory has one. */
export function readOwnHeaders(publicDir: string): string | undefined {
  const path = publicDir && join(publicDir, "_headers");
  return path && existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

function inHashedDir(file: string): boolean {
  return HASHED_DIRS.some((dir) => file.startsWith(`${dir}/`));
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
