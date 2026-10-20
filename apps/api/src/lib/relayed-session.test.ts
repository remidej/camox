import { describe, expect, it } from "vite-plus/test";

import { getRelayedSessionHeaders } from "./relayed-session";

describe("getRelayedSessionHeaders", () => {
  it("uses the relayed session instead of conflicting browser cookies", () => {
    const request = new Request(
      `http://localhost/parties/project-room/1?_authCookie=${encodeURIComponent(
        "better-auth.session_token=current",
      )}`,
      {
        headers: {
          Cookie: "better-auth.session_token=another-checkout",
          "Better-Auth-Cookie": "better-auth.session_token=stale",
        },
      },
    );

    const headers = getRelayedSessionHeaders(request);

    expect(headers.get("Cookie")).toBe("better-auth.session_token=current");
    expect(headers.has("Better-Auth-Cookie")).toBe(false);
  });

  it("retains the browser cookie when no session is relayed", () => {
    const request = new Request("http://localhost/parties/project-room/1", {
      headers: { Cookie: "better-auth.session_token=current" },
    });

    expect(getRelayedSessionHeaders(request).get("Cookie")).toBe(
      "better-auth.session_token=current",
    );
  });
});
