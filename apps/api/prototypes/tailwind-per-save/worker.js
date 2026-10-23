// PROTOTYPE, throwaway (issue #520): Tailwind per save in a deployed Durable Object.
// GET /?site=1|10|40&step=save|theme&do=<name>. The DO keeps each file's candidates between
// saves, as a draft's Durable Object would.
import { DurableObject } from "cloudflare:workers";
import site1 from "./site-1.json";
import site10 from "./site-10.json";
import site40 from "./site-40.json";
import { draftCss, extract } from "./tailwind-per-save.js";

const sites = { 1: site1, 10: site10, 40: site40 };
let isolateId, runs = 0;

export class Draft extends DurableObject {
  byFile = new Map();
  async fetch(request) {
    const url = new URL(request.url);
    const n = url.searchParams.get("site") ?? "1";
    const step = url.searchParams.get("step") ?? "save";
    const { src, tailwind } = sites[n];
    isolateId ??= crypto.randomUUID().slice(0, 8);
    runs++;
    const firstForSite = !this.byFile.has(n);
    if (firstForSite) this.byFile.set(n, new Map(Object.entries(src).filter(([f]) => !f.endsWith(".css")).map(([f, c]) => [f, extract(c)])));
    const byFile = this.byFile.get(n);
    let theme = src["styles.css"];
    if (step === "save") byFile.set("blocks/hero.tsx", extract(src["blocks/hero.tsx"] + ` "p-${runs} px-${runs + 1}"`));
    if (step === "theme") theme = theme.replace("oklch(0.52 0.2 262)", `oklch(0.52 0.2 ${runs})`).replace('--font-heading: "Hanken Grotesk Variable"', '--font-heading: "Fraunces"');
    if (step === "noop") return Response.json({ isolateId, runsInIsolate: runs, site: n, step, firstForSite, ok: true });
    const css = await draftCss(theme, tailwind, byFile);
    return Response.json({ isolateId, runsInIsolate: runs, site: n, step, firstForSite, cssBytes: css.length, ok: css.includes(".text-display") });
  }
}

export default {
  async fetch(request, env) {
    const name = new URL(request.url).searchParams.get("do") ?? "one";
    const t0 = Date.now();
    const res = await env.DRAFT.get(env.DRAFT.idFromName(name)).fetch(request);
    const body = await res.json();
    return Response.json({ wallMsSeenByCaller: Date.now() - t0, ...body });
  },
};
