import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPublicationPlan,
  getPublicationCapabilities,
  getPublicationRequest,
  type PublicationTarget,
} from "./publication.ts";

const pageTarget: Extract<PublicationTarget, { kind: "page" }> = {
  kind: "page",
  page: {
    id: 1,
    fullPath: "/about",
    status: "modified",
    livePublishedCheckpointId: 10,
    modifiedReason: {
      reason: "both",
      layoutId: 2,
      layoutHandle: "marketing",
      affectedPagesCount: 4,
    },
  },
};
const layoutTarget: Extract<PublicationTarget, { kind: "layout" }> = {
  kind: "layout",
  name: "Pokémon",
  layout: { id: 2, status: "modified", livePublishedCheckpointId: 20 },
};

void test("page publication separates required content from optional shared changes and reports impact", () => {
  const plan = buildPublicationPlan(pageTarget);
  assert.deepEqual(
    plan.items.map(({ key, optional }) => ({ key, optional })),
    [
      { key: "page:1", optional: false },
      { key: "layout:2", optional: true },
    ],
  );
  assert.match(plan.items[1].impact, /3 other pages/);
  assert.deepEqual(
    getPublicationRequest(
      pageTarget,
      plan.items.map((item) => item.key),
    ),
    {
      kind: "page",
      input: { id: 1, alsoPublishLayout: true },
    },
  );
});

void test("excluding shared changes preserves the single page endpoint without publishing the layout", () => {
  assert.deepEqual(getPublicationRequest(pageTarget, ["page:1"]), {
    kind: "page",
    input: { id: 1 },
  });
  assert.deepEqual(getPublicationRequest(pageTarget, ["layout:999", "block:5"]), {
    kind: "page",
    input: { id: 1 },
  });
});

void test("page-only changes do not invent shared dependencies", () => {
  const target: PublicationTarget = {
    ...pageTarget,
    page: { ...pageTarget.page, modifiedReason: { reason: "self" } },
  };
  assert.equal(buildPublicationPlan(target).items.length, 1);
  assert.deepEqual(getPublicationRequest(target, ["layout:2"]), { kind: "page", input: { id: 1 } });
});

void test("a layout-only page modification still offers shared scope explicitly", () => {
  const target: PublicationTarget = {
    ...pageTarget,
    page: {
      ...pageTarget.page,
      modifiedReason: {
        reason: "layout",
        layoutId: 2,
        layoutHandle: "marketing",
        affectedPagesCount: 1,
      },
    },
  };
  assert.match(buildPublicationPlan(target).items[1].impact, /Affects no other pages/);
});

void test("derived entry points use the same scope model without pretending derived URLs are enumerable", () => {
  const plan = buildPublicationPlan(layoutTarget);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].key, "layout:2");
  assert.equal(plan.items[0].optional, false);
  assert.match(plan.items[0].impact, /every page.*all derived URLs/);
  assert.match(plan.description, /external data are not published/);
  assert.deepEqual(getPublicationRequest(layoutTarget, ["layout:2"]), {
    kind: "layout",
    input: { id: 2 },
  });
});

void test("capabilities preserve home-page safety, live read-only publication and supported discard actions", () => {
  assert.deepEqual(getPublicationCapabilities(pageTarget, "draft"), {
    publish: true,
    unpublish: true,
    discard: true,
  });
  assert.equal(getPublicationCapabilities(pageTarget, "live").publish, false);
  assert.deepEqual(getPublicationCapabilities(layoutTarget, "draft"), {
    publish: true,
    unpublish: true,
    discard: false,
  });
  assert.equal(
    getPublicationCapabilities(
      { ...pageTarget, page: { ...pageTarget.page, fullPath: "/" } },
      "draft",
    ).unpublish,
    false,
  );
  assert.deepEqual(getPublicationCapabilities(null, "draft"), {
    publish: false,
    unpublish: false,
    discard: false,
  });
  assert.equal(
    getPublicationCapabilities(
      { ...layoutTarget, layout: { ...layoutTarget.layout, status: "published" } },
      "draft",
    ).publish,
    false,
  );
  assert.deepEqual(
    getPublicationCapabilities(
      {
        ...layoutTarget,
        layout: { ...layoutTarget.layout, status: "draft", livePublishedCheckpointId: null },
      },
      "draft",
    ),
    { publish: true, unpublish: false, discard: false },
  );
});
