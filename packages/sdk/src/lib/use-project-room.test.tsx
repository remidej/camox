import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { test } from "node:test";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

const window = new Window({ url: "http://checkout.localhost:3000" });
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { useProjectRoom } = await import("./use-project-room");

void test("worktree preview refetches after a project-room broadcast without reloading", async (t) => {
  const NativeWebSocket = globalThis.WebSocket;
  const requestedUrls: URL[] = [];
  // Route this test hostname without relying on the machine's *.localhost DNS.
  // Preserve the protocol so an accidental wss:// still fails against HTTP.
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const target = new URL(url);
      requestedUrls.push(new URL(target));
      target.hostname = "127.0.0.1";
      super(target, protocols);
    }
  };
  t.after(() => {
    globalThis.WebSocket = NativeWebSocket;
  });
  const sockets = new Set<Duplex>();
  let connection: Duplex | undefined;
  const server = createServer();
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    connection = socket;
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://checkout.localhost:${address.port}`;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  const root = createRoot(host);
  const queryKey = ["camox", "blocks", "get", 42] as const;
  let content = "Before edit";
  let fetches = 0;
  function Preview() {
    useProjectRoom(apiUrl, 1);
    const query = useQuery({
      queryKey,
      queryFn: async () => {
        fetches++;
        return content;
      },
    });
    return <p>{query.data}</p>;
  }
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 200 && !check(); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    assert.ok(check(), "Expected live preview update");
  }
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Preview />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => requestedUrls.length > 0);
    assert.equal(requestedUrls[0]!.protocol, "ws:");
    assert.equal(requestedUrls[0]!.hostname, "checkout.localhost");
    assert.equal(requestedUrls[0]!.pathname, "/parties/project-room/1");
    assert.equal(requestedUrls[0]!.searchParams.get("_authCookie"), "");
    await waitFor(() => !!connection && host.textContent === "Before edit");

    content = "After broadcast";
    const frame = Buffer.from(JSON.stringify({ type: "invalidate", targets: [queryKey] }));
    assert.ok(frame.length < 126);
    connection!.write(Buffer.concat([Buffer.from([0x81, frame.length]), frame]));
    await waitFor(() => host.textContent === "After broadcast");
    assert.equal(fetches, 2);
    assert.equal(requestedUrls.length, 1, "the update uses the existing connection");
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await window.happyDOM.close();
  }
});
