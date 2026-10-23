// PROTOTYPE (#522): the same render in Node, for memory. `node --expose-gc node-bench.mjs`
const mem = () => { const m = process.memoryUsage(); return (m.heapUsed + m.external + m.arrayBuffers) / 2 ** 20; };
gc(); const base = mem();
let peak = base; const timer = setInterval(() => (peak = Math.max(peak, mem())), 1);
const t0 = performance.now();
const { default: site } = await import(new URL("../../../landing/dist/camox_landing/index.js", import.meta.url));
gc(); const loaded = mem(); const tImport = performance.now() - t0;
for (let i = 0; i < 3; i++) {
  const t = performance.now();
  const res = await site.fetch(new Request("https://camox.ai/", { headers: { accept: "text/html" } }), {}, { waitUntil() {}, passThroughOnException() {} });
  const html = await res.text();
  console.log(`render ${i + 1}: ${res.status} ${html.length} B in ${(performance.now() - t).toFixed(0)} ms, peak +${(peak - base).toFixed(1)} MiB`);
}
clearInterval(timer); gc();
console.log(`import ${tImport.toFixed(0)} ms, +${(loaded - base).toFixed(1)} MiB after import; retained after renders +${(mem() - base).toFixed(1)} MiB; peak +${(peak - base).toFixed(1)} MiB`);
