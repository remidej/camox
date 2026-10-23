// PROTOTYPE, throwaway (issue #550): how long one revision's build takes in the release Container.
//
//   PUT  /src/<variant>                 the working copy as a .tar.gz (stand-in for the draft DO's bytes)
//   POST /prime?size=2|4&variant=…      fresh sandbox, install with no cache, back up /workspace as the install cache
//   POST /build?size=…&variant=…&box=…&rev=…
//        box names the sandbox: a new name is a cold start, the same name again is warm.
//        Streams the working copy in, restores the install cache if node_modules is missing,
//        `pnpm install --frozen-lockfile`, `vp build --base /_camox/r/<rev>/`, then uploads
//        the output (no source maps) to R2 under builds/<rev>/.
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

// Production restores the install cache by downloading the squashfs archive from a presigned R2
// URL with parallel ranged curls, then mounting it with FUSE. Without R2 keys, this points the
// same code at /blob on this Worker, which streams the object from the R2 binding.
const BLOB = "https://prototype-550-revision-build.remidej.workers.dev/blob/";
const presignedGet = (key: string, secret: string) => `${BLOB}${key}?k=${secret}`;
// @ts-expect-error The override replaces a private method, on purpose.
export class Sandbox2 extends Sandbox {
  async generatePresignedGetURL(key: string) {
    return presignedGet(key, (this.env as Env).BLOB_SECRET);
  }
}
// @ts-expect-error The override replaces a private method, on purpose.
export class Sandbox4 extends Sandbox {
  async generatePresignedGetURL(key: string) {
    return presignedGet(key, (this.env as Env).BLOB_SECRET);
  }
}

type Env = {
  S2: DurableObjectNamespace<Sandbox2>;
  S4: DurableObjectNamespace<Sandbox4>;
  BACKUP_BUCKET: R2Bucket;
  BLOB_SECRET: string;
};

const W = "/workspace";
const EXEC = { timeout: 15 * 60_000 };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const q = (k: string) => url.searchParams.get(k) ?? "";
    if (request.method === "PUT" && url.pathname.startsWith("/src/")) {
      await env.BACKUP_BUCKET.put(`src/${url.pathname.slice(5)}.tgz`, request.body);
      return new Response("ok");
    }
    // Empties the bucket before it's deleted.
    if (url.pathname === "/wipe" && q("k") === env.BLOB_SECRET) {
      let n = 0;
      for (
        let page = await env.BACKUP_BUCKET.list();
        ;
        page = await env.BACKUP_BUCKET.list({ cursor: page.cursor })
      ) {
        if (page.objects.length) await env.BACKUP_BUCKET.delete(page.objects.map((o) => o.key));
        n += page.objects.length;
        if (!page.truncated) break;
      }
      return new Response(`deleted ${n}`);
    }
    // Stand-in for presigned PUT URLs: the Container uploads each file itself.
    if (request.method === "PUT" && url.pathname.startsWith("/put/")) {
      if (q("k") !== env.BLOB_SECRET) return new Response("no", { status: 403 });
      await env.BACKUP_BUCKET.put(url.pathname.slice(5), request.body);
      return new Response("ok");
    }
    if (url.pathname.startsWith("/blob/")) {
      if (q("k") !== env.BLOB_SECRET) return new Response("no", { status: 403 });
      const obj = await env.BACKUP_BUCKET.get(url.pathname.slice(6), { range: request.headers });
      if (!obj) return new Response("missing", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      if (obj.range && "offset" in obj.range) {
        const end = obj.range.offset! + obj.range.length! - 1;
        headers.set("content-range", `bytes ${obj.range.offset}-${end}/${obj.size}`);
        return new Response(obj.body, { status: 206, headers });
      }
      return new Response(obj.body, { headers });
    }
    const ns = q("size") === "4" ? env.S4 : env.S2;
    const variant = q("variant") || "tpl";
    const times: Record<string, number | string> = {};
    let t = Date.now();
    const lap = (name: string) => {
      const now = Date.now();
      times[name] = now - t;
      t = now;
    };
    const box = getSandbox(ns, q("box") || crypto.randomUUID(), {
      transport: "rpc",
      enableDefaultSession: false,
      sleepAfter: "15m",
      containerTimeouts: { portReadyTimeoutMS: 60_000 },
    });
    const sh = async (cmd: string, cwd = W, env?: Record<string, string>) => {
      const r = await box.exec(cmd, { cwd, env, ...EXEC });
      if (r.exitCode !== 0)
        throw new Error(
          `${cmd}: ${r.exitCode}\n${r.stdout.slice(-3000)}\n${r.stderr.slice(-3000)}`,
        );
      return r.stdout;
    };
    const sendSource = async () => {
      const obj = await env.BACKUP_BUCKET.get(`src/${variant}.tgz`);
      if (!obj) throw new Error(`no src/${variant}.tgz`);
      times.sourceBytes = obj.size;
      await box.writeFile("/tmp/src.tgz", obj.body);
      await sh(`mkdir -p ${W} && tar -xzf /tmp/src.tgz -C ${W}`, "/");
    };
    if (url.pathname === "/destroy") {
      await box.destroy();
      return new Response("destroyed");
    }
    try {
      await sh("true", "/");
      lap("start");
      times.fuse = String((await box.exec("test -c /dev/fuse", { cwd: "/" })).exitCode === 0);
      times.nproc = (await sh("nproc", "/")).trim();
      if (url.pathname === "/prime") {
        await sendSource();
        lap("source");
        await sh("pnpm install --frozen-lockfile --reporter=append-only");
        lap("installNoCache");
        const backup = await box.createBackup({
          dir: W,
          name: `cache-${variant}`,
          localBucket: true,
          multipart: true,
        });
        lap("backup");
        await env.BACKUP_BUCKET.put(`cache/${variant}.json`, JSON.stringify(backup));
        times.duBytes = (await sh(`du -sb ${W} | cut -f1`)).trim();
      } else if (url.pathname === "/build") {
        const rev = q("rev") || "r1";
        const warm = (await box.exec(`test -d ${W}/node_modules`, { cwd: "/" })).exitCode === 0;
        times.warm = String(warm);
        if (!warm) {
          const cache = await env.BACKUP_BUCKET.get(`cache/${variant}.json`);
          if (!cache) throw new Error("prime first");
          const { id, dir } = await cache.json<{ id: string; dir: string }>();
          // `local=1`: the binding-and-unsquashfs path; otherwise production's download-and-mount.
          await box.restoreBackup(
            q("local") === "1" ? { id, dir, localBucket: true } : { id, dir },
          );
          lap("restoreCache");
        }
        await sendSource();
        lap("source");
        // A turn's edit, so every build has something new.
        await sh(`echo "/* ${rev} */" >> src/blocks/hero.tsx`);
        await sh("pnpm install --frozen-lockfile --reporter=append-only");
        lap("install");
        // A release build that syncs nothing: `camox release`'s build without its sync.
        await sh(`rm -rf dist && pnpm exec vp build --base /_camox/r/${rev}/`, W, {
          CAMOX_INTERNAL_RELEASE: "dry-run",
        });
        lap("build");
        const files = (await sh(`find dist -type f ! -name '*.map' -printf '%s %p\\n'`))
          .trim()
          .split("\n");
        let bytes = 0;
        const queue = files.map((l) => {
          const i = l.indexOf(" ");
          bytes += Number(l.slice(0, i));
          return l.slice(i + 1);
        });
        times.uploadFiles = queue.length;
        times.uploadBytes = bytes;
        // `upload=tar`: the whole output as one object, for the loader to unpack or serve from.
        if (q("upload") === "tar") {
          await sh(`find dist -type f ! -name '*.map' | tar -czf /tmp/out.tgz -T -`);
          const f = await box.readFile("/tmp/out.tgz", { encoding: "none" });
          times.tarBytes = f.size;
          await env.BACKUP_BUCKET.put(
            `builds/${rev}.tgz`,
            f.content.pipeThrough(new FixedLengthStream(f.size)),
          );
          queue.length = 0;
        }
        // `upload=curl`: 16 parallel curls from the Container, as with presigned PUT URLs.
        if (q("upload") === "curl") {
          await box.writeFile("/tmp/files", queue.join("\n") + "\n");
          await sh(
            `xargs -P 16 -I{} sh -c 'curl -sSf -T "{}" "${BLOB.replace("/blob/", "/put/")}builds/${rev}/$(echo "{}" | cut -c6-)?k=${env.BLOB_SECRET}" >/dev/null' < /tmp/files`,
          );
          queue.length = 0;
        }
        await Promise.all(
          Array.from({ length: 8 }, async () => {
            for (let p = queue.shift(); p; p = queue.shift()) {
              const f = await box.readFile(`${W}/${p}`, { encoding: "none" });
              await env.BACKUP_BUCKET.put(
                `builds/${rev}/${p.slice(5)}`,
                f.content.pipeThrough(new FixedLengthStream(f.size)),
              );
            }
          }),
        );
        lap("upload");
      }
      if (q("destroy") === "1") await box.destroy();
      return Response.json(times);
    } catch (e) {
      return Response.json({ ...times, error: String((e as Error).stack ?? e) }, { status: 500 });
    }
  },
};
