/**
 * A file system held in memory, with the promise API isomorphic-git asks for, so a Worker can
 * clone, commit and push a repo without a disk. Symlinks are followed only as a path's last
 * part, which is all a checkout needs: Git stores a link, never a path through one.
 *
 * It records the paths each change touches, so whoever keeps it elsewhere stores only those.
 */

type Node =
  | { kind: "file"; data: Uint8Array; mode: number; mtimeMs: number; ino: number }
  | { kind: "symlink"; target: string; mtimeMs: number; ino: number }
  | { kind: "dir" };

/** What a path holds, as `MemoryFs.entry` gives it to be stored and `MemoryFs.from` takes it. */
export type MemoryFsEntry =
  | { path: string; kind: "file"; data: Uint8Array; mode: number }
  | { path: string; kind: "symlink"; target: string }
  | { path: string; kind: "dir" };

/** How many links a path may go through before it's taken for a loop, as Linux's limit. */
const MAX_LINKS = 40;

function fsError(code: string, path: string) {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentOf(path: string) {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

let inodes = 0;

export class MemoryFs {
  private readonly nodes = new Map<string, Node>([["/", { kind: "dir" }]]);
  /** The paths changed since `takeChanges` was last called. */
  private changed = new Set<string>();

  private put(path: string, node: Node) {
    this.nodes.set(path, node);
    this.changed.add(path);
  }

  private drop(path: string) {
    this.nodes.delete(path);
    this.changed.add(path);
  }

  readonly promises = {
    readFile: async (path: string, options?: { encoding?: string } | string) => {
      const node = this.nodes.get(this.resolve(path));
      if (!node) throw fsError("ENOENT", path);
      if (node.kind !== "file") throw fsError("EISDIR", path);
      const encoding = typeof options === "string" ? options : options?.encoding;
      return encoding ? new TextDecoder().decode(node.data) : node.data;
    },
    writeFile: async (
      path: string,
      data: Uint8Array | string,
      options?: { mode?: number } | string,
    ) => {
      const at = normalize(path);
      if (this.nodes.get(parentOf(at))?.kind !== "dir") throw fsError("ENOENT", path);
      if (this.nodes.get(at)?.kind === "dir") throw fsError("EISDIR", path);
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      const mode = (typeof options === "object" && options.mode) || 0o100644;
      this.put(at, { kind: "file", data: bytes, mode, mtimeMs: Date.now(), ino: ++inodes });
    },
    unlink: async (path: string) => {
      const at = normalize(path);
      const kind = this.nodes.get(at)?.kind;
      if (kind !== "file" && kind !== "symlink") throw fsError("ENOENT", path);
      this.drop(at);
    },
    readdir: async (path: string) => {
      const at = normalize(path);
      const node = this.nodes.get(at);
      if (!node) throw fsError("ENOENT", path);
      if (node.kind !== "dir") throw fsError("ENOTDIR", path);
      const prefix = at === "/" ? "/" : `${at}/`;
      return [...this.nodes.keys()]
        .filter((key) => key !== at && key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((rest) => !rest.includes("/"));
    },
    mkdir: async (path: string) => {
      const at = normalize(path);
      if (this.nodes.has(at)) throw fsError("EEXIST", path);
      if (this.nodes.get(parentOf(at))?.kind !== "dir") throw fsError("ENOENT", path);
      this.put(at, { kind: "dir" });
    },
    rmdir: async (path: string) => {
      const at = normalize(path);
      if (this.nodes.get(at)?.kind !== "dir") throw fsError("ENOENT", path);
      if ((await this.promises.readdir(at)).length > 0) throw fsError("ENOTEMPTY", path);
      this.drop(at);
    },
    stat: async (path: string) => this.stat(this.resolve(path), path),
    lstat: async (path: string) => this.stat(normalize(path), path),
    readlink: async (path: string) => {
      const node = this.nodes.get(normalize(path));
      if (!node) throw fsError("ENOENT", path);
      if (node.kind !== "symlink") throw fsError("EINVAL", path);
      return node.target;
    },
    symlink: async (target: string, path: string) => {
      const at = normalize(path);
      if (this.nodes.has(at)) throw fsError("EEXIST", path);
      if (this.nodes.get(parentOf(at))?.kind !== "dir") throw fsError("ENOENT", path);
      this.put(at, { kind: "symlink", target, mtimeMs: Date.now(), ino: ++inodes });
    },
    /** Moves a file, link or directory with everything below it, replacing a file at `to`. */
    rename: async (from: string, to: string) => {
      const source = normalize(from);
      const target = normalize(to);
      const node = this.nodes.get(source);
      if (!node || source === "/") throw fsError("ENOENT", from);
      if (this.nodes.get(parentOf(target))?.kind !== "dir") throw fsError("ENOENT", to);
      if (source === target) return;
      if (target.startsWith(`${source}/`)) throw fsError("EINVAL", to);
      const replaced = this.nodes.get(target);
      if (replaced?.kind === "dir") {
        if (node.kind !== "dir") throw fsError("EISDIR", to);
        if ((await this.promises.readdir(target)).length > 0) throw fsError("ENOTEMPTY", to);
      } else if (replaced && node.kind === "dir") throw fsError("ENOTDIR", to);
      const moved = [...this.nodes].filter(
        ([path]) => path === source || path.startsWith(`${source}/`),
      );
      for (const [path] of moved) this.drop(path);
      for (const [path, moving] of moved) this.put(`${target}${path.slice(source.length)}`, moving);
    },
    chmod: async (path: string, mode: number) => {
      const at = normalize(path);
      const node = this.nodes.get(at);
      if (!node) throw fsError("ENOENT", path);
      if (node.kind === "file") this.put(at, { ...node, mode });
    },
  };

  /**
   * The paths changed since the last call, each added, replaced or removed, in no particular
   * order: what `entry` gives for each is what to store now.
   */
  takeChanges() {
    const changed = [...this.changed];
    this.changed = new Set();
    return changed;
  }

  /** What `path` holds, or undefined when nothing is there. */
  entry(path: string): MemoryFsEntry | undefined {
    const at = normalize(path);
    const node = this.nodes.get(at);
    if (!node) return undefined;
    if (node.kind === "file") return { path: at, kind: "file", data: node.data, mode: node.mode };
    if (node.kind === "symlink") return { path: at, kind: "symlink", target: node.target };
    return { path: at, kind: "dir" };
  }

  /** Every path's entry, parents before what they hold. */
  entries(): MemoryFsEntry[] {
    return [...this.nodes.keys()].sort().map((path) => this.entry(path)!);
  }

  /** A file system holding `entries`, with no changes to take. */
  static from(entries: Iterable<MemoryFsEntry>) {
    const fs = new MemoryFs();
    const now = Date.now();
    for (const entry of entries) {
      fs.nodes.set(
        normalize(entry.path),
        entry.kind === "file"
          ? { kind: "file", data: entry.data, mode: entry.mode, mtimeMs: now, ino: ++inodes }
          : entry.kind === "symlink"
            ? { kind: "symlink", target: entry.target, mtimeMs: now, ino: ++inodes }
            : { kind: "dir" },
      );
    }
    return fs;
  }

  /** An independent copy of every file and directory. */
  copy() {
    const copy = new MemoryFs();
    for (const [path, node] of this.nodes) {
      copy.nodes.set(
        path,
        node.kind === "file" ? { ...node, data: node.data.slice() } : { ...node },
      );
    }
    return copy;
  }

  /** The path `path` names once the symlinks it ends in are followed. */
  private resolve(path: string) {
    let at = normalize(path);
    for (let links = 0; links < MAX_LINKS; links++) {
      const node = this.nodes.get(at);
      if (node?.kind !== "symlink") return at;
      at = normalize(node.target.startsWith("/") ? node.target : `${parentOf(at)}/${node.target}`);
    }
    throw fsError("ELOOP", path);
  }

  /** What's at `at`, a normalized path, without following it; `path` names it in errors. */
  private stat(at: string, path: string) {
    const node = this.nodes.get(at);
    if (!node) throw fsError("ENOENT", path);
    const { kind } = node;
    const mtimeMs = kind === "dir" ? 0 : node.mtimeMs;
    return {
      type: kind,
      mode: kind === "file" ? node.mode : kind === "symlink" ? 0o120000 : 0o40000,
      size:
        kind === "file"
          ? node.data.byteLength
          : kind === "symlink"
            ? new TextEncoder().encode(node.target).byteLength
            : 0,
      ino: kind === "dir" ? 0 : node.ino,
      mtimeMs,
      ctimeMs: mtimeMs,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => kind === "file",
      isDirectory: () => kind === "dir",
      isSymbolicLink: () => kind === "symlink",
    };
  }
}
