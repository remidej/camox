import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { HttpRemoteCache } from "nx/src/native";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import worker, { type Env } from "./worker";

const TOKEN = "test-token";

/** An R2 bucket as the Worker uses it: whole objects, written once unless asked otherwise. */
function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    get: async (key: string) => {
      const body = objects.get(key);
      return body ? { body: new Response(body).body } : null;
    },
    put: async (
      key: string,
      value: ReadableStream,
      options?: { onlyIf?: { etagDoesNotMatch?: string } },
    ) => {
      const body = new Uint8Array(await new Response(value).arrayBuffer());
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      objects.set(key, body);
      return { key };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

/** Serves the Worker over HTTP in Node, so Nx's own client can talk to it. */
async function serve(env: Env): Promise<{ url: string; server: Server }> {
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://localhost${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      body: body.byteLength ? body : undefined,
    });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, server };
}

/** Nx's client, which reads the server and token from the environment when it's built. */
function nxClient(url: string, token: string | undefined) {
  const previous = {
    server: process.env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER,
    token: process.env.NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN,
  };
  process.env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER = url;
  if (token === undefined) delete process.env.NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN;
  else process.env.NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN = token;
  try {
    return new HttpRemoteCache();
  } finally {
    for (const [key, value] of [
      ["NX_SELF_HOSTED_REMOTE_CACHE_SERVER", previous.server],
      ["NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN", previous.token],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("Nx remote cache Worker", () => {
  let dir: string;
  let url: string;
  let server: Server;
  let objects: Map<string, Uint8Array>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "nx-cache-"));
    const fake = fakeBucket();
    objects = fake.objects;
    ({ url, server } = await serve({ CACHE: fake.bucket, ACCESS_TOKEN: TOKEN }));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  /** A task's outputs in a local cache directory, as Nx leaves them before storing. */
  async function taskOutputs(cacheDir: string, hash: string, content: string) {
    await mkdir(path.join(cacheDir, hash, "dist"), { recursive: true });
    await writeFile(path.join(cacheDir, hash, "dist", "index.js"), content);
  }

  it("gives another machine a task's outputs, terminal output and exit code", async () => {
    const writer = path.join(dir, "writer");
    await taskOutputs(writer, "123", "built");
    expect(await nxClient(url, TOKEN).store("123", writer, "tests passed", 0)).toBe(true);

    const reader = path.join(dir, "reader");
    await mkdir(reader);
    const hit = await nxClient(url, TOKEN).retrieve("123", reader);

    expect(hit).toMatchObject({ code: 0, terminalOutput: "tests passed" });
    expect(await readFile(path.join(hit!.outputsPath, "dist", "index.js"), "utf8")).toBe("built");
  });

  it("misses a task nobody stored", async () => {
    expect(await nxClient(url, TOKEN).retrieve("456", dir)).toBeNull();
  });

  it("keeps the first entry stored for a hash", async () => {
    const first = path.join(dir, "first");
    const second = path.join(dir, "second");
    await taskOutputs(first, "789", "first");
    await taskOutputs(second, "789", "second");
    const client = nxClient(url, TOKEN);

    await client.store("789", first, "", 0);
    expect(await client.store("789", second, "", 0)).toBe(false);

    const reader = path.join(dir, "reader");
    await mkdir(reader);
    const hit = await client.retrieve("789", reader);
    expect(await readFile(path.join(hit!.outputsPath, "dist", "index.js"), "utf8")).toBe("first");
  });

  it("turns away a client without the token", async () => {
    await taskOutputs(dir, "123", "built");

    for (const token of ["wrong", undefined]) {
      const client = nxClient(url, token);
      await expect(client.store("123", dir, "", 0)).rejects.toThrow();
      await expect(client.retrieve("123", dir)).rejects.toThrow();
    }
    expect(objects.size).toBe(0);
  });
});
