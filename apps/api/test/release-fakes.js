// Fakes for the release Workflow's Cloudflare Artifacts, sandbox and email bindings, run by the
// integration tests as an auxiliary Worker (vite.config.ts). Plain JavaScript, since Miniflare
// loads auxiliary Workers unbundled. Everything shares one isolate, so the fakes and the tests
// that drive them through `ReleaseFakes` share this module's state, keyed by repo name.
import { DurableObject, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

/** @type {Map<string, Map<string, Record<string, string>>>} repo name → commit → path → content */
const repos = new Map();
/** @type {Map<string, { command: string, env: Record<string, string> }[]>} repo name → commands */
const commandsRun = new Map();
/** @type {Map<string, { pattern: string, times: number }[]>} repo name → commands that fail */
const failures = new Map();
/** @type {{ from: unknown, to: string, subject: string, text: string, html: string }[]} */
const emailsSent = [];
/** @type {string[]} texts that make a send throw when an email contains one */
const failingEmails = [];

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

  /** @param {{ ref: string, path: string }} args */
  async readFile({ ref, path }) {
    const content = repos.get(this.name)?.get(ref)?.[path];
    return content === undefined ? null : new Blob([content]);
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
    if (!repos.has(name)) {
      throw Object.assign(new Error(`Repository not found: ${name}`), { code: "NOT_FOUND" });
    }
    return new FakeRepo(name);
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
    run.push({ command, env: { ...options.env } });
    commandsRun.set(repo, run);

    const failure = failures.get(repo)?.find(({ pattern, times }) => {
      return times > 0 && command.includes(pattern);
    });
    if (failure) failure.times -= 1;
    const exitCode = failure ? 1 : 0;
    return { id: crypto.randomUUID(), waitForExit: async () => ({ exitCode }) };
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
   * @param {string} repo
   * @param {string} commit
   * @param {Record<string, string>} files
   */
  async push(repo, commit, files) {
    const commits = repos.get(repo) ?? new Map();
    commits.set(commit, files);
    repos.set(repo, commits);
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
}

export default {
  fetch: () => new Response("Not found", { status: 404 }),
};
