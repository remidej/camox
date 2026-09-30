import { describe, expect, it } from "vitest";

import { getProjectRoomSessionHeaders } from "./project-room-auth";

describe("getProjectRoomSessionHeaders", () => {
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

    const headers = getProjectRoomSessionHeaders(request);

    expect(headers.get("Cookie")).toBe("better-auth.session_token=current");
    expect(headers.has("Better-Auth-Cookie")).toBe(false);
  });

  it("retains the browser cookie when no session is relayed", () => {
    const request = new Request("http://localhost/parties/project-room/1", {
      headers: { Cookie: "better-auth.session_token=current" },
    });

    expect(getProjectRoomSessionHeaders(request).get("Cookie")).toBe(
      "better-auth.session_token=current",
    );
  });
});
