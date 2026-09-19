import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import { getElementContext } from "./dom";

void test("missing elements are safe without browser globals", () => {
  assert.equal(getElementContext(null), null);
  assert.equal(getElementContext(undefined), null);
});

void test("resolves each element's own document and window, even before attachment", () => {
  const host = new Window();
  const preview = new Window();
  const thumbnail = new Window();

  for (const view of [host, preview, thumbnail]) {
    const element = view.document.createElement("div");
    const context = getElementContext(element as unknown as Element);
    assert.equal(context?.document, view.document);
    assert.equal(context?.window, view);
  }
});

void test("documents without a browsing context do not fall back to globals", () => {
  const view = new Window();
  const document = view.document.implementation.createHTMLDocument();
  assert.equal(document.defaultView, null);
  assert.equal(getElementContext(document.createElement("div") as unknown as Element), null);
});

void test("listeners and script insertion target only the owning window/document", () => {
  const host = new Window();
  const preview = new Window();
  const element = preview.document.createElement("div");
  const context = getElementContext(element as unknown as Element);
  assert.ok(context);

  let scrolls = 0;
  const onScroll = () => scrolls++;
  context.window.addEventListener("scroll", onScroll);
  host.dispatchEvent(new host.Event("scroll"));
  assert.equal(scrolls, 0);
  preview.dispatchEvent(new preview.Event("scroll"));
  assert.equal(scrolls, 1);
  context.window.removeEventListener("scroll", onScroll);
  preview.dispatchEvent(new preview.Event("scroll"));
  assert.equal(scrolls, 1);

  const script = context.document.createElement("script");
  context.document.head.appendChild(script);
  assert.equal(preview.document.querySelectorAll("script").length, 1);
  assert.equal(host.document.querySelectorAll("script").length, 0);
});
