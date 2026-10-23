// PROTOTYPE (#522), throwaway. A Camox-owned loader Worker that renders apps/landing's server
// build in a Dynamic Worker, one per revision id, and reports timings.
//
//   /render?id=<rev>&path=/&code=site|empty&memo=0|1&ballast=<MiB>&outbound=gateway|null
//   /stub   passes a dispatch-namespace stub into a Dynamic Worker's env, as is and wrapped
//   /tails?id=<rev>   the tail events recorded for a revision (CPU and wall time)
import { WorkerEntrypoint } from "cloudflare:workers";

const API_ORIGIN = "https://api.camox.ai";
const SITE_ORIGIN = "https://camox.ai";
const COMPAT = { compatibilityDate: "2026-04-11", compatibilityFlags: ["nodejs_compat"] };

// The only network a preview gets: the Camox API, scoped by props in a real version.
export class ContentGateway extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== API_ORIGIN) return new Response(`blocked ${url.origin}`, { status: 403 });
    return fetch(request);
  }
}

// The documented route for a binding the Dynamic Worker can't get directly.
export class SiteProxy extends WorkerEntrypoint {
  fetch(request) {
    return this.env.DISPATCHER.get("proto-522-site").fetch(request);
  }
  hello(name) {
    return this.env.DISPATCHER.get("proto-522-site").hello(name);
  }
}

// Records each Dynamic Worker invocation's CPU and wall time.
export class Tailer extends WorkerEntrypoint {
  async tail(events) {
    for (const e of events) {
      const record = {
        id: this.ctx.props.id,
        outcome: e.outcome,
        cpuTime: e.cpuTime,
        wallTime: e.wallTime,
        url: e.event?.request?.url,
        exceptions: e.exceptions?.map((x) => `${x.name}: ${x.message}`),
        logs: e.logs?.slice(0, 5).map((l) => l.message),
      };
      await this.env.BUNDLE.put(
        `tails/${this.ctx.props.id}/${Date.now()}-${crypto.randomUUID()}`,
        JSON.stringify(record),
      );
    }
  }
}

// Wraps the site: ballast after rendering, to measure the isolate's memory headroom.
const ENTRY = (code) => `
${code === "site" ? 'import site from "./index.js";' : "const site = { fetch: () => new Response('empty') };"}
const kept = [];
function ballast(mib) {
  for (let i = 0; i < mib; i++) kept.push(new Array(131072).fill(i + 0.5)); // 1 MiB of doubles
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/__stub") {
      const out = {};
      for (const [name, binding] of Object.entries(env)) {
        try { out[name + ".fetch"] = await (await binding.fetch("https://site/")).text(); } catch (e) { out[name + ".fetch"] = "ERR " + e.message; }
        try { out[name + ".hello"] = await binding.hello("dynamic"); } catch (e) { out[name + ".hello"] = "ERR " + e.message; }
      }
      return Response.json(out);
    }
    const mib = Number(request.headers.get("x-ballast") ?? 0);
    const before = request.headers.get("x-ballast-when") === "before";
    if (mib && before) ballast(mib);
    const t0 = Date.now();
    const response = await site.fetch(request, env, ctx);
    const body = await response.text();
    const renderMs = Date.now() - t0;
    if (mib && !before) ballast(mib);
    return new Response(body, { status: response.status, headers: { "x-render-ms": String(renderMs), "x-kept": String(kept.length), "content-type": response.headers.get("content-type") ?? "" } });
  },
};`;

let memo = null; // the module map, kept in the loader's isolate

async function readModules(env) {
  const json = await (await env.BUNDLE.get("modules.json")).json();
  const modules = {};
  for (const [name, mod] of Object.entries(json.modules)) modules[name] = mod;
  for (const name of json.wasm)
    modules[name] = {
      wasm: await (await env.BUNDLE.get(name.replaceAll("/", "__"))).arrayBuffer(),
    };
  return modules;
}

async function workerCode(env, ctx, { id, code, useMemo, outbound }) {
  const t0 = Date.now();
  let modules = {};
  if (code === "site") {
    if (useMemo && memo) modules = memo;
    else {
      modules = await readModules(env);
      if (useMemo) memo = modules;
    }
  }
  const readMs = Date.now() - t0;
  return {
    readMs,
    code: {
      ...COMPAT,
      mainModule: "proto-entry.js",
      modules: { ...modules, "proto-entry.js": { js: ENTRY(code) } },
      globalOutbound:
        outbound === "null" ? null : ctx.exports.ContentGateway({ props: { project: "landing" } }),
      tails: [ctx.exports.Tailer({ props: { id } })],
    },
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const q = url.searchParams;

    if (url.pathname === "/render") {
      const id = q.get("id") ?? crypto.randomUUID();
      const opts = {
        id,
        code: q.get("code") ?? "site",
        useMemo: q.get("memo") === "1",
        outbound: q.get("outbound") ?? "gateway",
      };
      let callback = null;
      const t0 = Date.now();
      const stub = env.LOADER.get(id, async () => {
        const { readMs, code } = await workerCode(env, ctx, opts);
        callback = { readMs };
        return code;
      });
      try {
        const res = await stub.getEntrypoint().fetch(
          new Request(SITE_ORIGIN + (q.get("path") ?? "/"), {
            headers: {
              accept: "text/html",
              "x-ballast": q.get("ballast") ?? "0",
              "x-ballast-when": q.get("when") ?? "after",
            },
          }),
        );
        const body = await res.text();
        return Response.json({
          id,
          ok: true,
          totalMs: Date.now() - t0,
          callbackRan: Boolean(callback),
          readMs: callback?.readMs,
          renderMs: Number(res.headers.get("x-render-ms")),
          status: res.status,
          htmlBytes: body.length,
          title: body.match(/<title>(.*?)<\/title>/)?.[1],
          snippet: res.status >= 400 ? body.slice(0, 500) : undefined,
        });
      } catch (error) {
        return Response.json({
          id,
          ok: false,
          totalMs: Date.now() - t0,
          callbackRan: Boolean(callback),
          error: String(error),
        });
      }
    }

    // The same ballast in this ordinary Worker, for comparison.
    if (url.pathname === "/ballast") {
      const kept = [];
      for (let i = 0; i < Number(q.get("mb")); i++) kept.push(new Array(131072).fill(i + 0.5));
      return new Response(`ok ${kept.length}`);
    }

    if (url.pathname === "/stub") {
      const out = {};
      for (const [label, binding] of [
        ["direct", () => env.DISPATCHER.get("proto-522-site")],
        ["wrapped", () => ctx.exports.SiteProxy({})],
      ]) {
        try {
          const stub = env.LOADER.load({
            ...COMPAT,
            mainModule: "proto-entry.js",
            modules: { "proto-entry.js": { js: ENTRY("empty") } },
            env: { SITE: binding() },
            globalOutbound: null,
          });
          out[label] = await (await stub.getEntrypoint().fetch("https://x/__stub")).json();
        } catch (error) {
          out[label] = "ERR " + String(error);
        }
      }
      try {
        out.loaderDirect = {
          fetch: await (await env.DISPATCHER.get("proto-522-site").fetch("https://site/")).text(),
        };
        out.loaderDirect.hello = await env.DISPATCHER.get("proto-522-site").hello("loader");
      } catch (error) {
        out.loaderDirectErr = String(error);
      }
      return Response.json(out);
    }

    if (url.pathname === "/tails") {
      const listed = await env.BUNDLE.list({ prefix: `tails/${q.get("id")}/` });
      const records = await Promise.all(
        listed.objects.map(async (o) => (await env.BUNDLE.get(o.key)).json()),
      );
      return Response.json(records);
    }

    return new Response("not found", { status: 404 });
  },
};
