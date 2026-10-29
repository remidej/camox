// The revision builder: a Node process that stays up in a revision sandbox and builds the website
// in its workspace as `vp build` would, without paying again on each build for Node's start and
// loading Vite and the website's Vite plugins, about 2 s of a warm 6 s build (#649). The API
// starts it with each workspace it prepares (src/domains/revisions/sandbox.ts), so it loads them
// as the agent writes, and its build command asks it for each build.
//
//   node revision-builder.mjs serve   starts it, in the workspace, unless one is up already
//   node revision-builder.mjs build   builds through it, printing the build's log, then exits
//                                      with 0 when the build passed, 1 when it failed, and 75
//                                      when no builder could build, for `vp build` to build
//   node revision-builder.mjs lint <list>
//                                      lints the files listed in the file <list>, one path a
//                                      line, printing Oxlint's JSON report as `vp lint --format
//                                      json` does, and exits with Oxlint's code
//
// A lint runs Oxlint itself with the `lint` config of the website's Vite config, which the
// builder reads in a few milliseconds with the plugins loaded: `vp lint` loads them again each
// time, about 3 s in a sandbox (#740). It runs beside a build. When no builder can lint, `vp
// lint` lints the files.
//
// Each build creates its Vite builder again, from the config file, which takes about 20 ms once
// the plugins are loaded: so a build reads the config as it is now, and plugins keep no state
// from one build to the next, such as the Camox plugin's build ID. Only the modules stay loaded,
// so a builder whose workspace installed another lockfile since it started leaves for a new one.
//
// A build's output is the same as `vp build`'s, without sourcemaps: neither previews nor
// publishes load them (apps/dispatch/src/revisions.ts, src/domains/publishes/scripts.ts).
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Where the builder listens. */
const SOCKET = "/tmp/camox-revision-builder.sock";
/** What `build` exits with when no builder could build. */
const UNAVAILABLE = 75;
/** How long `build` waits for a builder that's starting to listen. */
const LISTEN_WAIT_MS = 5_000;
/** A builder grown past this much memory leaves after its build, for the next to start anew. */
const MAX_RSS_BYTES = 4 * 1024 ** 3;
/**
 * Where a lint writes the Vite config's `lint` config for Oxlint: in the website's root, which
 * the config's paths, such as its `ignorePatterns`, are relative to, as in the Vite config.
 */
const LINT_CONFIG = ".camox-oxlintrc.json";
/** How the builder loads the Vite config for its `lint` config: as a build does. */
const LINT_CONFIG_ENV = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};
/** Vite+'s CLI, which lints when no builder can. */
const VP = "node_modules/.bin/vp";
/** The prefix of the line `build` prints what the API logs of a build on. */
const REPORT_PREFIX = "camox-builder: ";
/**
 * The Template's Vite plugins, loaded as the builder starts, when the workspace may hold only
 * the files its install reads: the config file that imports them comes with the build's tree.
 * A website without one of them doesn't load it.
 */
const PLUGINS = [
  "@cloudflare/vite-plugin",
  "@tailwindcss/vite",
  "@vitejs/plugin-react",
  "camox/vite",
];

const root = process.cwd();
/** The digest of the lockfile the workspace's install is of, which the API writes. */
const installedLockfile = () => {
  try {
    return readFileSync(join(root, "node_modules/.camox-installed-lockfile"), "utf8").trim();
  } catch {
    return null;
  }
};

/** Sends one message to the builder and reads its answer. */
function ask(message) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET);
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(`${JSON.stringify(message)}\n`));
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("end", () => {
      try {
        resolve(JSON.parse(answer));
      } catch {
        reject(new Error("The builder left without answering"));
      }
    });
    socket.on("error", reject);
  });
}

/** A line telling the API what it logs of a build. */
const report = (fields) => `${REPORT_PREFIX}${JSON.stringify(fields)}\n`;

async function build() {
  const answer = await askStarting({ type: "build" });
  if (answer.unavailable) {
    process.stderr.write(report({ unavailable: answer.unavailable }));
    process.exit(UNAVAILABLE);
  }
  const { log, ...fields } = answer;
  process.stdout.write(report(fields));
  process.stderr.write(log);
  process.exit(answer.ok ? 0 : 1);
}

/** Runs `file` with `args` in the workspace, without a shell, to its end. */
function run(file, args, env = process.env) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: root, env, maxBuffer: 64 * 1024 ** 2 }, (error, stdout, stderr) => {
      const exitCode = !error ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/**
 * Asks the builder, waiting for one the API just started to listen. Answers that it's
 * `unavailable` when none is up.
 */
async function askStarting(message) {
  const startedAt = Date.now();
  for (;;) {
    try {
      return await ask(message);
    } catch (error) {
      const starting = error?.code === "ENOENT" || error?.code === "ECONNREFUSED";
      if (!starting || Date.now() - startedAt > LISTEN_WAIT_MS) {
        return { unavailable: String(error?.message ?? error) };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function lint(list) {
  const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
  const answer = await askStarting({ type: "lint", files });
  if (!answer.unavailable) {
    process.stdout.write(answer.output);
    process.exit(answer.exitCode);
  }
  const linted = await run(VP, ["lint", "--format", "json", "--", ...files]);
  process.stdout.write(linted.stdout);
  process.stderr.write(linted.stderr);
  process.exit(linted.exitCode);
}

/** The host's CPU clock, which tells apart the two kinds of hosts sandboxes land on (#649). */
function cpuMhz() {
  try {
    const mhz = /^cpu MHz\s*:\s*([\d.]+)/m.exec(readFileSync("/proc/cpuinfo", "utf8"));
    return mhz ? Math.round(Number(mhz[1])) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads the workspace's Vite and plugins. A module importing them from inside the workspace
 * resolves them as its config file does, to the same modules.
 */
async function load() {
  const importer = join(root, "node_modules/.camox-revision-builder-import.mjs");
  writeFileSync(importer, "export default (specifier) => import(specifier);\n");
  const { default: importFromWorkspace } = await import(pathToFileURL(importer).href);
  const vite = await importFromWorkspace("vite");
  await Promise.allSettled(PLUGINS.map(importFromWorkspace));
  return vite;
}

/** Holds what the process prints until `release`, which returns it. */
function holdOutput() {
  const held = [];
  const hold = (chunk, encoding, callback) => {
    held.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    (typeof encoding === "function" ? encoding : callback)?.();
    return true;
  };
  // An own `write` over the streams' prototype's, which deleting it gives back.
  process.stdout.write = hold;
  process.stderr.write = hold;
  return () => {
    delete process.stdout.write;
    delete process.stderr.write;
    return held.join("");
  };
}

/** What a revision's build leaves out of a website's own build. */
const revisionBuild = {
  name: "camox:revision-build",
  enforce: "post",
  config: () => ({ build: { sourcemap: false, reportCompressedSize: false } }),
  configEnvironment: () => ({ build: { sourcemap: false, reportCompressedSize: false } }),
};

async function serve() {
  const lockfile = installedLockfile();
  // One builder per sandbox: one of the install the workspace holds stays.
  const running = await ask({ type: "hello" }).catch(() => null);
  if (running?.lockfile === lockfile) return;
  if (running) await ask({ type: "leave" }).catch(() => undefined);
  rmSync(SOCKET, { force: true });

  const vite = load();
  // A build that can't load Vite answers that no builder can build.
  vite.catch(() => undefined);
  const mhz = cpuMhz();
  let builds = 0;
  let queue = Promise.resolve();

  const runBuild = async () => {
    if (installedLockfile() !== lockfile) {
      setImmediate(() => process.exit(0));
      return { unavailable: "the workspace installed another lockfile" };
    }
    let createBuilder;
    try {
      ({ createBuilder } = await vite);
    } catch (error) {
      return { unavailable: `Vite didn't load: ${error?.message ?? error}` };
    }
    builds += 1;
    const startedAt = Date.now();
    const release = holdOutput();
    let ok = true;
    let failure = "";
    try {
      const builder = await createBuilder({ root, plugins: [revisionBuild] });
      await builder.buildApp();
    } catch (error) {
      ok = false;
      // As `vite build` prints it, which the API reads errors from (build-log.ts).
      failure = `error during build:\n${error?.stack ?? error}\n`;
    }
    const log = release() + failure;
    if (process.memoryUsage().rss > MAX_RSS_BYTES) setImmediate(() => process.exit(0));
    return { ok, log, build: builds, ms: Date.now() - startedAt, cpuMhz: mhz };
  };

  /** Oxlint's CLI, as the workspace's Vite+ runs it. */
  const oxlint = () => {
    const vitePlus = realpathSync(join(root, "node_modules/vite-plus/package.json"));
    const oxlintPackage = createRequire(vitePlus).resolve("oxlint/package.json");
    return join(dirname(oxlintPackage), "bin", "oxlint");
  };

  /** Lints `files` with Oxlint and the Vite config's `lint` config. */
  const runLint = async (files) => {
    if (installedLockfile() !== lockfile) {
      return { unavailable: "the workspace installed another lockfile" };
    }
    let loadConfigFromFile;
    try {
      ({ loadConfigFromFile } = await vite);
    } catch (error) {
      return { unavailable: `Vite didn't load: ${error?.message ?? error}` };
    }
    try {
      const loaded = await loadConfigFromFile(LINT_CONFIG_ENV, undefined, root, "silent");
      const config = loaded?.config.lint ?? {};
      // Type-aware rules need tsgolint, which `vp lint` finds.
      if (config.options?.typeAware) return { unavailable: "the lint config is type-aware" };
      writeFileSync(join(root, LINT_CONFIG), JSON.stringify(config));
      // Without Vite+'s variable, Oxlint reads only the config it's given.
      const { VP_VERSION: _, ...env } = process.env;
      const linted = await run(
        process.execPath,
        [oxlint(), "-c", LINT_CONFIG, "--format", "json", "--", ...files],
        env,
      );
      return { output: linted.stdout, exitCode: linted.exitCode };
    } catch (error) {
      return { unavailable: `The builder couldn't lint: ${error?.message ?? error}` };
    }
  };

  // Half open: a request ends the client's side, and the answer then goes back on the other.
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (request += chunk));
    socket.on("end", () => {
      let message;
      try {
        message = JSON.parse(request);
      } catch {
        socket.destroy();
        return;
      }
      if (message.type === "hello") socket.end(JSON.stringify({ lockfile }));
      else if (message.type === "leave") {
        socket.end(JSON.stringify({}));
        setImmediate(() => process.exit(0));
      } else if (message.type === "lint" && Array.isArray(message.files)) {
        // Beside the build: a lint only reads the workspace.
        void runLint(message.files)
          .catch((error) => ({ unavailable: `The builder failed: ${error?.stack ?? error}` }))
          .then((answer) => socket.end(JSON.stringify(answer)));
      } else if (message.type === "build") {
        // One build at a time: they share the workspace.
        queue = queue
          .then(runBuild)
          .catch((error) => ({ unavailable: `The builder failed: ${error?.stack ?? error}` }))
          .then((answer) => socket.end(JSON.stringify(answer)));
      } else socket.destroy();
    });
    socket.on("error", () => undefined);
  });
  server.listen(SOCKET, () => {
    // A builder whose socket another took over leaves: nothing can reach it.
    const { ino } = statSync(SOCKET);
    setInterval(() => {
      if (!existsSync(SOCKET) || statSync(SOCKET).ino !== ino) process.exit(0);
    }, 10_000).unref();
  });
}

const mode = process.argv[2];
if (mode === "serve") await serve();
else if (mode === "build") await build();
else if (mode === "lint" && process.argv[3]) await lint(process.argv[3]);
else {
  process.stderr.write("Usage: revision-builder.mjs serve|build|lint <list>\n");
  process.exit(2);
}
