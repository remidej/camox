import assert from "node:assert/strict";
import { test } from "node:test";

import type { EndedDraft } from "@camox/api-contract/drafts";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { createDraftScope, useCurrentDraftId } from "../../lib/draft-scope";
import { StudioScopeProvider } from "../../lib/draft-scope.fixtures";
import { type LocaleView, parseLocalePath } from "../../lib/locale-path";
import { useLocalePath } from "../../lib/view-locale";
import { useViewLocale } from "../../lib/view-locale-context";
import { type NextView, useViewPreparer, useViewShown } from "../../lib/view-switch";
import { Link, useNavigate } from "../navigation/navigation";
import type { DraftNotice } from "../routes/pageRuntime";
import { PageNavigationProvider } from "./pageNavigation";
import type { PageRenderInput } from "./runtime";

const ENDED_DRAFT = "ended";
const EN: LocaleView = { tag: "en", isDefault: true };
const DE: LocaleView = { tag: "de", isDefault: false };
const ended: EndedDraft = {
  draftId: ENDED_DRAFT,
  outcome: "deleted",
  endedBy: { id: "user-2", name: "Ada" },
  endedAt: 1,
};

/**
 * A page runtime whose `/_camox/data` endpoint reads the draft the request names, like the real
 * runtime for a member: an ended draft is refused and Live is read instead.
 */
async function openPage(
  t: test.TestContext,
  url: string,
  initial: Partial<PageRenderInput> = {},
  /** What the studio gets ready for each switch, which shows once it settles. */
  prepare: (next: NextView) => Promise<unknown> = async () => {},
) {
  const window = new Window({ url });
  Object.assign(globalThis, {
    React,
    window,
    document: window.document,
    location: window.location,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  t.mock.method(window, "scrollTo", () => {});
  document.body.innerHTML = '<div id="root"></div>';
  const queryClient = new QueryClient();
  const input: PageRenderInput = {
    locale: EN,
    locales: [EN, DE],
    presentation: "studio",
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectUuid: "test",
    href: window.location.href,
    pathname: new URL(url).pathname,
    runtimeBasePath: "",
    head: {},
    layoutIdentity: null,
    loaderData: null,
    dehydratedState: dehydrate(new QueryClient()),
    ...initial,
  };
  const dataRequests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (request: URL | RequestInfo) => {
    const requested = new URL(request instanceof Request ? request.url : request);
    dataRequests.push(requested);
    const draft = requested.searchParams.get("camox-draft");
    const refused = draft === ENDED_DRAFT;
    const href = new URL(requested.searchParams.get("path")!, window.location.origin);
    if (draft && !refused) href.searchParams.set("camox-draft", draft);
    const next: PageRenderInput = {
      ...input,
      pathname: href.pathname,
      locale: parseLocalePath(href.pathname, input.locales).locale,
      href: href.href,
      draftId: draft && !refused ? draft : undefined,
      refusedDraft: refused ? { notice: { reason: "ended", ...ended } } : undefined,
    };
    return Response.json(next);
  });
  // The window's draft scope, as the page client creates it.
  const draftScope = createDraftScope({
    queryClient,
    browser: window as never,
  });
  const notices: DraftNotice[] = [];
  t.after(draftScope.onNotice((notice) => notices.push(notice)));

  let navigate!: ReturnType<typeof useNavigate>;
  let mounts = 0;
  let shown!: { locale: string; path: string; draft: string | null };
  let viewShown!: () => Promise<void>;
  function Workspace() {
    navigate = useNavigate();
    viewShown = useViewShown();
    useViewPreparer(prepare);
    const rendered = {
      locale: useViewLocale().locale.tag,
      path: useLocalePath(),
      draft: useCurrentDraftId(),
    };
    // What the page shows is what committed: a switch renders ahead in the background.
    React.useLayoutEffect(() => {
      shown = rendered;
    });
    React.useEffect(() => {
      mounts++;
    }, []);
    return (
      <>
        <a id="contact" href="/contact">
          Contact
        </a>
        <Link id="sdk-link" to="/pricing">
          Pricing
        </Link>
      </>
    );
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => {
    root.render(
      <StudioScopeProvider client={queryClient} draftScope={draftScope}>
        <PageNavigationProvider
          camoxApp={createApp({ blocks: [] })}
          initialInput={input}
          queryClient={queryClient}
        >
          {() => <Workspace />}
        </PageNavigationProvider>
      </StudioScopeProvider>,
    );
  });
  t.after(async () => {
    await React.act(async () => root.unmount());
    queryClient.clear();
    await window.happyDOM.close();
  });

  return {
    window,
    draftScope,
    dataRequests,
    notices,
    mounts: () => mounts,
    shown: () => shown,
    navigate: (options: Parameters<typeof navigate>[0]) =>
      React.act(async () => {
        await navigate(options);
      }),
    viewShown: () => viewShown(),
    draftInUrl: () => new URL(window.location.href).searchParams.get("camox-draft"),
    back: async (href: string) => {
      // Happy DOM doesn't traverse history: reproduce the browser's URL update and popstate.
      window.history.replaceState(null, "", href);
      await React.act(async () => {
        window.dispatchEvent(new window.PopStateEvent("popstate"));
      });
    },
  };
}

void test("plain links in the page keep the draft, and the page they open is read from it", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=d1", { draftId: "d1" });

  await React.act(async () => {
    (document.getElementById("contact") as HTMLElement).click();
  });

  assert.equal(page.window.location.pathname, "/contact");
  assert.equal(page.draftInUrl(), "d1");
  assert.equal(page.dataRequests.at(-1)!.searchParams.get("camox-draft"), "d1");
  assert.equal(page.draftScope.current(), "d1");
});

void test("SDK links name the draft, including one the first edit just started", async (t) => {
  const page = await openPage(t, "https://site.test/about");
  const sdkLink = () => document.getElementById("sdk-link")!.getAttribute("href");
  assert.equal(sdkLink(), "/pricing");

  await React.act(async () => {
    page.draftScope.requestHeaders(true).settle(true);
  });

  const started = page.draftInUrl();
  assert.ok(started);
  assert.equal(sdkLink(), `/pricing?camox-draft=${started}`);
  assert.equal(page.mounts(), 1, "starting a draft keeps the page mounted");
});

void test("a link from the preview keeps the draft", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=d1", { draftId: "d1" });

  // The preview iframe hands the studio the link's absolute URL, which names no draft.
  await page.navigate({ to: "https://site.test/contact" });

  assert.equal(page.draftInUrl(), "d1");
  assert.equal(page.dataRequests.at(-1)!.searchParams.get("camox-draft"), "d1");
});

void test("switching drafts reads the page from the new draft, and Back returns to the previous one", async (t) => {
  const page = await openPage(t, "https://site.test/about");
  const entries = page.window.history.length;

  await page.navigate({ to: page.window.location.href, draft: "d2" });

  assert.equal(page.draftInUrl(), "d2");
  assert.equal(page.window.history.length, entries + 1);
  assert.equal(page.dataRequests.length, 1, "the same page is read again from the draft");
  assert.equal(page.dataRequests[0]!.searchParams.get("camox-draft"), "d2");
  assert.equal(page.draftScope.current(), "d2");
  assert.equal(page.shown().draft, "d2", "the page shows the draft");
  assert.equal(page.mounts(), 1, "the page stays mounted, so it never shows a loading state");

  await page.back("/about");

  assert.equal(page.dataRequests.length, 2);
  assert.equal(page.dataRequests[1]!.searchParams.get("camox-draft"), null);
  assert.equal(page.draftScope.current(), null, "Back returns to Live");
  assert.equal(page.shown().draft, null);
  assert.equal(page.mounts(), 1);
});

void test("a page under a locale's prefix shows in that locale, and its links keep it", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=d1", { draftId: "d1" });

  await page.navigate({ to: "/de/preise" });

  assert.equal(page.window.location.pathname, "/de/preise");
  assert.equal(page.draftInUrl(), "d1", "the draft composes with the locale's prefix");
  assert.equal(page.draftScope.locale().tag, "de");
  assert.deepEqual(page.shown(), { locale: "de", path: "/preise", draft: "d1" });
  assert.equal(page.mounts(), 1, "the page stays mounted, so it never shows a loading state");

  await page.navigate({ to: "/de/kontakt" });

  assert.equal(page.mounts(), 1);
  assert.deepEqual(page.shown(), { locale: "de", path: "/kontakt", draft: "d1" });
});

void test("navigating within a draft keeps the page mounted", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=d1", { draftId: "d1" });

  await page.navigate({ to: "/contact" });

  assert.equal(page.mounts(), 1);
});

void test("a draft the page can't show is removed from the URL without a history entry", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=ended", {
    href: "https://site.test/about",
    refusedDraft: { notice: { reason: "ended", ...ended } },
  });

  assert.equal(page.draftInUrl(), null, "the param goes as the page opens");
  assert.equal(page.draftScope.current(), null);
  assert.deepEqual(page.notices, [{ reason: "ended", ...ended }]);

  const entries = page.window.history.length;
  await page.back("/contact?camox-draft=ended");

  assert.equal(page.draftInUrl(), null, "and when history reaches an ended draft");
  assert.equal(page.window.history.length, entries);
  assert.equal(page.notices.length, 2);
});

void test("a visitor's draft param goes without a notice", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=d1", {
    href: "https://site.test/about",
    refusedDraft: { notice: null },
  });

  assert.equal(page.draftInUrl(), null);
  assert.deepEqual(page.notices, []);
});

void test("a draft that ended switches the page to Live in place, read again", async (t) => {
  const page = await openPage(t, "https://site.test/about?camox-draft=d1", { draftId: "d1" });
  const entries = page.window.history.length;

  await React.act(async () => {
    page.draftScope.leave(ended, { notice: true });
  });

  assert.equal(page.draftInUrl(), null);
  assert.equal(page.window.history.length, entries, "the draft's entry is replaced");
  assert.equal(page.dataRequests.length, 1);
  assert.equal(page.dataRequests[0]!.searchParams.get("camox-draft"), null, "read from Live");
  assert.equal(page.shown().draft, null, "the page shows Live");
  assert.equal(page.mounts(), 1, "the page stays mounted, so it never shows a loading state");
  assert.deepEqual(page.notices, [{ reason: "ended", ...ended }]);
});

void test("a switch keeps showing the last view until the next one is ready, then shows it", async (t) => {
  let ready!: () => void;
  const prepared: NextView[] = [];
  const page = await openPage(t, "https://site.test/about", {}, (next) => {
    prepared.push(next);
    return new Promise<void>((resolve) => (ready = resolve));
  });
  let shown = false;

  await page.navigate({ to: page.window.location.href, draft: "d2" });
  void page.viewShown().then(() => (shown = true));

  assert.deepEqual(prepared, [{ pathname: "/about", draftId: "d2", locale: EN }]);
  assert.equal(page.draftScope.current(), "d2", "reads and writes already go to the draft");
  assert.equal(page.shown().draft, null, "the page still shows Live");
  assert.equal(shown, false);

  await React.act(async () => ready());

  assert.equal(page.shown().draft, "d2");
  assert.equal(shown, true);
  assert.equal(page.mounts(), 1);
});
