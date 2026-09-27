import assert from "node:assert/strict";
import { test } from "node:test";

import { Window, type HTMLButtonElement } from "happy-dom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { DeviceSelector } from "./DeviceSelector";

void test("device selectors are controlled, independently labeled, and cannot deselect", async () => {
  const dom = new Window({ url: "http://localhost" });
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
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement);
  const changes: string[] = [];

  function Fixture() {
    const [device, setDevice] =
      React.useState<React.ComponentProps<typeof DeviceSelector>["value"]>("desktop");
    return (
      <>
        <DeviceSelector
          aria-label="Device for Home"
          value={device}
          onValueChange={(next) => {
            changes.push(next);
            setDevice(next);
          }}
          size="sm"
        />
        <DeviceSelector
          aria-label="Preview device"
          desktopLabel="Full view"
          value="desktop"
          onValueChange={() => assert.fail("another selector must not change")}
        />
      </>
    );
  }

  try {
    await act(async () => root.render(<Fixture />));
    const canvas = mount.querySelector('[role="group"][aria-label="Device for Home"]')!;
    const preview = mount.querySelector('[role="group"][aria-label="Preview device"]')!;
    const desktop = canvas.querySelector<HTMLButtonElement>('[aria-label="Desktop view"]')!;
    const tablet = canvas.querySelector<HTMLButtonElement>('[aria-label="Tablet view"]')!;
    const mobile = canvas.querySelector<HTMLButtonElement>('[aria-label="Mobile view"]')!;
    assert.equal(canvas.querySelectorAll("button").length, 3);
    assert.equal(desktop.getAttribute("aria-pressed"), "true");
    await act(async () => desktop.click());
    assert.deepEqual(changes, []);

    for (const [button, device] of [
      [tablet, "tablet"],
      [mobile, "mobile"],
      [desktop, "desktop"],
    ] as const) {
      await act(async () => button.click());
      assert.equal(button.getAttribute("aria-pressed"), "true");
      assert.equal(canvas.querySelectorAll('[aria-pressed="true"]').length, 1);
      assert.equal(changes.at(-1), device);
    }
    assert.equal(
      preview.querySelector('[aria-label="Full view"]')!.getAttribute("aria-pressed"),
      "true",
    );
    assert.deepEqual(changes, ["tablet", "mobile", "desktop"]);
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
