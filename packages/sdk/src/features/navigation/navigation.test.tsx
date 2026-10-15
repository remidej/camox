import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import { Link, NavigationProvider, useLocation, useNavigate } from "./navigation";

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

void test("navigation keeps the draft param across SDK links, and switching drafts is a navigation of its own", async () => {
  const dom = new Window({ url: "https://site.test/about?camox-draft=d1" });
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
  let location!: { pathname: string; search: string };
  let navigate!: ReturnType<typeof useNavigate>;
  function Probe() {
    location = useLocation();
    navigate = useNavigate();
    return (
      <Link to="/contact?view=wide" id="contact">
        Contact
      </Link>
    );
  }
  const { createRoot } = await import("react-dom/client");
  const host = dom.document.createElement("div");
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const draftOf = () => new URL(dom.location.href).searchParams.get("camox-draft");
  try {
    await React.act(async () => {
      root.render(
        <NavigationProvider>
          <Probe />
        </NavigationProvider>,
      );
    });
    const link = host.querySelector("#contact")!;
    assert.equal(link.getAttribute("href"), "/contact?view=wide&camox-draft=d1");

    await React.act(async () => {
      (link as unknown as HTMLElement).click();
    });
    assert.equal(location.pathname, "/contact");
    assert.equal(draftOf(), "d1");
    assert.equal(new URL(dom.location.href).searchParams.get("view"), "wide");

    await React.act(async () => navigate({ to: "/about" }));
    assert.equal(draftOf(), "d1", "the studio's own navigation keeps the draft");

    const entries = dom.history.length;
    await React.act(async () => navigate({ to: dom.location.href, draft: "d2" }));
    assert.equal(draftOf(), "d2");
    assert.equal(dom.history.length, entries + 1, "switching drafts adds a history entry");

    await React.act(async () => navigate({ to: dom.location.href, draft: null }));
    assert.equal(draftOf(), null, "switching to Live drops the param");
    await React.act(async () => navigate({ to: "/contact" }));
    assert.equal(draftOf(), null, "Live stays Live");
  } finally {
    await React.act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
