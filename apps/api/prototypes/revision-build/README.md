# PROTOTYPE, throwaway: building a revision in a Container (#550)

How long does one revision's build take in the release Container, inside an agent turn? It was deployed and measured on 2026-10-23, then deleted along with its R2 bucket.

- **The sandboxes** run the release sandbox's own image (`cloudflare/sandbox:0.12.1` with pnpm 11.1.3), on `standard-2` (1 vCPU) and `standard-4` (4 vCPU). `nproc` reports 1 and 4. FUSE is available.
- **The sites** are `template-default` at camox 0.48.0 (`tpl`, a 93 KB `.tar.gz`) and a copy grown to 40× by `make-grown.mjs` (`grown`, 219 KB, 200 blocks). Each copy of a block has its own id and imports its own copy of the UI components, so the build compiles every one.
- **The build** is `vp build --base /_camox/r/<rev>/` with `CAMOX_INTERNAL_RELEASE=dry-run`: `camox release`'s build, syncing nothing. Each run appends a comment to `hero.tsx` first. Without the variable, the build fails with "not authenticated", since only a release skips the local login.
- **The install cache** is a squashfs backup of `/workspace` after a full install (950 MB). The SDK's production path downloads it with parallel ranged `curl`s from a presigned R2 URL, then mounts it with FUSE. With no R2 keys, `generatePresignedGetURL` points the same code at `/blob` on the Worker, which streams the object from the R2 binding.
- **Cold** is a new sandbox: start, restore the cache, send the working copy, install, build, upload. **Warm** is the same sandbox for the next turn, with `node_modules` still on disk.

`worker.ts` and `wrangler.jsonc` are the Worker, `bench.sh` runs a size × variant matrix, and `make-grown.mjs` grows the Template.

## Time per phase (wall, ms, min–max)

| phase                                              |  s-2 tpl cold |  s-2 tpl warm |  s-2 40× cold |  s-2 40× warm |  s-4 tpl cold | s-4 tpl warm |  s-4 40× cold | s-4 40× warm |
| -------------------------------------------------- | ------------: | ------------: | ------------: | ------------: | ------------: | -----------: | ------------: | -----------: |
| container start                                    |  2,000–12,700 |             — |   1,500–3,300 |             — |   1,700–2,400 |            — |   1,400–3,500 |            — |
| restore the install cache                          |   7,000–8,600 |             — |   6,200–6,900 |             — |   3,400–4,900 |            — |   3,600–9,300 |            — |
| send the working copy (R2 → `writeFile` → `tar x`) |       150–660 |       190–320 |   1,400–1,700 |   1,100–1,400 |       150–230 |      190–320 |   1,400–2,800 |  1,100–2,500 |
| `pnpm install --frozen-lockfile`                   |   1,500–2,200 |       550–660 |   1,400–2,300 |       540–730 |     870–1,600 |      410–570 |   1,200–1,400 |      530–950 |
| build                                              | 18,700–20,500 | 11,500–12,800 | 20,200–24,800 | 13,500–16,500 | 10,500–14,700 |  5,200–7,300 | 14,000–16,900 |  7,700–9,800 |
| upload, one `.tar.gz` (5.6–5.8 MB)                 |   1,400–1,600 |   1,400–1,600 |   1,500–1,600 |   1,500–1,600 |   1,200–1,300 |  1,200–1,300 |   1,300–1,400 |  1,300–1,400 |
| **total, with the one-archive upload**             |   **31–46 s** |   **14–16 s** |   **32–40 s** |   **17–20 s** |   **18–25 s** |  **7–9.5 s** |   **23–35 s** |  **11–15 s** |

Upload times are pooled over cold and warm runs. The output, without source maps, is 61 files (16 MB) for the Template and 337 files (18 MB) for the 40× copy.

## Other findings

- **A cold build is about twice as slow as a warm one**, on both sizes, because `node_modules` is read through the FUSE overlay of the restored squashfs. The restore itself is quick (3.4–9.3 s).
- **`standard-4` halves the warm build** of both sites. On one vCPU, the build is CPU-bound.
- **Uploading file by file costs per file, not per byte.** Through the Worker with 8 parallel `readFile` → `R2.put`: 1.8–4.8 s for the Template, 9–15 s for the 40× copy. With 16 parallel `curl -T` from the Container, standing in for presigned PUT URLs: 1.5–4.1 s and 19–21 s. One `.tar.gz` read back and put as a single object: 1.2–1.6 s for both.
- **The SDK's local-dev restore** (`localBucket: true`: the archive through the Durable Object, then `unsquashfs`) took 54 s and 290 s. Production doesn't use it, since the sandbox has FUSE and R2 keys.
- **A first install with no cache** took 30–32 s, and backing up the 950 MB workspace took 19–20 s.
- **2 of the 24 matrix builds failed** with "RPCTransportError: RPC session was shut down by disposing the main stub", both on `standard-2` in the first round, shortly after a deploy. The next request found the container restarted. Not seen again in the 34 builds after.
