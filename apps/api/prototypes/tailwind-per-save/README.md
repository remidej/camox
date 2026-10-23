# PROTOTYPE, throwaway: Tailwind per save

For "Tailwind per save" (remidej/camox#520), on the map "The agent changing a site's code" (#512). Measured on 2026-10-23 with `tailwindcss` 4.3.3, the Template's version.

The question: can a Worker generate the CSS for a saved block fast enough for each save, against the Template's Theme, without Tailwind's native class scanner?

## How it works

`tailwind-per-save.js` is the whole thing, and it runs unchanged in Node and in a Worker.

- **Candidates without the scanner.** Each file's text is split on whitespace and quotes, and each token is also kept with punctuation trimmed off its ends, as Tailwind v3's default extractor did. A second pass splits on whitespace only and keeps tokens with quotes inside brackets, such as Button's `[&_svg:not([class*='size-'])]:size-4`. Junk tokens cost nothing: `build()` drops anything that isn't a utility.
- **The Theme compiles from text.** `compile()` from `tailwindcss` is plain JavaScript. `loadStylesheet` serves `@import "tailwindcss"` from Tailwind's own CSS files (58 KB), bundled as text. The Theme is `styles.css` without its `@fontsource` import, which the Template drops (#518).
- **Each save rebuilds the draft's whole stylesheet**: a fresh compile of the Theme, then `build()` with the union of every site file's candidates. Only the saved file is re-extracted. A Theme edit is the same call with the new `styles.css`.

## Results

### Correctness

Against the real Tailwind CLI (native scanner) on the Template's `src/`:

- Every rule the CLI generates is in the prototype's CSS (160 utility rules).
- One extra rule, `.\!sticky`, from the code `!sticky` in `mobile-menu.tsx`. No element has that class, so it changes nothing on the page.
- The first version of the extractor missed Button's `[&_svg:not([class*='size-'])]:size-4`, because it split on the quotes inside the brackets. The bracket pass fixed it. Missed classes are the failure to watch: the preview would lack a style that Live has.
- The raw output is plain modern CSS (`@layer`, `@supports`, `@property`, no nesting), so the preview serves it as is. Live's build also runs Lightning CSS (minifying and lowering), which the preview skips.

### Why not "Live's CSS plus the new classes"

Tailwind orders utilities so that the more specific one wins: `px-4` comes after `p-2`, so `p-2 px-4` gives 1rem side padding. If Live's CSS already has `px-4` and a save adds `p-2`, appending puts `p-2` last and the side padding becomes 0.5rem. A full rebuild keeps Tailwind's order, and it's cheap enough to do on every save.

### Timings

"n×" is the Template's blocks and components copied n times, each copy with its numbers shifted (`gap-4` becomes `gap-7`), so copies add new utilities.

| site | files | utility rules |    CSS | Node, per save (M1 Pro) | deployed Durable Object, CPU per save | first save in a fresh DO |
| ---- | ----: | ------------: | -----: | ----------------------: | ------------------------------------: | -----------------------: |
| 1×   |    16 |           160 | 23 KiB |                 4–9 ms |                    29 ms (16–43 ms) |                    77 ms |
| 10×  |   133 |           474 | 44 KiB |                  ~9 ms |                    66 ms (51–117 ms) |                   278 ms |
| 40×  |   523 |         1,463 | 114 KiB |                  20 ms |                    57 ms (39–119 ms) |                   210 ms |

- A Theme edit (brand color, heading font, radius, section spacing) costs the same as a save: 29 ms CPU at 1× and 55 ms at 40× deployed, 3–4 ms in Node.
- Compiling the Theme alone is 1.5–2 ms in Node; extracting all 16 files is under 1 ms.
- The first save in a fresh Durable Object includes extracting every file and V8 warming up.
- Wall time seen by the calling Worker was 50–350 ms, but a no-op round trip to the DO alone was 23–155 ms, so most of it is the round trip.
- Bundle: `tailwindcss`'s `lib.mjs` is 248 KB, plus 58 KB of its CSS. The 40× run stayed under the 128 MB isolate limit; Node's heap was 97 MiB including the test site.

## Not measured

- Tailwind's scanner as WebAssembly (`@tailwindcss/oxide-wasm32-wasi`). It depends on `@emnapi/wasi-threads`, and Workers have no threads.
- Tailwind's browser build (`@tailwindcss/browser`), which scans the live DOM. Server rendering needs the CSS too, and it would make the Canvas differ from Live.
- Sending the stylesheet to the Canvas and swapping it (hot reload).

## Running it

`npm install`, `node make-site.mjs`, `node node-bench.mjs` (correctness and Node timings), `for n in 1 10 40; do node make-grown.mjs $n; done`, `node node-grown.mjs 1 10 40`. For production: `wrangler deploy`, then `curl '<url>/?site=40&step=save&do=<name>'` (`step` is `save`, `theme` or `noop`) with `wrangler tail --format json` running for CPU time.
