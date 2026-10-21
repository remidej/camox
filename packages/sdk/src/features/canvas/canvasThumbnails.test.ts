import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { Window } from "happy-dom";

import { createCanvasThumbnails } from "./canvasThumbnails";

/** A Page's frame showing `blocks`, captured as a tiny image. */
function setup(blocks: string[] = ["block-1"]) {
  const queryClient = new QueryClient();
  const captures: string[] = [];
  const thumbnails = createCanvasThumbnails(queryClient, {
    capture: async () => {
      captures.push("capture");
      return { blob: new Blob(["image"]), width: 1366, height: 2000 };
    },
  });
  const disconnect = thumbnails.connect();
  const window = new Window();
  window.document.body.innerHTML = blocks
    .map((id) => `<section data-camox-viewport-block="${id}"></section>`)
    .join("");
  const frame = { contentDocument: window.document } as unknown as HTMLIFrameElement;
  const capture = (key = "about") => thumbnails.capture(key, frame, ["/about"], { scale: 0.5 });
  return { queryClient, thumbnails, capture, captures, disconnect };
}

void test("a Page's image stays fresh until a read it used changes", async () => {
  const { queryClient, thumbnails, capture, disconnect } = setup();
  const blockKey = ["blocks", "get", "block-1"];
  queryClient.setQueryData(blockKey, { title: "Hello" });
  await capture();
  assert.equal(thumbnails.get("about")?.stale, false);
  assert.equal(thumbnails.get("about")?.height, 2000);

  // Like another Page loading, seeding its layout's blocks again with new, equal objects.
  queryClient
    .getQueryCache()
    .find({ queryKey: blockKey })
    ?.setState({ data: { title: "Hello" } });
  assert.equal(thumbnails.get("about")?.stale, false, "equal data again changes nothing");
  queryClient.setQueryData(["blocks", "get", "block-2"], { title: "Elsewhere" });
  assert.equal(thumbnails.get("about")?.stale, false, "another Page's block changes nothing");

  queryClient.setQueryData(blockKey, { title: "Hello again" });
  assert.equal(thumbnails.get("about")?.stale, true);
  disconnect();
});

void test("realtime invalidations reach images, even of reads their Page didn't use yet", async () => {
  const { queryClient, thumbnails, capture, disconnect } = setup();
  await capture();
  queryClient.setQueryData(["pages", "getByPath", "/contact"], {});
  await queryClient.invalidateQueries({ queryKey: ["pages", "getByPath", "/contact"] });
  assert.equal(thumbnails.get("about")?.stale, false);

  // Like a read an edit adds to the Page, cached after the capture.
  queryClient.setQueryData(["pages", "getByPath", "/about", "extra"], {});
  assert.equal(thumbnails.get("about")?.stale, false);
  await queryClient.invalidateQueries({ queryKey: ["pages", "getByPath", "/about"] });
  assert.equal(thumbnails.get("about")?.stale, true);
  disconnect();
});

void test("an image keeps the reads it used cached, so their changes still reach it", async () => {
  const { queryClient, thumbnails, capture, disconnect } = setup();
  const blockKey = ["blocks", "get", "block-1"];
  queryClient.setQueryDefaults(blockKey, { gcTime: 0 });
  queryClient.setQueryData(blockKey, { title: "Hello" });
  // The Page's frame uses the read until its image replaces it.
  const frameUse = new QueryObserver(queryClient, { queryKey: blockKey, enabled: false });
  const unmountFrame = frameUse.subscribe(() => {});
  await capture();
  unmountFrame();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(queryClient.getQueryCache().find({ queryKey: blockKey }), "the read stays cached");
  await queryClient.invalidateQueries({ queryKey: blockKey });
  assert.equal(thumbnails.get("about")?.stale, true);
  disconnect();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    queryClient.getQueryCache().find({ queryKey: blockKey }),
    undefined,
    "until dropped",
  );
});

void test("stale images refresh one at a time, while the camera is still", async () => {
  const { thumbnails, capture, disconnect } = setup();
  thumbnails.setMoving(true);
  const releaseAbout = thumbnails.requestRefresh("about");
  thumbnails.requestRefresh("contact");
  assert.equal(thumbnails.isRefreshing("about"), false, "nothing refreshes while the camera moves");

  thumbnails.setMoving(false);
  assert.equal(thumbnails.isRefreshing("about"), true);
  assert.equal(thumbnails.isRefreshing("contact"), false);

  await capture("about");
  assert.equal(thumbnails.isRefreshing("about"), false);
  assert.equal(thumbnails.isRefreshing("contact"), true, "the next one refreshes once it's done");
  releaseAbout();
  thumbnails.abandon("contact");
  assert.equal(thumbnails.isRefreshing("contact"), false);
  disconnect();
});

void test("only the latest capture of a Page becomes its image", async () => {
  const queryClient = new QueryClient();
  const pending: ((height: number) => void)[] = [];
  const thumbnails = createCanvasThumbnails(queryClient, {
    capture: () =>
      new Promise((resolve) =>
        pending.push((height) => resolve({ blob: new Blob(["image"]), width: 1, height })),
      ),
  });
  const disconnect = thumbnails.connect();
  const frame = { contentDocument: new Window().document } as unknown as HTMLIFrameElement;
  const drawing = async (count: number) => {
    while (pending.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const older = thumbnails.capture("about", frame, [], { scale: 1 });
  await drawing(1);
  const newer = thumbnails.capture("about", frame, [], { scale: 1 });
  await drawing(2);
  assert.equal(pending.length, 2, "both captures are drawing");
  pending[1](200);
  await newer;
  pending[0](100);
  await older;
  assert.equal(thumbnails.get("about")?.height, 200);
  disconnect();
});

void test("a capture waits for fetches to finish, then draws what they brought", async () => {
  const { queryClient, thumbnails, capture, captures, disconnect } = setup();
  const blockKey = ["blocks", "get", "block-1"];
  queryClient.setQueryData(blockKey, { title: "Hello" });
  let answer: (value: unknown) => void = () => {};
  // Like a refreshing Page refetching its block, or a block loading its own data.
  const refetch = queryClient.fetchQuery({
    queryKey: blockKey,
    queryFn: () => new Promise((resolve) => (answer = resolve)),
    staleTime: 0,
  });
  const captured = capture();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(captures.length, 0, "nothing is drawn while anything fetches");
  answer({ title: "Hello again" });
  await refetch;
  await captured;
  assert.equal(captures.length, 1);
  assert.equal(thumbnails.get("about")?.stale, false, "the image holds what the fetch brought");
  disconnect();
});
