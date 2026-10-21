import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import type { Touch, TouchedBatch } from "@camox/api-contract/threads";

import type { NavigateOptions, NavigationSource } from "../navigation/navigation";
import { previewStore } from "../preview/previewStore";
import {
  createFollowAgent,
  FOLLOW_MINIMUM_STAY,
  type FollowPage,
  type FollowWhere,
} from "./followAgent";

/** The Canvas pages in Canvas order, in the viewed Locale. */
const home: FollowPage = {
  key: "page:home",
  pathname: "/",
  owner: { kind: "page", pageId: "home" },
  layoutId: "main",
  blocks: [
    { id: "header", type: "navbar" },
    { id: "hero", type: "hero" },
    { id: "features", type: "features" },
    { id: "quote", type: "testimonial" },
    { id: "footer", type: "footer" },
  ],
};
const about: FollowPage = {
  key: "page:about",
  pathname: "/about",
  owner: { kind: "page", pageId: "about" },
  layoutId: "main",
  blocks: [
    { id: "header", type: "navbar" },
    { id: "story", type: "text" },
    { id: "team", type: "team" },
    { id: "footer", type: "footer" },
  ],
};
const contact: FollowPage = {
  key: "page:contact",
  pathname: "/contact",
  owner: { kind: "page", pageId: "contact" },
  layoutId: "main",
  blocks: [
    { id: "header", type: "navbar" },
    { id: "form", type: "form" },
    { id: "footer", type: "footer" },
  ],
};
const landing: FollowPage = {
  key: "page:landing",
  pathname: "/landing",
  owner: { kind: "page", pageId: "landing" },
  layoutId: "bare",
  blocks: [{ id: "pitch", type: "hero" }],
};
const pricing: FollowPage = {
  key: "singleton:pricing",
  pathname: "/pricing",
  owner: { kind: "layout", layoutId: "pricing" },
  layoutId: "pricing",
  blocks: [{ id: "plans", type: "plans" }],
};
const PAGES = [home, about, contact, landing, pricing];

const pageTouch = (pageId: string, blockId?: string, kind: Touch["kind"] = "edited"): Touch => ({
  entity: "page",
  pageId,
  ...(blockId ? { blockId } : {}),
  kind,
});
const batch = (...touches: Touch[]): TouchedBatch => ({ operationIds: ["op-1"], touches });

function setUp(t: TestContext, where: Partial<FollowWhere> = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  previewStore.send({ type: "reset" });
  const navigations: NavigateOptions[] = [];
  const initial: FollowWhere = {
    pages: PAGES,
    locale: "en",
    location: { pathname: "/", search: "?camox-draft=d1" },
    pageKey: home.key,
    blockCatalogPath: (type) => `/camox/blocks/${type}`,
    ...where,
  };
  let current = initial;
  const follow = createFollowAgent({
    navigate: (options) => {
      navigations.push(options);
    },
    where: initial,
  });
  t.after(() => follow.dispose());
  /**
   * Where the Studio is once a navigation commits, its frame not active yet: following's own,
   * unless another source made it.
   */
  const arrive = (
    page: FollowPage,
    { source }: { source?: NavigationSource } = { source: "follow" },
  ) => {
    current = {
      ...current,
      location: { ...current.location, pathname: page.pathname!, source },
      pageKey: page.key,
    };
    follow.update(current);
  };
  /** The page's editing frame becomes the active one, as the Canvas or the Preview claims it. */
  const activate = (page: FollowPage) => {
    if (page.owner.kind === "page")
      previewStore.send({ type: "activatePage", pageId: page.owner.pageId });
    else previewStore.send({ type: "activateLayout", layoutId: page.owner.layoutId });
  };
  const selection = () => previewStore.getSnapshot().context.editingContext?.selection ?? null;
  const update = (next: Partial<FollowWhere>) => {
    current = { ...current, ...next };
    follow.update(current);
  };
  return { follow, navigations, arrive, activate, selection, update };
}

void test("a touch on another page goes there, replacing the history entry with the follow source", (t) => {
  const { follow, navigations } = setUp(t);
  follow.receive(batch(pageTouch("about", "team")));
  assert.deepEqual(navigations, [{ to: "/about?camox-draft=d1", replace: true, source: "follow" }]);
});

void test("the block is selected only once the destination page's editing frame is active", (t) => {
  const { follow, arrive, activate, selection } = setUp(t);
  activate(home);
  follow.receive(batch(pageTouch("about", "team")));
  assert.equal(selection(), null);
  arrive(about);
  // The previous page's frame is released after the navigation, clearing the selection.
  previewStore.send({ type: "clearSelection" });
  assert.equal(selection(), null);
  activate(about);
  assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
    kind: "page",
    pageId: "about",
    selection: { type: "block", blockId: "team" },
  });
});

void test("touches on the editor's page keep them there, selecting the topmost touched block right away", (t) => {
  const { follow, navigations, activate, selection } = setUp(t);
  activate(home);
  follow.receive(
    batch(
      pageTouch("about", "team"),
      pageTouch("about", "story"),
      pageTouch("about", "footer"),
      pageTouch("home", "quote"),
      pageTouch("home", "hero"),
    ),
  );
  assert.equal(navigations.length, 0);
  assert.deepEqual(selection(), { type: "block", blockId: "hero" });
});

void test("without the editor's page, following goes to the page with the most touches, the first in Canvas order on a tie", (t) => {
  const { follow, navigations } = setUp(t);
  follow.receive(
    batch(pageTouch("about", "team"), pageTouch("contact", "form"), pageTouch("contact", "header")),
  );
  assert.equal(navigations.at(-1)?.to, "/contact?camox-draft=d1");
  t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
  follow.receive(batch(pageTouch("landing", "pitch"), pageTouch("about", "team")));
  assert.equal(navigations.at(-1)?.to, "/about?camox-draft=d1");
});

void test("on the destination page, the topmost touched block is selected, whatever the write order", (t) => {
  const { follow, arrive, activate, selection } = setUp(t);
  follow.receive(
    batch(pageTouch("about", "footer"), pageTouch("about", "team"), pageTouch("about", "story")),
  );
  arrive(about);
  activate(about);
  assert.deepEqual(selection(), { type: "block", blockId: "story" });
});

void test("a page's settings, or a deleted block, go to the page without selecting a block", (t) => {
  for (const touch of [
    pageTouch("about", undefined, "settings"),
    pageTouch("about", "team", "deleted"),
  ]) {
    const { follow, navigations, arrive, activate, selection } = setUp(t);
    follow.receive(batch(touch));
    assert.equal(navigations.at(-1)?.to, "/about?camox-draft=d1");
    arrive(about);
    activate(about);
    assert.equal(selection(), null);
    follow.dispose();
    t.mock.timers.reset();
  }
});

void test("a deleted page gives no destination", (t) => {
  const { follow, navigations } = setUp(t);
  follow.receive(batch(pageTouch("about", "team"), pageTouch("about", undefined, "deleted")));
  assert.equal(navigations.length, 0);
});

void test("a page the agent created is gone to once it shows on the Canvas", (t) => {
  const { follow, navigations, update } = setUp(t);
  follow.receive(
    batch(pageTouch("careers", undefined, "created"), pageTouch("careers", "jobs", "created")),
  );
  assert.equal(navigations.length, 0);
  const careers: FollowPage = {
    key: "page:careers",
    pathname: "/careers",
    owner: { kind: "page", pageId: "careers" },
    layoutId: "main",
  };
  update({ pages: [...PAGES, careers] });
  assert.equal(navigations.at(-1)?.to, "/careers?camox-draft=d1");
});

void test("a Synced Block's shared content stays on the editor's page if placed there, else goes to the Block Catalog", (t) => {
  const { follow, navigations, activate, selection } = setUp(t);
  activate(home);
  follow.receive(batch({ entity: "synced-block", blockType: "testimonial", kind: "edited" }));
  assert.equal(navigations.length, 0);
  assert.deepEqual(selection(), { type: "block", blockId: "quote" });
  follow.receive(batch({ entity: "synced-block", blockType: "team", kind: "edited" }));
  assert.deepEqual(navigations, [
    { to: "/camox/blocks/team?camox-draft=d1", replace: true, source: "follow" },
  ]);
});

void test("a Layout's blocks stay on the editor's page if it uses the Layout, else go to the first page using it", (t) => {
  const { follow, navigations, arrive, activate, selection } = setUp(t, {
    location: { pathname: "/contact", search: "?camox-draft=d1" },
    pageKey: contact.key,
  });
  activate(contact);
  follow.receive(batch({ entity: "layout", layoutId: "main", blockId: "footer", kind: "edited" }));
  assert.equal(navigations.length, 0);
  assert.deepEqual(selection(), { type: "block", blockId: "footer" });
  follow.receive(
    batch({ entity: "layout", layoutId: "pricing", blockId: "plans", kind: "edited" }),
  );
  assert.equal(navigations.at(-1)?.to, "/pricing?camox-draft=d1");
  arrive(pricing);
  activate(pricing);
  assert.deepEqual(previewStore.getSnapshot().context.editingContext, {
    kind: "layout",
    layoutId: "pricing",
    selection: { type: "block", blockId: "plans" },
  });
});

void test("touches in another Locale count only toward pages the viewed Locale shows", (t) => {
  const { follow, navigations } = setUp(t);
  follow.receive(
    batch(
      { entity: "page", pageId: "impressum", blockId: "legal", kind: "edited", locale: "de" },
      { entity: "page", pageId: "impressum", blockId: "address", kind: "edited", locale: "de" },
      { entity: "page", pageId: "contact", blockId: "form", kind: "edited", locale: "de" },
    ),
  );
  assert.deepEqual(
    navigations.map(({ to }) => to),
    ["/contact?camox-draft=d1"],
  );
});

void test("following stays on a page for the minimum stay, then goes to the latest destination only", (t) => {
  const { follow, navigations, arrive } = setUp(t);
  follow.receive(batch(pageTouch("about", "team")));
  arrive(about);
  follow.receive(batch(pageTouch("contact", "form")));
  follow.receive(batch(pageTouch("landing", "pitch")));
  t.mock.timers.tick(FOLLOW_MINIMUM_STAY - 1);
  assert.equal(navigations.length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(
    navigations.map(({ to }) => to),
    ["/about?camox-draft=d1", "/landing?camox-draft=d1"],
  );
  assert.ok(navigations.every(({ replace }) => replace));
});

void test("a destination on the editor's page moves within it right away, dropping a waiting one", (t) => {
  const { follow, navigations, arrive, activate, selection } = setUp(t);
  follow.receive(batch(pageTouch("about", "team")));
  arrive(about);
  activate(about);
  follow.receive(batch(pageTouch("contact", "form")));
  follow.receive(batch(pageTouch("about", "story")));
  assert.deepEqual(selection(), { type: "block", blockId: "story" });
  t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
  assert.deepEqual(
    navigations.map(({ to }) => to),
    ["/about?camox-draft=d1"],
  );
});

void test("following stops when the editor takes over, and starts again with their next run", (t) => {
  const { follow, navigations, arrive, activate, selection } = setUp(t);
  follow.receive(batch(pageTouch("about", "team")));
  follow.takeOver();
  arrive(about);
  activate(about);
  assert.equal(
    selection(),
    null,
    "the destination's block isn't selected once the editor took over",
  );
  follow.receive(batch(pageTouch("contact", "form")));
  t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
  assert.equal(navigations.length, 1);
  follow.resume();
  follow.receive(batch(pageTouch("contact", "form")));
  assert.equal(navigations.at(-1)?.to, "/contact?camox-draft=d1");
});

void test("a touched block that shows above the selected one later takes the selection", (t) => {
  const { follow, arrive, activate, selection, update } = setUp(t);
  follow.receive(batch(pageTouch("about", "team"), pageTouch("about", "intro", "created")));
  arrive(about);
  activate(about);
  assert.deepEqual(selection(), { type: "block", blockId: "team" });
  const withIntro: FollowPage = {
    ...about,
    blocks: [
      { id: "header", type: "navbar" },
      { id: "intro", type: "text" },
      ...about.blocks!.slice(1),
    ],
  };
  update({ pages: [home, withIntro, contact, landing, pricing] });
  assert.deepEqual(selection(), { type: "block", blockId: "intro" });
});

void test("the editor selecting something themselves stops following; its own selections and frames clearing them don't", (t) => {
  const { follow, navigations, arrive, activate, selection } = setUp(t);
  activate(home);
  follow.receive(batch(pageTouch("home", "hero")));
  follow.receive(batch(pageTouch("about", "team")));
  arrive(about);
  // The home page's frame is released, clearing the selection, then about's claims it.
  previewStore.send({ type: "clearSelection" });
  activate(about);
  assert.deepEqual(selection(), { type: "block", blockId: "team" });
  follow.receive(batch(pageTouch("about", "story")));
  assert.deepEqual(selection(), { type: "block", blockId: "story" });
  // The editor picks a field of the selected block.
  previewStore.send({
    type: "selectBlockField",
    kind: "page",
    pageId: "about",
    blockId: "story",
    fieldName: "title",
    fieldType: "String",
  });
  follow.receive(batch(pageTouch("about", "team")));
  follow.receive(batch(pageTouch("contact", "form")));
  t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
  assert.deepEqual(
    navigations.map(({ to }) => to),
    ["/about?camox-draft=d1"],
  );
  assert.equal(selection()?.type, "block-field");
});

void test("the editor going to another page themselves stops following; following's own navigations and content changes don't", (t) => {
  for (const source of ["canvas", undefined] as const) {
    const { follow, navigations, arrive, update } = setUp(t);
    follow.receive(batch(pageTouch("about", "team")));
    arrive(about);
    update({ pages: [...PAGES] });
    t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
    follow.receive(batch(pageTouch("contact", "form")));
    assert.equal(navigations.at(-1)?.to, "/contact?camox-draft=d1");
    arrive(contact);
    // The editor picks a page in the Canvas Navigator, or goes back in their browser's history.
    arrive(landing, { source });
    t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
    follow.receive(batch(pageTouch("about", "story")));
    t.mock.timers.tick(FOLLOW_MINIMUM_STAY);
    assert.deepEqual(
      navigations.map(({ to }) => to),
      ["/about?camox-draft=d1", "/contact?camox-draft=d1"],
    );
    follow.dispose();
    t.mock.timers.reset();
  }
});
