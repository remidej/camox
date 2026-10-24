// A Git server for the fake Cloudflare Artifacts namespace (release-fakes.js): bare repos held in
// memory, served over Git's smart HTTP protocol the way Cloudflare Artifacts serves a repo's
// `remote`, so that isomorphic-git clones from them and pushes to them as it does in production.
// Only what isomorphic-git asks for is served: a full or depth-limited clone or fetch of any
// branch or reachable commit, a fetch from a shallow clone of the history since the commits it
// has (its `haves`, where it finds a merge base), and a push to any branch with `report-status` over
// `side-band-64k`, creating or deleting it. Every push to `main` is recorded as the event
// Cloudflare Artifacts sends for it, for the tests to deliver (test/pushes.ts).
import git from "isomorphic-git";

import { MemoryFs } from "../src/lib/memory-fs";

/** The host the fake repos' remotes are on. The tests route the API's outbound fetches to it. */
export const FAKE_GIT_HOST = "artifacts.camox.test";

/** The write token the fake's `createToken` mints, which a push must present. */
export const FAKE_WRITE_TOKEN = "artifacts-write-token";

const ZERO = "0".repeat(40);
const MAIN = "refs/heads/main";
const AUTHOR = {
  name: "Camox",
  email: "noreply@camox.ai",
  timestamp: 1_700_000_000,
  timezoneOffset: 0,
};

const repos = new Map<string, MemoryFs>();
/** The `cf.artifacts.repo.pushed` events of each repo's pushes to `main`, not delivered yet. */
const pushEvents = new Map<string, PushEvent[]>();
/** Repos whose next push lands but answers with an error, as if the response were lost. */
const lostPushResponses = new Set<string>();

const bare = (fs: MemoryFs) => ({ fs, dir: "/", gitdir: "/" });

export function hasGitRepo(name: string) {
  return repos.has(name);
}

/** The event Cloudflare Artifacts sends for a push, which starts the release Workflow. */
export type PushEvent = {
  type: "cf.artifacts.repo.pushed";
  source: { type: "artifacts.repo"; namespace: "projects"; repoName: string };
  payload: {
    ref: string;
    before: string;
    after: string;
    commits: { id: string; message: string; author: { name: string; email: string } }[];
  };
};

function recordPush(name: string, before: string, after: string, message: string) {
  const event: PushEvent = {
    type: "cf.artifacts.repo.pushed",
    source: { type: "artifacts.repo", namespace: "projects", repoName: name },
    payload: {
      ref: MAIN,
      before,
      after,
      commits: [{ id: after, message, author: { name: AUTHOR.name, email: AUTHOR.email } }],
    },
  };
  pushEvents.set(name, [...(pushEvents.get(name) ?? []), event]);
}

/** The push events of `name` since the last call, oldest first. */
export function takePushEvents(name: string) {
  const events = pushEvents.get(name) ?? [];
  pushEvents.delete(name);
  return events;
}

/** A file's content, or a symlink to `symlink`. */
export type FakeFile = string | { symlink: string };

/**
 * Commits `files` as the whole tree of `main` in `name`, creating the repo if needed, as a push
 * from outside Camox would: the push is recorded as its event.
 */
export async function commitFiles(name: string, files: Record<string, FakeFile>, message: string) {
  let fs = repos.get(name);
  if (!fs) {
    fs = new MemoryFs();
    await git.init({ ...bare(fs), bare: true, defaultBranch: "main" });
    repos.set(name, fs);
  }
  const tree = await writeTree(fs, files);
  const parent = await git.resolveRef({ ...bare(fs), ref: MAIN }).catch(() => null);
  const commit = await git.writeCommit({
    ...bare(fs),
    commit: {
      message: `${message}\n`,
      tree,
      parent: parent ? [parent] : [],
      author: AUTHOR,
      committer: AUTHOR,
    },
  });
  await git.writeRef({ ...bare(fs), ref: MAIN, value: commit, force: true });
  recordPush(name, parent ?? ZERO, commit, message);
  return commit;
}

async function writeTree(fs: MemoryFs, files: Record<string, FakeFile>): Promise<string> {
  const here = new Map<string, FakeFile>();
  const below = new Map<string, Record<string, FakeFile>>();
  for (const [path, content] of Object.entries(files)) {
    const [head, ...rest] = path.split("/");
    if (rest.length === 0) here.set(head!, content);
    else below.set(head!, { ...below.get(head!), [rest.join("/")]: content });
  }
  const entries = [];
  for (const [path, file] of here) {
    const link = typeof file === "object";
    const content = link ? file.symlink : file;
    const oid = await git.writeBlob({ ...bare(fs), blob: new TextEncoder().encode(content) });
    entries.push({ mode: link ? "120000" : "100644", path, oid, type: "blob" as const });
  }
  for (const [path, subtree] of below) {
    entries.push({
      mode: "040000",
      path,
      oid: await writeTree(fs, subtree),
      type: "tree" as const,
    });
  }
  return git.writeTree({ ...bare(fs), tree: entries });
}

/** Copies a repo under a new name, as a fork does. */
export function forkGitRepo(from: string, to: string) {
  const source = repos.get(from);
  if (!source) throw new Error(`No repo to fork: ${from}`);
  repos.set(to, source.copy());
}

export function deleteGitRepo(name: string) {
  return repos.delete(name);
}

/** A file at a branch or commit, or null. */
export async function readGitFile(name: string, ref: string, path: string) {
  const fs = repos.get(name);
  if (!fs) return null;
  try {
    const oid = await git.resolveRef({ ...bare(fs), ref }).catch(() => ref);
    const { blob } = await git.readBlob({ ...bare(fs), oid, filepath: path });
    return new TextDecoder().decode(blob);
  } catch {
    return null;
  }
}

/** A commit with its tree and parents, as the Artifacts binding's `readCommit` decodes it. */
export async function readGitCommit(name: string, hash: string) {
  const fs = repos.get(name);
  if (!fs) return null;
  try {
    const { commit } = await git.readCommit({ ...bare(fs), oid: hash });
    return { hash, treeHash: commit.tree, parents: commit.parent };
  } catch {
    return null;
  }
}

/** Where a symlink at a branch or commit points, or null when it isn't one. */
export async function readGitLink(name: string, ref: string, path: string) {
  const fs = repos.get(name);
  if (!fs) return null;
  try {
    const oid = await git.resolveRef({ ...bare(fs), ref }).catch(() => ref);
    const slash = path.lastIndexOf("/");
    const { tree } = await git.readTree({
      ...bare(fs),
      oid,
      filepath: slash === -1 ? undefined : path.slice(0, slash),
    });
    const entry = tree.find(({ path: entryPath }) => entryPath === path.slice(slash + 1));
    if (entry?.mode !== "120000") return null;
    const { blob } = await git.readBlob({ ...bare(fs), oid: entry.oid });
    return new TextDecoder().decode(blob);
  } catch {
    return null;
  }
}

/** The regular files of a branch or commit, by path, as text, or null without that commit. */
export async function gitFiles(name: string, ref: string) {
  const fs = repos.get(name);
  if (!fs) return null;
  const oid = await git.resolveRef({ ...bare(fs), ref }).catch(() => ref);
  const files: Record<string, string> = {};
  try {
    await git.walk({
      ...bare(fs),
      trees: [git.TREE({ ref: oid })],
      map: async (path, [entry]) => {
        if (entry && path !== "." && (await entry.type()) === "blob") {
          files[path] = new TextDecoder().decode((await entry.content())!);
        }
        return true;
      },
    });
  } catch {
    return null;
  }
  return files;
}

/** The commits on `main`, newest first, with their message. */
export async function gitLog(name: string) {
  const fs = repos.get(name);
  if (!fs) return [];
  const commits = await git.log({ ...bare(fs), ref: MAIN }).catch(() => []);
  return commits.map(({ oid, commit }) => ({ oid, message: commit.message.trimEnd() }));
}

export function losePushResponse(name: string) {
  lostPushResponses.add(name);
}

// --- Smart HTTP ---

const encoder = new TextEncoder();

function pktLine(payload: string | Uint8Array) {
  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
  const line = new Uint8Array(4 + bytes.byteLength);
  line.set(encoder.encode((4 + bytes.byteLength).toString(16).padStart(4, "0")));
  line.set(bytes, 4);
  return line;
}

const FLUSH = encoder.encode("0000");

function concat(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Multiplexes `data` on side band 1, in pkt-lines `side-band-64k` allows. */
function sideBand(data: Uint8Array) {
  const chunks = [];
  for (let at = 0; at < data.byteLength; at += 65515) {
    chunks.push(pktLine(concat([new Uint8Array([1]), data.subarray(at, at + 65515)])));
  }
  return chunks;
}

/** Reads pkt-lines up to the first flush, and returns them with the bytes after it. */
function readPktLines(body: Uint8Array) {
  const lines: string[] = [];
  let at = 0;
  while (at + 4 <= body.byteLength) {
    const length = parseInt(new TextDecoder().decode(body.subarray(at, at + 4)), 16);
    at += 4;
    if (length === 0) break;
    lines.push(new TextDecoder().decode(body.subarray(at, at + length - 4)));
    at += length - 4;
  }
  return { lines, rest: body.subarray(at) };
}

/** Every branch of a repo, `main` first, with the commit it points to. */
async function branchesOf(fs: MemoryFs) {
  const names = await git.listBranches(bare(fs));
  const refs = [];
  for (const name of names.sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : 0))) {
    const ref = `refs/heads/${name}`;
    refs.push({ ref, oid: await git.resolveRef({ ...bare(fs), ref }) });
  }
  return refs;
}

/** The branches of a Git repo, `main` first, without `refs/heads/`. */
export async function gitBranches(name: string) {
  const fs = repos.get(name);
  if (!fs) return [];
  return (await branchesOf(fs)).map(({ ref }) => ref.slice("refs/heads/".length));
}

async function advertise(fs: MemoryFs, service: string) {
  const branches = await branchesOf(fs);
  const head = branches.find(({ ref }) => ref === MAIN)?.oid;
  const capabilities =
    service === "git-receive-pack"
      ? "report-status side-band-64k delete-refs agent=camox-fake"
      : `side-band-64k ofs-delta shallow allow-reachable-sha1-in-want symref=HEAD:${MAIN} agent=camox-fake`;
  const refs = [
    ...(service === "git-upload-pack" && head ? [{ ref: "HEAD", oid: head }] : []),
    ...branches,
  ];
  const lines =
    refs.length > 0
      ? refs.map(({ ref, oid }, at) =>
          pktLine(`${oid} ${ref}${at === 0 ? `\0${capabilities}` : ""}\n`),
        )
      : [pktLine(`${ZERO} capabilities^{}\0${capabilities}\n`)];
  return concat([pktLine(`# service=${service}\n`), FLUSH, ...lines, FLUSH]);
}

/**
 * Every object reachable from `commits`, through at most `depth` commits of history when given,
 * down to the commits the client has, `haves`, which it holds with their trees: the history a
 * shallow fetch from a known commit sends.
 */
async function reachable(
  fs: MemoryFs,
  commits: string[],
  depth = Number.POSITIVE_INFINITY,
  haves: string[] = [],
) {
  const held = new Set<string>();
  for (const have of haves) {
    const commit = await git.readCommit({ ...bare(fs), oid: have }).catch(() => null);
    if (!commit) continue;
    held.add(have);
    await collectTree(fs, commit.commit.tree, held);
  }
  const seen = new Set<string>(held);
  const visitTree = async (oid: string) => {
    if (seen.has(oid)) return;
    seen.add(oid);
    const { tree } = await git.readTree({ ...bare(fs), oid });
    for (const entry of tree) {
      if (entry.type === "tree") await visitTree(entry.oid);
      else seen.add(entry.oid);
    }
  };
  /** The commits whose parents the depth leaves out: what the client records as shallow. */
  const shallow: string[] = [];
  const queue = commits.map((oid) => ({ oid, level: 1 }));
  while (queue.length > 0) {
    const { oid, level } = queue.pop()!;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const { commit } = await git.readCommit({ ...bare(fs), oid });
    await visitTree(commit.tree);
    if (level >= depth) {
      if (commit.parent.length > 0) shallow.push(oid);
      continue;
    }
    queue.push(...commit.parent.map((parent) => ({ oid: parent, level: level + 1 })));
  }
  return { oids: [...seen].filter((oid) => !held.has(oid)), shallow };
}

/** Adds the tree `oid` and everything in it to `into`. */
async function collectTree(fs: MemoryFs, oid: string, into: Set<string>) {
  if (into.has(oid)) return;
  into.add(oid);
  const { tree } = await git.readTree({ ...bare(fs), oid });
  for (const entry of tree) {
    if (entry.type === "tree") await collectTree(fs, entry.oid, into);
    else into.add(entry.oid);
  }
}

async function uploadPack(fs: MemoryFs, body: Uint8Array) {
  const { lines } = readPktLines(body);
  const wants = lines.filter((l) => l.startsWith("want ")).map((l) => l.slice(5, 45));
  const haves = lines.filter((l) => l.startsWith("have ")).map((l) => l.slice(5, 45));
  const deepen = lines.find((l) => l.startsWith("deepen "));
  const { oids, shallow } = await reachable(
    fs,
    wants,
    deepen ? Number(deepen.slice(7)) : undefined,
    haves,
  );
  const { packfile } = await git.packObjects({ ...bare(fs), oids, write: false });
  return concat([
    ...shallow.map((oid) => pktLine(`shallow ${oid}\n`)),
    pktLine("NAK\n"),
    ...sideBand(packfile!),
    FLUSH,
  ]);
}

async function receivePack(name: string, fs: MemoryFs, body: Uint8Array) {
  const { lines, rest } = readPktLines(body);
  const [command] = lines;
  const [oldOid, newOid, ref] = command!.split("\0")[0]!.trim().split(" ");
  const current = await git.resolveRef({ ...bare(fs), ref: ref! }).catch(() => ZERO);
  let status = `ok ${ref}\n`;
  if (current !== oldOid) {
    status = `ng ${ref} fetch first\n`;
  } else if (newOid === ZERO) {
    await git.deleteRef({ ...bare(fs), ref: ref! });
  } else {
    // A pack of no objects, as a push creating a branch at a commit the repo has sends.
    const objects =
      rest.byteLength >= 12 ? new DataView(rest.buffer, rest.byteOffset).getUint32(8) : 0;
    if (objects > 0) {
      const path = `objects/pack/pack-${crypto.randomUUID()}.pack`;
      await fs.promises.mkdir("/objects/pack").catch(() => undefined);
      await fs.promises.writeFile(`/${path}`, rest);
      await git.indexPack({ ...bare(fs), filepath: path });
    }
    await git.writeRef({ ...bare(fs), ref: ref!, value: newOid!, force: true });
    if (ref === MAIN) {
      const { commit } = await git.readCommit({ ...bare(fs), oid: newOid! });
      recordPush(name, oldOid!, newOid!, commit.message.trimEnd());
    }
  }
  const report = concat([pktLine("unpack ok\n"), pktLine(status), FLUSH]);
  return concat([...sideBand(report), FLUSH]);
}

const REPO_PATH = /^\/git\/[^/]+\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;

/** Serves `request`, for a remote on `FAKE_GIT_HOST`. */
export async function serveGit(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const match = REPO_PATH.exec(url.pathname);
  const fs = match && repos.get(match[1]!);
  if (!match || !fs) return new Response("Repository not found", { status: 404 });
  const [, name, endpoint] = match;
  const service = endpoint === "info/refs" ? url.searchParams.get("service") : endpoint;
  if (service === "git-receive-pack") {
    if (request.headers.get("authorization") !== `Bearer ${FAKE_WRITE_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (endpoint === "info/refs") {
    return new Response(await advertise(fs, service!), {
      headers: { "content-type": `application/x-${service}-advertisement` },
    });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (service === "git-upload-pack") {
    return new Response(await uploadPack(fs, body), {
      headers: { "content-type": "application/x-git-upload-pack-result" },
    });
  }
  const response = await receivePack(name!, fs, body);
  if (lostPushResponses.delete(name!)) return new Response("Bad gateway", { status: 502 });
  return new Response(response, {
    headers: { "content-type": "application/x-git-receive-pack-result" },
  });
}
