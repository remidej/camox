import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchLocalhostOnLoopback } from "./loopbackFetch";

void test("*.localhost requests go to loopback with their method, headers, and body", async () => {
  const sent: Request[] = [];
  const fetch = fetchLocalhostOnLoopback(async (input) => {
    sent.push(input as Request);
    return new Response("ok");
  });

  await fetch("http://camox-abc.localhost:8788/rpc/pages?x=1", {
    method: "POST",
    headers: { cookie: "session=1" },
    body: "{}",
  });
  await fetch(new Request("https://api.camox.ai/rpc"));

  assert.equal(sent[0]!.url, "http://127.0.0.1:8788/rpc/pages?x=1");
  assert.equal(sent[0]!.method, "POST");
  assert.equal(sent[0]!.headers.get("cookie"), "session=1");
  assert.equal(await sent[0]!.text(), "{}");
  assert.equal(sent[1]!.url, "https://api.camox.ai/rpc");
});
