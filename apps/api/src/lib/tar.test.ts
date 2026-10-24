import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { tar, untarGzip } from "./tar";

const temps: string[] = [];

afterEach(async () => {
  for (const temp of temps.splice(0)) await rm(temp, { recursive: true, force: true });
});

/** Extracts `archive` with the system's `tar`, as a sandbox does, into a new directory. */
async function extracted(archive: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), "camox-tar-"));
  temps.push(dir);
  await writeFile(join(dir, "archive.tar"), archive);
  await promisify(execFile)("tar", ["-xf", "archive.tar"], { cwd: dir });
  return dir;
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("tar", () => {
  it("archives files, long paths, symlinks and modes as tar extracts them", async () => {
    const long = `src/${"nested/".repeat(20)}deep-block-with-a-long-name.tsx`;
    const dir = await extracted(
      tar([
        { path: "package.json", mode: 0o644, content: bytes(`{ "name": "acme" }\n`) },
        { path: "src/blocks/hero.tsx", mode: 0o644, content: bytes("export const é = 1;\n") },
        { path: long, mode: 0o644, content: bytes("export {};\n") },
        { path: "scripts/run.sh", mode: 0o755, content: bytes("#!/bin/sh\n") },
        { path: "src/empty.css", mode: 0o644, content: new Uint8Array() },
        { path: "src/link.ts", symlink: "blocks/hero.tsx" },
      ]),
    );

    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(`{ "name": "acme" }\n`);
    expect(await readFile(join(dir, "src/blocks/hero.tsx"), "utf8")).toBe("export const é = 1;\n");
    expect(await readFile(join(dir, long), "utf8")).toBe("export {};\n");
    expect((await stat(join(dir, "scripts/run.sh"))).mode & 0o111).not.toBe(0);
    expect(await readFile(join(dir, "src/empty.css"), "utf8")).toBe("");
    expect(await readlink(join(dir, "src/link.ts"))).toBe("blocks/hero.tsx");
  });
});

describe("untarGzip", () => {
  it("reads the files of a gzipped archive the system's tar wrote, long paths included", async () => {
    const dir = await mkdtemp(join(tmpdir(), "camox-untar-"));
    temps.push(dir);
    const long = `dist/${"nested/".repeat(20)}chunk-with-a-long-name.js`;
    await mkdir(join(dir, long, ".."), { recursive: true });
    await mkdir(join(dir, "dist/client"), { recursive: true });
    await writeFile(join(dir, long), "export {};\n");
    await writeFile(join(dir, "dist/client/index.css"), "body {}\n");
    // Without macOS bsdtar's AppleDouble files, which GNU tar never writes.
    await promisify(execFile)("tar", ["-czf", "build.tar.gz", "dist"], {
      cwd: dir,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });

    const archive = await readFile(join(dir, "build.tar.gz"));
    const files = await untarGzip(new Blob([archive]).stream());

    const decoder = new TextDecoder();
    expect(decoder.decode(files.get(long))).toBe("export {};\n");
    expect(decoder.decode(files.get("dist/client/index.css"))).toBe("body {}\n");
    expect([...files.keys()].sort()).toEqual(["dist/client/index.css", long].sort());
  });
});
