import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import type { CamoxApp } from "../../core/createApp";
import type { Layout } from "../../core/createLayout";
import { CamoxAppProvider } from "../provider/components/CamoxAppContext";
import { DerivedPagePathInput } from "./DerivedPagePathInput";

void test("derived layout parameters submit encoded page paths, reject invalid paths, and reset on selection", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  // Load the event system after the DOM exists so input events use browser semantics.
  const { createRoot } = await import("react-dom/client");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const derivedLayoutId = "teams.$team.members.$member.details";
  const layouts = [
    { _internal: { id: derivedLayoutId, kind: "derived" } },
    { _internal: { id: "teams.staff.members.$member.details", kind: "derived" } },
  ] as Layout[];
  const app = { getLayouts: () => layouts } as CamoxApp;
  const changes: string[] = [];
  const render = async (pathname: string | null) => {
    await act(async () =>
      root.render(
        <CamoxAppProvider app={app}>
          <DerivedPagePathInput
            page={{ key: "derived", title: "Members", pathname: null, derivedLayoutId }}
            pathname={pathname}
            onChange={(path) => changes.push(path)}
          />
        </CamoxAppProvider>,
      ),
    );
  };
  const input = (param: string) => mount.querySelector(`input[aria-label="${param} for Members"]`)!;
  const edit = async (param: string, value: string) => {
    const field = input(param);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(
        field,
        value,
      );
      field.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
  };
  const submit = async () => {
    const event = new dom.Event("submit", { bubbles: true, cancelable: true });
    await act(async () => mount.querySelector("form")!.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true, "native form submission never navigates");
  };

  try {
    await render("/teams/red%20team/members/Jos%C3%A9/details");
    assert.equal(input("team").getAttribute("value"), "red team");
    assert.equal(input("member").getAttribute("value"), "José");
    assert.equal(mount.querySelectorAll("input").length, 2);
    assert.match(mount.textContent, /\/teams\//);
    assert.match(mount.textContent, /\/details/);
    await edit("team", "blue team");
    await edit("member", "A?#%");
    await submit();
    assert.deepEqual(changes, ["/teams/blue%20team/members/A%3F%23%25/details"]);
    await act(async () => mount.querySelector("button")!.click());
    assert.equal(changes.length, 2, "View uses the same submit handler as keyboard submission");
    assert.equal(dom.location.pathname, "/camox/canvas");

    for (const invalid of ["", " ", "a/b", ".", "..", "staff"]) {
      await edit("team", invalid);
      await submit();
      assert.equal(changes.length, 2, `must reject ${JSON.stringify(invalid)}`);
      assert.equal(input("team").getAttribute("aria-invalid"), "true");
      assert.ok(mount.querySelector('[role="alert"]'));
    }
    await edit("team", "valid");
    assert.equal(input("team").getAttribute("aria-invalid"), "false");
    assert.equal(mount.querySelector('[role="alert"]'), null);
    await submit();
    assert.equal(changes.length, 3);

    await render("/teams/new/members/other/details");
    assert.equal(input("team").getAttribute("value"), "new");
    assert.equal(input("member").getAttribute("value"), "other");
    for (const path of [null, "/teams/a/members/b/details?draft", "/teams/%ZZ/members/b/details"]) {
      await render(path);
      assert.equal(input("team").getAttribute("value"), "");
      await submit();
      assert.equal(changes.length, 3);
    }
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
