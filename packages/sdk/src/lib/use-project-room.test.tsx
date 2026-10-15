import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { test, type TestContext } from "node:test";

import type { EndedDraft } from "@camox/api-contract/drafts";
import type { ProjectRoomMessage } from "@camox/api-contract/query-keys";
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

async function waitFor(check: () => boolean, message = "Expected live preview update") {
  for (let i = 0; i < 200 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.ok(check(), message);
}

/** Lets time pass long enough for a broadcast to have refetched anything it would. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
}

/**
 * A project room server and a preview rendering one query per key, each counting its fetches.
 * `send` broadcasts a message to the preview over its WebSocket.
 */
async function projectRoom(
  t: TestContext,
  queryKeys: ReadonlyArray<readonly unknown[]>,
  options: { onDraftEnded?: (ended: EndedDraft) => void } = {},
) {
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
  const fetches = queryKeys.map(() => 0);
  let content = "Before edit";

  function Query({ index }: { index: number }) {
    const query = useQuery({
      queryKey: queryKeys[index]!,
      queryFn: async () => {
        fetches[index]!++;
        return content;
      },
    });
    return <p>{query.data}</p>;
  }
  function Preview() {
    useProjectRoom(apiUrl, 1, options);
    return queryKeys.map((key, index) => <Query key={JSON.stringify(key)} index={index} />);
  }

  t.after(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.WebSocket = NativeWebSocket;
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Preview />
      </QueryClientProvider>,
    );
  });
  await waitFor(() => requestedUrls.length > 0);
  await waitFor(() => !!connection && fetches.every((count) => count === 1));

  return {
    host,
    fetches,
    requestedUrls,
    setContent: (next: string) => {
      content = next;
    },
    send(message: ProjectRoomMessage) {
      const frame = Buffer.from(JSON.stringify(message));
      assert.ok(frame.length < 126);
      connection!.write(Buffer.concat([Buffer.from([0x81, frame.length]), frame]));
    },
  };
}

void test("worktree preview refetches after a project-room broadcast without reloading", async (t) => {
  const room = await projectRoom(t, [["camox", "blocks", "get", "42", "live"]]);
  assert.equal(room.requestedUrls[0]!.protocol, "ws:");
  assert.equal(room.requestedUrls[0]!.hostname, "checkout.localhost");
  assert.equal(room.requestedUrls[0]!.pathname, "/parties/project-room/1");
  assert.equal(room.requestedUrls[0]!.searchParams.get("_authCookie"), "");
  assert.equal(room.host.textContent, "Before edit");

  room.setContent("After broadcast");
  room.send({ type: "invalidate", draftId: null, targets: [["camox", "blocks", "get", "42"]] });
  await waitFor(() => room.host.textContent === "After broadcast");
  assert.equal(room.fetches[0], 2);
  assert.equal(room.requestedUrls.length, 1, "the update uses the existing connection");
});

void test("an edit in one draft doesn't refetch another draft's queries, while a Live change refetches everyone's", async (t) => {
  const block = ["camox", "blocks", "get", "42"];
  const [inLive, inDraftA, inDraftB] = [0, 1, 2];
  const room = await projectRoom(t, [
    [...block, "live"],
    [...block, "draft-a"],
    [...block, "draft-b"],
  ]);

  room.send({ type: "invalidate", draftId: "draft-a", targets: [block as never] });
  await waitFor(() => room.fetches[inDraftA] === 2, "the edited draft's query refetches");
  await settle();
  assert.equal(room.fetches[inLive], 1, "Live doesn't refetch for a draft's edit");
  assert.equal(room.fetches[inDraftB], 1, "another draft doesn't refetch for a draft's edit");

  room.send({ type: "invalidate", draftId: null, targets: [block as never] });
  await waitFor(() => room.fetches.every((count, index) => count === (index === inDraftA ? 3 : 2)));
});

void test("viewers hear that a draft ended, how and by whom", async (t) => {
  const heard: EndedDraft[] = [];
  const room = await projectRoom(t, [], { onDraftEnded: (ended) => heard.push(ended) });
  const ended: EndedDraft = {
    draftId: "draft-a",
    outcome: "published",
    endedBy: { id: "user-1", name: "Rémi" },
    endedAt: 1,
  };

  room.send({ type: "draftEnded", ...ended });

  await waitFor(() => heard.length === 1, "the draft-ended message is heard");
  assert.deepEqual(heard[0], ended);
});

test.after(() => window.happyDOM.close());
