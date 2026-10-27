import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// `camox clone` checks out a flagged project's repo, which Git then reads with short-lived read
// tokens that `camox git-credential` gets from the API. Here the repo is a local bare repo, served
// over Git's smart HTTP behind Basic auth as Cloudflare Artifacts serves it, and the API is a stub
// that mints a new read token on each request, expiring every one minted before.

const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
// Project IDs, as the API mints them: lowercase UUIDv7s.
const FLAGGED = { uuid: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a70", slug: "acme" };
const UNFLAGGED = { uuid: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a71", slug: "globex" };
const SESSION = "session-token";

let root;
let home;
let origin;
let server;
/** Every read token minted, in order: only the last one is still valid. */
const tokens = [];
/** The bare repos the Git remote serves, under `<root>/git/projects/<Project ID>.git`. */
let gitRoot;

const repoOf = (project) => join(gitRoot, "projects", `${project.uuid}.git`);

const rpcError = (res, status, code, message) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ json: { defined: false, code, status, message } }));
};

async function serveRpc(req, res, procedure, input) {
  if (req.headers.authorization !== `Bearer ${SESSION}`) {
    return rpcError(res, 401, "UNAUTHORIZED", "Unauthorized");
  }
  const project = [FLAGGED, UNFLAGGED].find(
    (p) => p.uuid === input?.projectUuid || p.slug === input?.slug,
  );
  if (!project) return rpcError(res, 404, "NOT_FOUND", "Not found");
  let output;
  if (procedure === "projects/getBySlug" || procedure === "projects/getByUuid") {
    output = { uuid: project.uuid, slug: project.slug, name: project.slug };
  } else if (procedure === "projects/createCodeReadToken") {
    if (project === UNFLAGGED) {
      return rpcError(res, 403, "FORBIDDEN", "globex's code can't be worked on outside Camox.");
    }
    const token = `read-token-${tokens.length + 1}`;
    tokens.push(token);
    output = {
      remote: `${origin}/git/projects/${project.uuid}.git`,
      token,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      projectSlug: project.slug,
    };
  } else {
    return rpcError(res, 404, "NOT_FOUND", "Not found");
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ json: output }));
}

/** Git's smart HTTP, through `git http-backend`, for the last read token minted only. */
async function serveGit(req, res, body) {
  const [, password] = Buffer.from(
    (req.headers.authorization ?? "").replace(/^Basic /, ""),
    "base64",
  )
    .toString()
    .split(":");
  if (!password || password !== tokens.at(-1)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="artifacts"' });
    res.end();
    return;
  }
  const url = new URL(req.url, origin);
  const backend = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: gitRoot,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: url.pathname.slice("/git".length),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers["content-type"] ?? "",
      CONTENT_LENGTH: String(body.length),
      REMOTE_USER: "member",
    },
  });
  backend.stdin.end(body);
  const chunks = [];
  for await (const chunk of backend.stdout) chunks.push(chunk);
  const output = Buffer.concat(chunks);
  const split = output.indexOf("\r\n\r\n");
  const headers = output.subarray(0, split).toString().split("\r\n");
  let status = 200;
  for (const line of headers) {
    const [name, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
    else res.setHeader(name, value);
  }
  res.writeHead(status);
  res.end(output.subarray(split + 4));
}

/** Runs `git` with the test's home, so its global config is the test's own. */
const git = (cwd, args, input) => {
  const child = execFile("git", args, { cwd, env: gitEnv() });
  if (input !== undefined) child.stdin.end(input);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(Object.assign(new Error(stderr), { code, stdout, stderr })),
    );
  });
};

function gitEnv(extra = {}) {
  return {
    ...process.env,
    HOME: home,
    // Keeps the machine's own credential helpers (such as macOS's keychain) out of the tests.
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    CAMOX_URL: origin,
    CAMOX_API_URL: origin,
    PATH: `${join(root, "bin")}${delimiter}${process.env.PATH}`,
    ...extra,
  };
}

/** Commits `files` to a bare repo's `branch`, from a scratch checkout. */
async function commitTo(repo, branch, files, message) {
  const work = await mkdtemp(join(root, "work-"));
  await git(work, ["init", "--quiet", "--initial-branch", branch]);
  await git(work, ["remote", "add", "origin", repo]);
  try {
    await git(work, ["fetch", "--quiet", "origin", branch]);
    await git(work, ["checkout", "--quiet", "-B", branch, `origin/${branch}`]);
  } catch {
    // A new branch.
  }
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(work, path), content);
  }
  await git(work, ["add", "."]);
  await git(work, [
    "-c",
    "user.name=Camox",
    "-c",
    "user.email=noreply@camox.ai",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  await git(work, ["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`]);
}

async function cli(args, { cwd = root, input } = {}) {
  const child = execFile(process.execPath, [binary, ...args], { cwd, env: gitEnv() });
  child.stdin.end(input ?? "");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "camox-clone-test-")));
  home = join(root, "home");
  gitRoot = join(root, "remote");
  await mkdir(join(home, ".camox"), { recursive: true });
  await mkdir(join(root, "bin"));
  // A fake `pnpm`, recording where it installed.
  await writeFile(
    join(root, "bin", "pnpm"),
    `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(join(root, "pnpm-runs"))}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");
`,
  );
  await chmod(join(root, "bin", "pnpm"), 0o755);

  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.url.startsWith("/rpc/")) {
      const procedure = req.url.slice("/rpc/".length).split("?")[0];
      return serveRpc(req, res, procedure, body.length ? JSON.parse(body).json : undefined);
    }
    if (req.url.startsWith("/api/auth/get-session")) {
      res.writeHead(req.headers.authorization === `Bearer ${SESSION}` ? 200 : 401);
      return res.end("{}");
    }
    if (req.url.startsWith("/git/")) return serveGit(req, res, body);
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;

  await writeFile(
    join(home, ".camox/auth.json"),
    JSON.stringify({ [origin]: { token: SESSION, email: "member@example.com", name: "Member" } }),
  );
  for (const project of [FLAGGED, UNFLAGGED]) {
    await git(root, ["init", "--quiet", "--bare", "--initial-branch", "main", repoOf(project)]);
    await commitTo(repoOf(project), "main", { "package.json": "{}\n" }, "Create the website");
  }
});

after(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await rm(root, { recursive: true, force: true });
});

/** Clones the flagged project into a new directory, and returns the clone's path. */
async function cloneFlagged() {
  const cwd = await mkdtemp(join(root, "clones-"));
  const result = await cli(["clone", FLAGGED.slug], { cwd });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return join(cwd, FLAGGED.slug);
}

void test("clone checks out a flagged project's main, named after its slug, and installs its dependencies", async () => {
  const clone = await cloneFlagged();

  assert.equal(await readFile(join(clone, "package.json"), "utf8"), "{}\n");
  const runs = (await readFile(join(root, "pnpm-runs"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(runs.at(-1), { cwd: clone, args: ["install"] });
});

void test("git pull and fetch keep working on main and drafts' branches after the first read token expired", async () => {
  const clone = await cloneFlagged();
  await commitTo(repoOf(FLAGGED), "main", { "hero.tsx": "export {};\n" }, "Add a hero");
  await commitTo(
    repoOf(FLAGGED),
    "drafts/pricing",
    { "pricing.tsx": "export {};\n" },
    "Add pricing",
  );
  tokens.push("a-token-only-the-server-knows"); // Expires every token minted so far.

  await git(clone, ["pull", "--quiet"]);
  await git(clone, ["fetch", "--quiet"]);

  assert.equal(await readFile(join(clone, "hero.tsx"), "utf8"), "export {};\n");
  assert.equal(await git(clone, ["show", "origin/drafts/pricing:pricing.tsx"]), "export {};");
});

void test("clone configures the credential helper in the clone only, for the repo's host only", async () => {
  // A clone made inside another repo's checkout.
  const parent = await mkdtemp(join(root, "parent-"));
  await git(parent, ["init", "--quiet"]);
  const parentConfig = await readFile(join(parent, ".git/config"), "utf8");

  const result = await cli(["clone", FLAGGED.slug], { cwd: parent });
  assert.equal(result.code, 0, result.stderr + result.stdout);

  const clone = join(parent, FLAGGED.slug);
  const helpers = await git(clone, ["config", "--get-urlmatch", "credential.helper", origin]);
  assert.match(helpers, /git-credential/);
  await assert.rejects(
    git(clone, ["config", "--get-urlmatch", "credential.helper", "https://github.com"]),
  );
  assert.equal(await readFile(join(parent, ".git/config"), "utf8"), parentConfig);
  await assert.rejects(git(root, ["config", "--global", "--get-regexp", "credential"]));
});

void test("clone refuses a project without the flag, with the API's message, and leaves no directory", async () => {
  const cwd = await mkdtemp(join(root, "clones-"));

  const result = await cli(["clone", UNFLAGGED.slug], { cwd });

  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /can't be worked on outside Camox/);
  await assert.rejects(readFile(join(cwd, UNFLAGGED.slug, "package.json")));
});

void test("git-credential answers Git's request for a project's remote with a fresh read token", async () => {
  const host = new URL(origin).host;

  const { code, stdout } = await cli(["git-credential", "get"], {
    input: `protocol=http\nhost=${host}\npath=git/projects/${FLAGGED.uuid}.git\n\n`,
  });

  assert.equal(code, 0);
  const answer = Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  assert.equal(answer.password, tokens.at(-1));
  assert.ok(answer.username);
  assert.ok(Number(answer.password_expiry_utc) > Date.now() / 1000);
});

void test("git-credential ignores Git asking it to store or erase a credential", async () => {
  for (const action of ["store", "erase"]) {
    const { code, stdout } = await cli(["git-credential", action], {
      input: `protocol=http\nhost=example.com\nusername=x\npassword=y\n\n`,
    });
    assert.equal(code, 0);
    assert.equal(stdout, "");
  }
});
