import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import * as React from "react";

import { StudioScopeProvider } from "../../../lib/draft-scope.fixtures";

// The Preview's frame keeps its document for its lifetime, so the page and its position survive
// navigation. A new revision's document, with its Theme's stylesheets, restyles it in place, as
// the Canvas reloads to show it (spec #560, section 1).

/** A site document whose head holds `stylesheet`, as the studio reads a revision's. */
const siteDocument = (stylesheet: string) =>
  `<!doctype html><html><head><link rel="stylesheet" href="${stylesheet}"></head>` +
  '<body><div id="root" data-camox-preview-root></div></body></html>';

void test("a new revision's stylesheets restyle the Preview's frame, keeping its page", async (t) => {
  const window = new Window({ url: "https://acme.camox.site/" });
  Object.assign(globalThis, {
    React,
    window,
    document: window.document,
    location: window.location,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  document.body.innerHTML = '<div id="root"></div>';
  const { QueryClient } = await import("@tanstack/react-query");
  const { createRoot } = await import("react-dom/client");
  const { Frame } = await import("./Frame");
  const { NavigationProvider } = await import("../../navigation/navigation");
  const { PreviewDocumentContext } = await import("../../runtime/PreviewDocumentContext");
  const queryClient = new QueryClient();

  let showDocument!: (html: string) => void;
  function Preview() {
    const [html, setHtml] = React.useState(siteDocument("/assets/theme-old.css"));
    showDocument = setHtml;
    return (
      <PreviewDocumentContext.Provider value={html}>
        <Frame>
          <p id="page">The page</p>
        </Frame>
      </PreviewDocumentContext.Provider>
    );
  }
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => {
    root.render(
      <StudioScopeProvider client={queryClient}>
        <NavigationProvider>
          <Preview />
        </NavigationProvider>
      </StudioScopeProvider>,
    );
  });
  // Happy DOM doesn't load srcdoc: the frame gets a document of its own, from its srcdoc.
  const iframe = document.querySelector("iframe")!;
  const frame = new Window({ url: window.location.href });
  frame.document.write(iframe.getAttribute("srcdoc") ?? "");
  Object.defineProperty(iframe, "contentDocument", { value: frame.document });
  Object.defineProperty(iframe, "contentWindow", { value: frame });
  await React.act(async () => {
    iframe.dispatchEvent(new window.Event("load") as never);
  });
  t.after(async () => {
    await React.act(async () => root.unmount());
    await frame.happyDOM.close();
    await window.happyDOM.close();
  });
  const page = frame.document.getElementById("page");
  assert.ok(page);

  await React.act(async () => showDocument(siteDocument("/_camox/r/rev-2/assets/theme-new.css")));

  const stylesheets = [...frame.document.head.querySelectorAll('link[rel="stylesheet"]')].map(
    (link) => link.getAttribute("href"),
  );
  assert.deepEqual(stylesheets, ["/_camox/r/rev-2/assets/theme-new.css"]);
  assert.equal(frame.document.getElementById("page"), page, "the page wasn't reloaded");
});
