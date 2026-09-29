import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import { NavigationProvider, useLocation, useNavigate } from "./navigation";

void test("default navigation carries transient provenance and history traversal clears it", async () => {
  const dom = new Window({ url: "https://site.test/about" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  let location!: { pathname: string; search: string; source?: "canvas" };
  let navigate!: ReturnType<typeof useNavigate>;
  function Probe() {
    location = useLocation();
    navigate = useNavigate();
    return null;
  }
  const { createRoot } = await import("react-dom/client");
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await React.act(async () => {
      root.render(
        <NavigationProvider>
          <Probe />
        </NavigationProvider>,
      );
    });
    assert.equal(location.pathname, "/about");
    assert.equal(location.source, undefined);
    await React.act(async () => navigate({ to: "/contact", source: "canvas" }));
    assert.equal(location.pathname, "/contact");
    assert.equal(location.source, "canvas");
    assert.equal(dom.history.state, null);
    await React.act(async () => navigate({ to: "/contact?view=wide", replace: true }));
    assert.equal(location.source, undefined);
    assert.equal(location.search, "?view=wide");
    await React.act(async () => navigate({ to: "/about", source: "canvas" }));
    await React.act(async () => {
      dom.history.replaceState(null, "", "/contact");
      dom.dispatchEvent(new dom.PopStateEvent("popstate"));
    });
    assert.equal(location.pathname, "/contact");
    assert.equal(location.source, undefined);
  } finally {
    await React.act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
