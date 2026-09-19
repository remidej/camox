# DOM integrations in preview and published pages

Use this reference for block DOM listeners, scrolling, browser scripts, and third-party widgets. It can be read independently of [Block Definitions](block-definitions.md); read that reference only if also changing the block schema or field rendering API.

**Do not use component-global `window` or `document` to target a block's DOM.** Camox preview (including block thumbnails) renders blocks into an iframe through a React portal, but component code executes in the editor's JavaScript realm. Global scroll listeners observe the editor; scripts appended to the global document load there instead of beside your block.

Use `getElementContext` from `camox/dom` inside an effect or event handler, passing a rendered element. It returns `{ window, document }` from the element's `ownerDocument` and `defaultView`, or `null` for a missing element or a document without a window. It never falls back to globals, requires no provider, and works in regular rendering too. Don't access DOM APIs during SSR.

## Scroll listeners

```tsx
import { getElementContext } from "camox/dom";
import { useEffect, useRef, useState } from "react";

function Header() {
  const root = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const context = getElementContext(root.current);
    if (!context) return;

    const { window } = context;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header ref={root} data-scrolled={scrolled}>
      Navigation
    </header>
  );
}
```

Read viewport dimensions, query elements, and attach resize listeners through the same context. If the root is conditionally mounted or replaced, rerun setup for the new element (for example, store it using a callback ref and include it in the effect dependencies).

## Third-party scripts and widgets

Resolve context from the widget container, create scripts with `context.document.createElement("script")`, and append them to `context.document.head`. Initialize the SDK exposed on `context.window`, not the editor global. Deduplicate script loading **per document**, not with one module-global promise: preview, thumbnails, and the ordinary page can each have their own SDK instance.

For example, a script loader owned by your integration can use:

```ts
const loads = new WeakMap<Document, Map<string, Promise<void>>>();

function loadScript(document: Document, src: string): Promise<void> {
  let scripts = loads.get(document);
  if (!scripts) {
    scripts = new Map();
    loads.set(document, scripts);
  }
  const existing = scripts.get(src);
  if (existing) return existing;

  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  const loaded = new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => {
      scripts.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
  });
  scripts.set(src, loaded);
  document.head.appendChild(script);
  return loaded;
}
```

In the component's effect, await loading before initializing the widget against the rendered container. Handle load errors, ignore completion after cleanup, and destroy the widget instance on unmount using its SDK's teardown API. Keep a shared script when other blocks may still use it. Avoid duplicate initialization across remounts and React Strict Mode.

**Resolving the right window does not move your JavaScript objects into its realm.** Some SDKs use `instanceof Object` or similar constructor checks. Cal, for example, can reject configuration created by the editor even when its script loaded in the correct iframe. For JSON-compatible configuration only, construct a target-realm copy:

```ts
const context = getElementContext(root.current);
if (!context) return;

const config = context.window.JSON.parse(
  JSON.stringify({
    layout: "month_view",
    useSlotsViewOnSmallScreen: "true",
    theme: "dark",
  }),
);
// Pass config to the Cal instance loaded on context.window.
```

This is not a general cloning solution: functions, DOM nodes, SDK instances, circular structures, and other non-JSON values need SDK-specific handling. Libraries that capture globals at import time are not automatically fixed by this helper. Test DOM integrations in both authenticated preview and regular page rendering.
