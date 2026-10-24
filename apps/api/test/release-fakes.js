// Fakes for the release, creation, deletion and upgrade Workflows' Cloudflare Artifacts, sandbox
// and email bindings, the revision sandboxes the agent's builds run in, and the Cloudflare API
// they call, run by the integration tests as an auxiliary Worker (vite.config.ts), which bundles
// it with the fake Git server its repos' remotes are served by (fake-git-server.ts). Everything
// shares one isolate, so the fakes and the tests that drive them through `ReleaseFakes` share
// this module's state, keyed by repo name.
import { DurableObject, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

import {
  FAKE_GIT_HOST,
  commitFiles,
  deleteGitRepo,
  forkGitRepo,
  gitBranches,
  gitLog,
  hasGitRepo,
  losePushResponse,
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
/** Counts every command run, in any repo, so tests can order commands across repos. */
let commandsRunCount = 0;
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
/** @type {Set<string>} the user Workers in the `production` dispatch namespace */
const userWorkers = new Set();
/** @type {Set<string>} user Workers every deletion of fails */
const failingWorkerDeletions = new Set();

/** The Cloudflare API token and account the API is given in tests (vite.config.ts). */
const CLOUDFLARE_API_TOKEN = "test-cloudflare-token";
const CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
// Deleting a user Worker from a dispatch namespace, through the Cloudflare API.
const DISPATCH_SCRIPT =
  /^\/client\/v4\/accounts\/([^/]+)\/workers\/dispatch\/namespaces\/([^/]+)\/scripts\/([^/]+)$/;

/**
 * The part of the Cloudflare API the Workflows call with Camox's token: deleting a user Worker
 * from the `production` dispatch namespace. Answers as Cloudflare does, with a JSON envelope.
 * @param {Request} request
 */
function serveCloudflareApi(request) {
  const envelope = (status, errors = []) =>
    Response.json({ success: status < 400, errors, messages: [], result: null }, { status });
  if (request.headers.get("authorization") !== `Bearer ${CLOUDFLARE_API_TOKEN}`) {
    return envelope(403, [{ code: 10000, message: "Authentication error" }]);
  }
  const match = DISPATCH_SCRIPT.exec(new URL(request.url).pathname);
  if (request.method !== "DELETE" || !match) {
    return envelope(404, [{ code: 7003, message: "No route for that URI" }]);
  }
  const [, account, namespace, name] = match;
  if (account !== CLOUDFLARE_ACCOUNT_ID || namespace !== "production") {
    return envelope(403, [{ code: 10000, message: "Authentication error" }]);
  }
  if (failingWorkerDeletions.has(name)) {
    return envelope(500, [{ code: 10013, message: "An unknown error has occurred" }]);
  }
  if (!userWorkers.delete(name)) {
    return envelope(404, [{ code: 10007, message: "This Worker does not exist on your account." }]);
  }
  return envelope(200);
}

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

  async createToken(scope = "write", ttl = 86_400) {
    return {
      id: crypto.randomUUID(),
      plaintext: `artifacts-${scope}-token`,
      scope,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
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

  async configure() {}

  /** @param {string} command */
  async execWithSessionToken(command) {
    this.repo ??= REMOTE.exec(command)?.[1];
    // Not a FUSE device, the way a local container answers `test -c /dev/fuse`.
    const exitCode = command.startsWith("test -c /dev/fuse") ? 1 : 0;
    return { success: exitCode === 0, exitCode, stdout: "", stderr: "", command };
  }

  /**
   * @param {string} wrapped
   * @param {{ env?: Record<string, string> }} options
   */
  async startProcess(wrapped, options) {
    const command = WRAPPED.exec(wrapped)?.[1] ?? wrapped;
    const repo = this.repo ?? "";
    const run = commandsRun.get(repo) ?? [];
    run.push({ command, env: { ...options.env }, order: commandsRunCount++ });
    commandsRun.set(repo, run);

    const failure = failures.get(repo)?.find(({ pattern, times }) => {
      return times > 0 && command.includes(pattern);
    });
    if (failure) failure.times -= 1;
    const exitCode = failure ? 1 : 0;
    const waits = () => {
      const pattern = held.get(repo);
      return pattern !== undefined && command.includes(pattern);
    };
    return {
      id: crypto.randomUUID(),
      waitForExit: async () => {
        // Polls, as a promise can't be settled from the test's request.
        while (waits()) await scheduler.wait(20);
        return { exitCode };
      },
    };
  }

  async createBackup({ dir }) {
    return { id: crypto.randomUUID(), dir, localBucket: true };
  }

  async restoreBackup() {
    return { success: true };
  }

  async listFiles() {
    return { files: [] };
  }

  async readFile() {
    return { content: "" };
  }

  async destroy() {}
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

/** @type {Map<string, { sandbox: string, files: Record<string, string>, archive: number[] | null }[]>} sandbox → builds */
const revisionBuilds = new Map();
/** @type {Map<string, { command: string, env: Record<string, string> | undefined }[]>} sandbox → commands */
const revisionCommands = new Map();
/** @type {{ marker: string, log: string }[]} builds of a tree with a file holding `marker` fail with `log` */
const failingBuilds = [];
/** @type {{ marker: string, definitionSet: unknown }[]} builds of a tree with a file holding `marker` have that Definition Set */
const definedBuilds = [];
/** @type {{ marker: string, diagnostics: unknown[] }[]} lints of a tree with a file holding `marker` find `diagnostics` */
const lintedTrees = [];
/** Sandbox calls left that fail, as a sandbox whose container crashed does. */
let sandboxFailures = 0;
/** @type {{ revision: string, archiveKey: string, project: string, draft: string }[]} revisions dispatch prewarmed, oldest first */
const prewarmed = [];
/** How many of the next prewarms fail, as an unreachable dispatch's would. */
let prewarmFailures = 0;
/** @type {Set<string>} the revision sandboxes destroyed */
const destroyedSandboxes = new Set();
/** @type {Map<string, string>} sandbox → how long it stays up idle */
const sandboxSleepAfter = new Map();
/** Whether revision builds are held, as builds still running. */
let buildsHeld = false;

/** The build command the revision sandbox runs, and the command that archives its output. */
const BUILD_COMMAND = /\bvp build\b/;
const ARCHIVE_COMMAND = /^tar -czf (\S+) /;
const EXTRACT_COMMAND = /\btar -xf (\S+) /;
const LINT_COMMAND = /\bvp lint\b/;

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

  #crash() {
    if (sandboxFailures > 0) {
      sandboxFailures -= 1;
      throw new Error("Container crashed while checking for ports");
    }
  }

  async configure(configuration) {
    this.name = configuration.sandboxName?.name ?? this.name;
    if (configuration.sleepAfter !== undefined) {
      sandboxSleepAfter.set(this.name, configuration.sleepAfter);
    }
  }

  async writeFile(path, content, options = {}) {
    this.#crash();
    this.files.set(path, await bytesOf(content, options.encoding));
    return { success: true, path, timestamp: new Date().toISOString() };
  }

  async exists(path) {
    this.#crash();
    return { success: true, path, exists: this.files.has(path), timestamp: "" };
  }

  async readFile(path, options = {}) {
    this.#crash();
    const bytes = this.files.get(path);
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

  /**
   * @param {string} command
   * @param {{ env?: Record<string, string> }} options
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
    if (BUILD_COMMAND.test(command)) {
      // Polled: a promise resolved from the request letting go wouldn't wake this one.
      while (buildsHeld) await new Promise((resolve) => setTimeout(resolve, 10));
      const failing = failingBuilds.find(({ marker }) =>
        Object.values(this.tree).some((content) => content.includes(marker)),
      );
      const builds = revisionBuilds.get(this.name) ?? [];
      builds.push({ sandbox: this.name, files: this.tree, archive: null });
      revisionBuilds.set(this.name, builds);
      this.built = !failing;
      return failing ? result(1, failing.log) : result(0);
    }
    if (LINT_COMMAND.test(command)) {
      const diagnostics = lintedTrees
        .filter(({ marker }) =>
          Object.values(this.tree).some((content) => content.includes(marker)),
        )
        .flatMap(({ diagnostics }) => diagnostics);
      // As `vp lint` prints it: the Camox plugin logs as Vite+ loads the config, then the JSON.
      const stdout = `4:00:00 AM [vite+] Building Camox app (your development draft)
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
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          build: `fake build of ${await treeOf(this.tree)}`,
          definitionSet: definitionSetOf(this.tree),
        }),
      );
      this.files.set(archive[1], bytes);
      revisionBuilds.get(this.name).at(-1).archive = [...bytes];
      return result(0);
    }
    return result(0);
  }

  async destroy() {
    destroyedSandboxes.add(this.name);
    this.files.clear();
    this.tree = {};
  }
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
    return JSON.parse(await archive.text()).definitionSet;
  }

  /** @param {{ revision: string, archiveKey: string, project: string, draft: string }} revision */
  async prewarm(revision) {
    if (prewarmFailures > 0) {
      prewarmFailures -= 1;
      throw new Error("Network connection lost.");
    }
    if (!(await this.env.REVISION_BUILDS.head(revision.archiveKey))) {
      throw new Error(`The build ${revision.archiveKey} isn't stored`);
    }
    // Dispatch stores the revision's client assets where its asset prefix serves them from.
    await this.env.REVISION_BUILDS.put(
      `${revision.project}/revisions/${revision.revision}/assets/index.css`,
      "body {}",
    );
    prewarmed.push(revision);
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

  /** @param {string} repo Whether a Git repo or a pushed repo of that name exists. */
  async hasRepo(repo) {
    return hasGitRepo(repo) || repos.has(repo);
  }

  /** @param {string} sandbox The builds a revision sandbox ran, oldest first. */
  async revisionBuilds(sandbox) {
    return revisionBuilds.get(sandbox) ?? [];
  }

  /** @param {string} sandbox The commands a revision sandbox ran, oldest first. */
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
   * Makes every lint of a tree with a file containing `marker` find `diagnostics`, as
   * `vp lint --format json` prints them.
   * @param {string} marker
   * @param {unknown[]} diagnostics
   */
  async lintFindingsOf(marker, diagnostics) {
    lintedTrees.push({ marker, diagnostics });
  }

  /** Holds every revision build from now on, as a build still running, until `releaseBuilds()`. */
  async holdBuilds() {
    buildsHeld = true;
  }

  /** Lets go of the builds `holdBuilds()` holds. */
  async releaseBuilds() {
    buildsHeld = false;
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

  /** @param {number} times Makes the next `times` prewarms fail. */
  async failPrewarms(times) {
    prewarmFailures = times;
  }

  /** @param {number} times Makes the next `times` calls to any revision sandbox fail. */
  async crashSandboxes(times) {
    sandboxFailures = times;
  }

  /** @param {string} sandbox Whether a revision sandbox was destroyed. */
  async sandboxDestroyed(sandbox) {
    return destroyedSandboxes.has(sandbox);
  }

  /** @param {string} sandbox How long a revision sandbox was told to stay up idle. */
  async sandboxSleepAfter(sandbox) {
    return sandboxSleepAfter.get(sandbox);
  }

  /** @param {string} name Deploys a user Worker into the `production` dispatch namespace. */
  async deployWorker(name) {
    userWorkers.add(name);
  }

  /** @param {string} name Whether the `production` dispatch namespace has that user Worker. */
  async hasWorker(name) {
    return userWorkers.has(name);
  }

  /** @param {string} name Makes every deletion of that user Worker fail. */
  async failWorkerDeletions(name) {
    failingWorkerDeletions.add(name);
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

/** A page of the fake public website, served as Markdown, so reading it needs no Workers AI. */
const serveWebsite = (/** @type {Request} */ request) =>
  new Response(`# ${new URL(request.url).pathname}\n\nOpening hours: 9am to 5pm.\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });

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
