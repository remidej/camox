# Production runtime smoke test

From the repository root:

```sh
pnpm exec nx run camox:build
pnpm --filter @camox/template-default test:production
```

The test builds a temporary copy of the starter whose Worker wraps `camox/worker` with
a `/smoke` route, then serves the build with `vite preview`, which runs it in workerd as
Cloudflare does. It asserts that the Camox Worker answers, that React renders the
Template's native Accordion (its `<details>` share one `name`) and Button (a link given
a link field's `to`, a `<button>` otherwise), that Camox's OG renderer can produce a PNG, and that the built stylesheet declares
the `--camox-*` variables the SDK reads on every color scheme. It also checks that every
block offers the same "Color scheme" setting and that Section renders the chosen scheme. No Camox API or real auth is
needed: a temporary home directory supplies fake build authentication without modifying
the developer's credentials. CI runs this test after building the SDK.
