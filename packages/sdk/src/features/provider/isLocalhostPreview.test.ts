import assert from "node:assert/strict";
import test from "node:test";

import { isLocalhostPreview } from "./CoreCamoxProvider";

void test("preview detects checkout hostnames without treating lookalike domains as loopback", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    for (const [hostname, expected] of [
      ["localhost", true],
      ["camox-first.localhost", true],
      ["camox-second.localhost", true],
      ["127.0.0.1", true],
      ["[::1]", true],
      ["localhost.example.com", false],
      ["camox-first.localhost.example.com", false],
      ["example.com", false],
    ] as const) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { location: { hostname } },
      });
      assert.equal(isLocalhostPreview(), expected, hostname);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
