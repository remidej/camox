# Production runtime smoke test

From the repository root:

```sh
pnpm exec nx run camox:build
pnpm --filter @camox/template-default test:production
```

The test builds a temporary copy of the starter using Nitro's Node middleware
preset, moves only `.output` into an isolated deployment, removes build-time
`node_modules` links, and serves a real HTTP request. It asserts that React/Base UI
can render HTML and Camox's OG renderer can produce a PNG. No Camox API, real auth,
application-level dependency tracing overrides, or direct Takumi dependency is
needed. A temporary home directory supplies fake build authentication without
modifying the developer's credentials. CI runs this test after building the SDK.

## Issue #106 investigation

- **Takumi:** the original `createRequire(import.meta.url).resolve(...)` survives
  bundling, but the WASM package/asset is absent from the deployment. The isolated
  smoke test reproduced `Cannot find module '@takumi-rs/wasm/takumi_wasm_bg.wasm'`
  before the fix. Camox now uses a static module import so Nitro's WASM loader
  owns asset inclusion, including when dependencies are fully bundled. The
  server-only guard in `createLayout` prevents this import reaching client builds.
- **tslib:** a package containing only `package.json` and `tslib.es6.mjs`, as
  reported, reproduces Node's missing `tslib/modules/index.js` error: Node selects
  that entry from the package exports. The complete upstream package is valid;
  the partial traced copy is not. The current starter build did not independently
  reproduce that partial copy. Camox now adds `tslib` to Nitro's `noExternals`,
  keeping its existing ESM alias and removing reliance on partial package tracing.
  Plugin tests cover preservation of user options, including `noExternals: true`.

These are SDK integration fixes, not starter workarounds. Applications should not
need to add Takumi as a direct dependency or configure `traceDeps`/`noExternals`.
