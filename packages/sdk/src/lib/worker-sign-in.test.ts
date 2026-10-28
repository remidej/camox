import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { Window } from "happy-dom";

const window = new Window({ url: "https://site.test/about" });
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
});
const { createCamoxAuthClient, getAuthCookieHeader } = await import("./auth");

void test("a browser takes the session the Worker signed in with, and sends it", async () => {
  const sent: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    sent.push(req.headers["better-auth-cookie"] as string | undefined);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ session: { token: "worker" }, user: { id: "user" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const session = "better-auth.session_token=worker.signature";
    window.localStorage.clear();
    // An earlier visit's session, which the Worker's sign-in replaces.
    window.localStorage.setItem(
      "better-auth_cookie",
      JSON.stringify({ "better-auth.session_token": { value: "old.signature", expires: null } }),
    );
    window.document.cookie = `camox_auth_cookie=${encodeURIComponent(session)}; Path=/`;

    const auth = createCamoxAuthClient(`http://127.0.0.1:${address.port}`);
    await auth.getSession();
    assert.deepEqual(sent, [session]);
    assert.equal(getAuthCookieHeader(), session);
    assert.match(window.document.cookie, /camox_auth_cookie=better-auth.session_token%3Dworker/);
  } finally {
    server.close();
    await window.happyDOM.close();
  }
});
