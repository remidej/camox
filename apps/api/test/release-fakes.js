// Fakes for the release, creation, deletion and upgrade Workflows' Cloudflare Artifacts, sandbox
// and email bindings and the Cloudflare API they call, run by the integration tests as an
// auxiliary Worker (vite.config.ts), which bundles it with the fake Git server its repos' remotes
// are served by (fake-git-server.ts). Everything shares one isolate, so the fakes and the tests
// that drive them through `ReleaseFakes` share this module's state, keyed by repo name.
import { DurableObject, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

import {
  FAKE_GIT_HOST,
  commitFiles,
  deleteGitRepo,
  forkGitRepo,
  gitLog,
  hasGitRepo,
  losePushResponse,
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

  // No Git objects: @cloudflare/ci then skips its cache, which these tests don't cover.
  async readCommit() {
    return null;
  }

  async readTree() {
    return null;
  }
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
   * Pushes a commit to the repo's `main`, creating the repo if needed.
   * @param {string} repo
   * @param {string} commit
   * @param {Record<string, string>} files
   */
  async push(repo, commit, files) {
    const commits = repos.get(repo) ?? new Map();
    commits.set(commit, files);
    repos.set(repo, commits);
    mains.set(repo, commit);
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
}

/** The host of a public website the agent reads in tests (web-tools.integration.test.ts). */
const FAKE_WEB_HOST = "website.camox.test";

/** A page of the fake public website, served as Markdown, so reading it needs no Workers AI. */
const serveWebsite = (/** @type {Request} */ request) =>
  new Response(`# ${new URL(request.url).pathname}\n\nOpening hours: 9am to 5pm.\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });

export default {
  /**
   * The outbound fetches of the Workers under test: Git remotes reach the fake Git server, the
   * Cloudflare API its fake, the fake public website its pages, and anything else goes out as it
   * would without the fakes.
   * @param {Request} request
   */
  fetch: (request) => {
    const { hostname } = new URL(request.url);
    if (hostname === FAKE_GIT_HOST) return serveGit(request);
    if (hostname === "api.cloudflare.com") return serveCloudflareApi(request);
    if (hostname === FAKE_WEB_HOST) return serveWebsite(request);
    return fetch(request);
  },
};
