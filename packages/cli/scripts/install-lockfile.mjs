import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Runs a command, failing with its output on `stdout` and `stderr` if it exits non-zero. */
export function run(bin, argv, options) {
  return exec(bin, argv, { maxBuffer: 64 * 1024 * 1024, ...options });
}

/** Whether pnpm failed because the registry doesn't serve a version it was asked for. */
function isVersionNotOnRegistry(error) {
  return `${error?.stdout ?? ""}${error?.stderr ?? ""}`.includes("ERR_PNPM_NO_MATCHING_VERSION");
}

const REGISTRY = "https://registry.npmjs.org";

/**
 * Waits until npm serves `name@version`, and returns its manifest. It asks for that one version,
 * which npm's CDN doesn't cache, unlike the package metadata pnpm resolves from: asking pnpm before
 * the version is out caches metadata without it for 5 minutes.
 */
export async function waitForPublished(
  name,
  version,
  { fetch: fetchImpl = fetch, attempts = 90, retryDelayMs = 5_000, onRetry = () => {} } = {},
) {
  const url = `${REGISTRY}/${name}/${version}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url);
    if (response.ok) return response.json();
    if (response.status !== 404 || attempt === attempts) {
      throw new Error(`npm doesn't serve ${name}@${version} (${response.status} from ${url})`);
    }
    onRetry(attempt, attempts);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

/** Waits until npm serves `camox@version` and the `@camox/*` packages it depends on. */
export async function waitForCamox(version, options) {
  const manifest = await waitForPublished("camox", version, options);
  const dependencies = Object.entries(manifest.dependencies ?? {}).filter(([name]) =>
    name.startsWith("@camox/"),
  );
  await Promise.all(dependencies.map(([name, range]) => waitForPublished(name, range, options)));
}

/**
 * Writes `dir`'s `pnpm-lock.yaml`. If the registry doesn't serve a version yet, which
 * can last 5 minutes after `waitForPublished` sees it, this retries, and fails at once on any
 * other error.
 */
export async function installLockfile(
  dir,
  { run: runCommand = run, attempts = 60, retryDelayMs = 10_000, onRetry = () => {} } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await runCommand("pnpm", ["install", "--lockfile-only"], { cwd: dir });
      return;
    } catch (error) {
      if (!isVersionNotOnRegistry(error) || attempt === attempts) throw error;
      onRetry(attempt, attempts);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
