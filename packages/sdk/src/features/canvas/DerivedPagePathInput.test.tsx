import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { act } from "react";

import { initApiClient } from "../../lib/api-client";
import {
  StudioQueryClientProvider,
  testDraftScope,
  testStudioCache,
} from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";
import { DerivedPagePathInput } from "./DerivedPagePathInput";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

void test("derived layout parameters submit encoded page paths, reject invalid paths, and reset on selection", async () => {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  // Load the event system after the DOM exists so input events use browser semantics.
  const { createRoot } = await import("react-dom/client");
  const { AuthContext, createCamoxAuthClient } = await import("../../lib/auth");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const derivedLayoutId = "teams.$team.members.$member.details";
  // The layouts the draft's definitions synced: the page's, and a more specific one.
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const cache = testStudioCache(client);
  cache.set(reads.project({ projectUuid: "site" }), { id: 1 } as never);
  cache.set(reads.layoutList({ projectId: 1 }), [
    { layoutId: derivedLayoutId, title: "Members", kind: "derived" },
    { layoutId: "teams.staff.members.$member.details", title: "Staff", kind: "derived" },
  ] as never);
  const changes: string[] = [];
  const render = async (pathname: string | null) => {
    await act(async () =>
      root.render(
        <StudioQueryClientProvider client={client}>
          <AuthContext.Provider
            value={{
              projectUuid: "site",
              apiUrl: "http://localhost:8788",
              authenticationUrl: "http://localhost:3290",
              authClient: createCamoxAuthClient("http://localhost:8788"),
            }}
          >
            <DerivedPagePathInput
              page={{
                kind: "derived",
                key: "derived",
                title: "Members",
                pathname: null,
                layoutId: derivedLayoutId,
                pattern: "/teams/:team/members/:member/details",
              }}
              pathname={pathname}
              onChange={(path) => changes.push(path)}
            />
          </AuthContext.Provider>
        </StudioQueryClientProvider>,
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
