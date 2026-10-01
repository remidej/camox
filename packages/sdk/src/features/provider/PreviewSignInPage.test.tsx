import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { authPageStyles } from "../../lib/auth-page-styles";
import { PreviewSignInPage } from "./PreviewSignInPage";

void test("sign-in is styled in server HTML without site or Studio stylesheets", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderToStaticMarkup(<PreviewSignInPage />);
    const page = window.document.querySelector("main")!;
    assert.equal(page.getAttribute("role"), "status");
    assert.equal(page.getAttribute("data-camox-preview"), "pending");
    assert.equal(page.querySelector("style")?.textContent, authPageStyles);
    assert.equal(page.querySelector("p")?.textContent, "Signing in to draft preview…");
    assert.equal(page.querySelector(".camox-auth-spinner")?.getAttribute("aria-hidden"), "true");
    const style = window.getComputedStyle(page);
    assert.equal(style.position, "fixed");
    assert.equal(style.backgroundColor, "#09090b");
    assert.equal(style.alignItems, "center");
    assert.equal(style.justifyContent, "center");
    assert.equal(window.document.querySelector("link"), null);
  } finally {
    await window.happyDOM.close();
  }
});

void test("sign-in failures use the same standalone page without a loading spinner", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderToStaticMarkup(
      <PreviewSignInPage error="The link has expired. Request a fresh link." />,
    );
    const page = window.document.querySelector("main")!;
    assert.equal(page.getAttribute("role"), "alert");
    assert.equal(page.getAttribute("data-camox-preview"), "error");
    assert.equal(page.querySelector("style")?.textContent, authPageStyles);
    assert.equal(page.querySelector(".camox-auth-spinner"), null);
    assert.equal(
      page.querySelector("p")?.textContent,
      "The link has expired. Request a fresh link.",
    );
  } finally {
    await window.happyDOM.close();
  }
});
