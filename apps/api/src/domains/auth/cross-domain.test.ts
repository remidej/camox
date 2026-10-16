import { describe, expect, it } from "vite-plus/test";

import { resolveCallbackURL } from "./cross-domain";

describe("resolveCallbackURL", () => {
  it("uses the request origin for relative callback URLs", () => {
    expect(
      resolveCallbackURL(
        "/studio-authorize?callback=http%3A%2F%2Flocalhost%3A3000",
        "https://app.camox.dev",
        "http://localhost:3274",
      ),
    ).toBe("http://localhost:3274/studio-authorize?callback=http%3A%2F%2Flocalhost%3A3000");
  });

  it("falls back to the configured dashboard URL when the request has no origin", () => {
    expect(resolveCallbackURL("/profile", "https://app.camox.dev")).toBe(
      "https://app.camox.dev/profile",
    );
  });

  it("preserves absolute callback URLs", () => {
    expect(
      resolveCallbackURL(
        "http://localhost:3274/studio-authorize",
        "https://app.camox.dev",
        "https://example.com",
      ),
    ).toBe("http://localhost:3274/studio-authorize");
  });
});
