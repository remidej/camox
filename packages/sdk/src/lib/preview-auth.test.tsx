import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { Window } from "happy-dom";
import { act, StrictMode } from "react";

const window = new Window({ url: "http://localhost:3000/about" });
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { createCamoxAuthClient, useProcessOtt } = await import("./auth");

void test("fresh browser handoff exchanges once, persists SSR auth, and surfaces failures", async () => {
  let exchanges = 0;
  let rejectToken = false;
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/auth/one-time-token/verify");
    assert.equal(req.method, "POST");
    assert.equal(req.headers["better-auth-cookie"], "");
    exchanges++;
    res.writeHead(rejectToken ? 401 : 200, {
      "Content-Type": "application/json",
      ...(rejectToken
        ? {}
        : {
            "Set-Better-Auth-Cookie":
              "better-auth.session_token=session.signature; Max-Age=3600; Path=/",
          }),
    });
    res.end(
      JSON.stringify(
        rejectToken
          ? { message: "Expired token" }
          : { session: { token: "session" }, user: { id: "user" } },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const target = { projectSlug: "site", environmentName: "dev:me@example.test", apiUrl };
  let reloads = 0;
  window.location.reload = () => {
    reloads++;
  };

  async function mount(expected = target) {
    window.localStorage.clear();
    window.document.cookie = "camox_auth_cookie=; Max-Age=0; Path=/";
    const url = new URL("http://localhost:3000/about?other=value#heading");
    url.searchParams.set("camox-preview", JSON.stringify(expected));
    url.searchParams.set("ott", "single-use-token");
    window.history.replaceState({}, "", url.href);
    const auth = createCamoxAuthClient(apiUrl);
    const host = document.createElement("div");
    const root = createRoot(host);
    function Harness() {
      const result = useProcessOtt(auth, target);
      return <div>{JSON.stringify(result)}</div>;
    }
    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      );
    });
    return {
      host,
      async unmount() {
        await act(async () => root.unmount());
      },
    };
  }
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    assert.ok(check(), "handoff did not finish");
  }
  try {
    const success = await mount();
    await waitFor(() => reloads === 1);
    assert.equal(exchanges, 1, "StrictMode must not consume the token twice");
    assert.ok(window.localStorage.getItem("better-auth_cookie")?.includes("session.signature"));
    assert.match(window.document.cookie, /camox_auth_cookie=/);
    assert.equal(new URL(window.location.href).searchParams.has("ott"), false);
    assert.equal(new URL(window.location.href).searchParams.get("other"), "value");
    assert.equal(window.location.hash, "#heading");
    await success.unmount();

    rejectToken = true;
    const expired = await mount();
    await waitFor(() => expired.host.textContent?.includes("Preview sign-in failed") === true);
    assert.equal(reloads, 1);
    assert.equal(window.localStorage.getItem("better-auth_cookie"), null);
    await expired.unmount();

    const before = exchanges;
    const mismatch = await mount({ ...target, apiUrl: "https://wrong.example.test" });
    assert.match(mismatch.host.textContent ?? "", /does not match/);
    assert.equal(exchanges, before);
    assert.equal(new URL(window.location.href).searchParams.has("ott"), false);
    await mismatch.unmount();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await window.happyDOM.close();
  }
});
