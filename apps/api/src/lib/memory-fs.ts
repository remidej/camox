/**
 * A file system held in memory, with the promise API isomorphic-git asks for, so a Worker can
 * clone, commit and push a repo without a disk.
 */

type Node =
  | { kind: "file"; data: Uint8Array; mode: number; mtimeMs: number; ino: number }
  | { kind: "dir" };

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

  readonly promises = {
    readFile: async (path: string, options?: { encoding?: string } | string) => {
      const node = this.nodes.get(normalize(path));
      if (!node) throw fsError("ENOENT", path);
      if (node.kind === "dir") throw fsError("EISDIR", path);
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
      this.nodes.set(at, { kind: "file", data: bytes, mode, mtimeMs: Date.now(), ino: ++inodes });
    },
    unlink: async (path: string) => {
      const at = normalize(path);
      if (this.nodes.get(at)?.kind !== "file") throw fsError("ENOENT", path);
      this.nodes.delete(at);
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
      this.nodes.set(at, { kind: "dir" });
    },
    rmdir: async (path: string) => {
      const at = normalize(path);
      if (this.nodes.get(at)?.kind !== "dir") throw fsError("ENOENT", path);
      if ((await this.promises.readdir(at)).length > 0) throw fsError("ENOTEMPTY", path);
      this.nodes.delete(at);
    },
    stat: async (path: string) => this.stat(path),
    lstat: async (path: string) => this.stat(path),
    readlink: async (path: string): Promise<string> => {
      throw fsError("ENOENT", path);
    },
    symlink: async (_target: string, path: string): Promise<void> => {
      throw fsError("EPERM", path);
    },
    chmod: async (path: string, mode: number) => {
      const node = this.nodes.get(normalize(path));
      if (!node) throw fsError("ENOENT", path);
      if (node.kind === "file") node.mode = mode;
    },
  };

  /** An independent copy of every file and directory. */
  copy() {
    const copy = new MemoryFs();
    for (const [path, node] of this.nodes) {
      copy.nodes.set(path, node.kind === "file" ? { ...node, data: node.data.slice() } : node);
    }
    return copy;
  }

  private stat(path: string) {
    const node = this.nodes.get(normalize(path));
    if (!node) throw fsError("ENOENT", path);
    const file = node.kind === "file";
    const mtimeMs = file ? node.mtimeMs : 0;
    return {
      type: file ? "file" : "dir",
      mode: file ? node.mode : 0o40000,
      size: file ? node.data.byteLength : 0,
      ino: file ? node.ino : 0,
      mtimeMs,
      ctimeMs: mtimeMs,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => file,
      isDirectory: () => !file,
      isSymbolicLink: () => false,
    };
  }
}
