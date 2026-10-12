# Artifacts

An **artifact** is a field whose content is a self-contained web page (its **artifact source**), usually written by an agent and rendered in a sandboxed `<iframe>`. Artifacts hold bespoke visuals and interactions that blocks can't express: animated SVGs, 3D scenes, small interactive widgets.

## Artifact or block?

Pick an artifact when the element is really code: a one-off visual whose value is in how it moves or responds, which editors would never restructure. Pick a block for anything editors write, reorder, or reuse: headings, copy, links, images, lists, cards. Keep that content in the block's fields, around the artifact, so editors and agents can still read and change it.

A definition that would fit one place on one site, or settings bolted on only to make a visual look reusable, is the signal for an artifact. Text that matters for SEO or Markdown belongs in fields, never inside the source: Camox treats the source as opaque and only reads its `<title>`.

## Declare and render

```tsx
content: (field) => ({
  heading: field.string({ default: "How it works" }),
  visual: field.artifact({ size: "fill", title: "Diagram" }),
}),
```

- `size` (required): `"fill"` fills a container whose size the block controls, for example with an aspect ratio; `"content"` is for frames whose height follows their page, such as calculators. See [Size to the content](#size-to-the-content).
- `default` (optional): a starting source. Leave it out; agents write sources as content. An empty artifact renders nothing on the website and a placeholder in the studio preview.
- Artifacts work in block content and repeater items, so also in layout and synced blocks. Collection records can't hold them.

```tsx
<div className="aspect-video">
  <block.Artifact name="visual">
    {(props) => <iframe {...props} className="size-full" />}
  </block.Artifact>
</div>
```

Spread the props onto your own `<iframe>`: they carry `srcDoc`, `sandbox="allow-scripts"`, `allow="fullscreen; clipboard-write"`, `title`, `loading="lazy"`, a `ref` that connects the frame to the `camox` runtime, and for `size: "content"` a `style` with the frame's height. Don't replace the `ref`, and don't set a height on a `"content"` frame. Repeater items use `item.Artifact`. `block.Field` rejects artifact fields.

## Write a source

Write the source to a local file and push it with `blocks edit --id <ID> --field-file <NAME>=<PATH>` (or `blocks create`), then check it with `camox preview`; see [Set string fields from files](cli-content.md#set-string-fields-from-files). `blocks describe` lists artifact fields with `fieldType: "Artifact"` and their `size`.

- **Under 256 KB.** Larger writes are rejected. Load libraries from a CDN instead of inlining them.
- **Import from esm.sh with exact pinned versions**, so the artifact never changes under the website:

  ```html
  <script type="module">
    import { animate } from "https://esm.sh/motion@12.23.12";
  </script>
  ```

- **A meaningful `<title>`.** It names the frame for screen readers and is the artifact's Markdown Representation. Without one, the artifact is called "Untitled artifact", and `blocks create` and `blocks edit` return a warning.
- **Respect `prefers-reduced-motion`** with the native media query, in CSS (`@media (prefers-reduced-motion: reduce)`) and in scripts (`matchMedia`), by stopping or simplifying motion.
- **Fonts on the website's own domain need CORS headers.** The sandbox gives the page an opaque origin, so self-hosted fonts load only when the server sends `Access-Control-Allow-Origin: *` for them.

## The `camox` runtime

Camox injects a small runtime at the top of every source, before anything in it runs. It's how an artifact receives what its sandbox hides from it. `window.camox` always exists, so use it directly, without feature detection.

Never implement your own `postMessage` protocol with the page. The website and the studio talk to artifacts only through `camox`, and nothing on the page listens for other messages.

### `camox.studio`

`null` on the website. Inside the studio, an object describing where the artifact is shown:

- `editMode`: `true` while an editor has Edit Mode on.
- `canvas`: `true` on the Canvas, where pages and blocks are laid out side by side.

```js
const editing = window.camox.studio?.editMode === true;
```

Read it when you act rather than once at startup: it's `null` until the frame connects, and it changes when the editor toggles Edit Mode. Use it to stay calm while someone is editing, for example by not autoplaying sound.

### `camox.onViewport(callback)`

Scroll-driven animations follow where the frame sits in the page's viewport. The first call subscribes; it returns a function that unsubscribes. The callback receives:

- `progress`: `0` when the frame's top enters at the bottom of the viewport, `1` when its bottom leaves at the top, `0.5` when the frame is centered.
- `visibleRatio`: the share of the frame inside the viewport, from `0` to `1`.

```js
const stop = window.camox.onViewport(({ progress, visibleRatio }) => {
  scene.rotation.y = progress * Math.PI * 2;
  if (visibleRatio === 0) pauseRendering();
});
```

While subscribed, the runtime also sets `--camox-progress` on `:root`, so CSS alone can scrub with scroll. Subscribe once, even with an empty callback, to get it:

```html
<style>
  .orbit {
    transform: rotate(calc(var(--camox-progress, 0) * 1turn));
  }
</style>
<script>
  window.camox.onViewport(() => {});
</script>
```

Updates arrive at most once per animation frame, only when the values change, so nothing arrives while the frame is far from the viewport. Artifacts that never subscribe get nothing and cost nothing. Don't read the frame's own scroll position or listen to `scroll` inside it: the artifact can't see the page scroll.

### Size to the content

With `size: "content"`, the runtime measures the height of the artifact's `<html>` element and the frame follows it as the content changes, so the page never shows a scrollbar inside the frame. Let the document grow with its content: never give `html` or `body` a height in viewport or percentage units (`100vh`, `100%`), which would tie the content's height to the frame's. With `size: "fill"`, the block sizes the frame and the artifact never resizes it.

### `camox.navigate(href)`

Navigates the website, for example from a widget's call to action. Internal paths such as `/pricing` go through the website's client router; external URLs open in a new tab. Only `http` and `https` URLs work.

```js
button.addEventListener("click", () => window.camox.navigate("/pricing?plan=pro"));
```

It only works right after a real click or key press in the artifact. Calls from timers, scroll callbacks or page load do nothing, so an artifact can't redirect visitors on its own. The sandbox blocks popups and navigating the website: a plain `<a href>` would only load inside the frame, and `window.open` does nothing. Use `camox.navigate` instead.

The runtime API has no stability guarantee while Camox is pre-1.0.
