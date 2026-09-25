import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import type { OverlayMessage } from "../overlayMessages";

const window = new Window();
Object.assign(globalThis, {
  React,
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { DrillRow } = await import("./DrillRow");

for (const variant of ["repeater", "field"] as const) {
  for (const exit of ["leave", "click", "unmount"] as const) {
    void test(`${variant} hover ends on ${exit}`, async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const messages: OverlayMessage[] = [];
      const postToIframe = (message: OverlayMessage) => messages.push(message);
      const hover =
        variant === "repeater"
          ? { variant, blockId: 13, fieldName: "statistics" }
          : { variant, fieldId: "13__image" };
      const type = variant === "repeater" ? "CAMOX_HOVER_REPEATER" : "CAMOX_HOVER_FIELD";
      const target =
        variant === "repeater"
          ? { blockId: "13", fieldName: "statistics" }
          : { fieldId: "13__image" };
      let clicks = 0;
      try {
        await React.act(async () => {
          root.render(
            <DrillRow
              label="Content"
              preview="Open"
              Icon={() => null}
              hover={hover}
              postToIframe={postToIframe}
              onClick={() => clicks++}
            />,
          );
        });
        const button = host.querySelector("button")!;
        await React.act(async () => {
          button.dispatchEvent(
            new window.MouseEvent("mouseover", { bubbles: true }) as unknown as MouseEvent,
          );
        });
        assert.deepEqual(messages, [{ type, ...target }]);

        await React.act(async () => {
          if (exit === "unmount") {
            root.render(null);
            return;
          }
          if (exit === "click") {
            button.click();
            return;
          }
          button.dispatchEvent(
            new window.MouseEvent("mouseout", {
              bubbles: true,
              relatedTarget: window.document.body,
            }) as unknown as MouseEvent,
          );
        });
        assert.deepEqual(messages, [
          { type, ...target },
          { type: `${type}_END`, ...target },
        ]);
        assert.equal(clicks, exit === "click" ? 1 : 0);
      } finally {
        await React.act(async () => root.unmount());
        host.remove();
      }
    });
  }
}
