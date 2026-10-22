import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

import { createApp } from "../core/createApp";

const window = new Window({ url: "https://site.test/camox?ott=single-use-token" });
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { createRoot } = await import("react-dom/client");
const { useAuthState } = await import("./auth");
const { CoreCamoxProvider } = await import("../features/provider/CoreCamoxProvider");

void test("a studio sign-in doesn't look signed out while its one-time token is exchanged", async () => {
  // The exchange answers only once the test lets it, so the page has rendered meanwhile.
  let answer: () => void = () => {};
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/auth/one-time-token/verify");
    answer = () => {
      answer = () => {};
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Better-Auth-Cookie":
          "better-auth.session_token=session.signature; Max-Age=3600; Path=/",
      });
      res.end(JSON.stringify({ session: { token: "session" }, user: { id: "user" } }));
    };
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  let reloaded = false;
  window.location.reload = () => {
    reloaded = true;
  };

  const states: { isAuthenticated: boolean; isLoading: boolean }[] = [];
  function Probe() {
    states.push(useAuthState());
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const queryClient = new QueryClient();
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CoreCamoxProvider
            apiUrl={apiUrl}
            authenticationUrl="https://dashboard.test"
            camoxApp={createApp({ blocks: [] })}
            projectUuid="site"
          >
            <Probe />
          </CoreCamoxProvider>
        </QueryClientProvider>,
      );
    });
    for (let i = 0; i < 100 && !reloaded; i++) {
      answer();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    assert.ok(reloaded, "the token exchange did not finish");
    // Signed out and done loading is what sends the studio back to the dashboard for a token.
    assert.deepEqual(
      states.filter((state) => !state.isAuthenticated && !state.isLoading),
      [],
    );
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await window.happyDOM.close();
  }
});
