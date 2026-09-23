import assert from "node:assert/strict";
import { test } from "node:test";

import { iconCollectionIds, resolveIconSvg, scopeIconSvgIds } from "@camox/api-contract";
import { QueryClient, QueryClientProvider, dehydrate, hydrate } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import { Type, createBlock } from "../createBlock";
import { IconSvg, iconQuery, prefetchIcons } from "./icons";

const collection = {
  prefix: "test",
  width: 24,
  height: 24,
  icons: { arrow: { body: '<path d="M0 0h24" />' } },
  aliases: { reverse: { parent: "arrow", hFlip: true } },
};

void test("catalog IDs and SVGs include transformed aliases", () => {
  assert.deepEqual(iconCollectionIds(collection), ["test:arrow", "test:reverse"]);
  assert.match(resolveIconSvg(collection, "test:reverse").body, /transform/);
  assert.equal(resolveIconSvg(collection, "test:arrow").attributes.viewBox, "0 0 24 24");
  for (const id of ["arrow", "other:arrow", "test:missing", "test:arrow:extra"]) {
    assert.throws(() => resolveIconSvg(collection, id));
  }
});

void test("icon fields require a configured, namespaced default", () => {
  Object.assign(globalThis, { __CAMOX_ICON_IDS__: ["test:arrow", "test:reverse"] });
  try {
    const schema = Type.Icon({ default: "test:arrow" as never });
    assert.equal(schema.fieldType, "Icon");
    assert.equal(schema.type, "string");
    assert.deepEqual(schema.enum, ["test:arrow", "test:reverse"]);
    for (const value of [undefined, null, "arrow", "other:arrow", "test:missing"]) {
      assert.throws(() => Type.Icon({ default: value as never }));
    }
  } finally {
    Reflect.deleteProperty(globalThis, "__CAMOX_ICON_IDS__");
  }
  assert.throws(() => Type.Icon({ default: "test:arrow" as never }));
});

void test("SVG IDs are deterministic and references are scoped", () => {
  const body =
    '<defs><path id="a.b" /></defs><use href="#a.b"/><g fill="url(#a.b)"/><animate begin="a.b.end"/>';
  const scoped = scopeIconSvgIds(body, "instance-");
  assert.equal(scoped, scopeIconSvgIds(body, "instance-"));
  assert.match(scoped, /id="instance-a.b"/);
  assert.match(scoped, /href="#instance-a.b"/);
  assert.match(scoped, /url\(#instance-a.b\)/);
  assert.match(scoped, /begin="instance-a.b.end"/);
});

void test("SSR prefetch resolves selected IDs, not the catalog, and survives hydration", async () => {
  Object.assign(globalThis, { __CAMOX_API_URL__: "https://camox.test" });
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(input instanceof Request ? input.url : String(input));
    return Response.json(resolveIconSvg(collection, "test:arrow"));
  };
  const client = new QueryClient();
  const hydrated = new QueryClient();
  try {
    await prefetchIcons(
      client,
      { fieldType: "Icon", enum: ["test:arrow", "test:reverse"], default: "test:arrow" },
      { icon: "test:arrow", href: "mailto:hello" },
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0]!, /camox.test\/icons\/.+\/test\/arrow$/);
    hydrate(hydrated, dehydrate(client));
    const render = () =>
      renderToString(
        <QueryClientProvider client={hydrated}>
          <IconSvg iconId="test:arrow" className="icon" />
          <IconSvg iconId="test:arrow" aria-label="Arrow" />
        </QueryClientProvider>,
      );
    const html = render();
    assert.match(html, /<path/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /aria-label="Arrow"/);
    assert.match(html, /role="img"/);
    assert.ok(hydrated.getQueryData(iconQuery("test:arrow").queryKey));
    assert.equal(requests.length, 1);

    Object.assign(globalThis, { __CAMOX_ICON_IDS__: ["test:arrow"] });
    const icon = Type.Icon({ default: "test:arrow" as never });
    const block = createBlock({
      id: "icons",
      title: "Icons",
      description: "",
      content: {
        icon,
        items: Type.Repeater({
          content: { icon },
          minItems: 1,
          maxItems: 2,
          toMarkdown: (c) => [c.icon],
        }),
      },
      toMarkdown: (c) => [c.icon],
      component: () => (
        <>
          <block.Icon name="icon" />
          <block.Repeater name="items">{(item) => <item.Icon name="icon" />}</block.Repeater>
        </>
      ),
    });
    const blockHtml = renderToString(
      <QueryClientProvider client={hydrated}>
        <block._internal.Component
          mode="site"
          blockData={{ _id: 1, type: "icons", position: "a0", content: {} as never }}
        />
      </QueryClientProvider>,
    );
    assert.equal((blockHtml.match(/<svg/g) ?? []).length, 2);
    assert.equal((blockHtml.match(/<path/g) ?? []).length, 2);
  } finally {
    Reflect.deleteProperty(globalThis, "__CAMOX_ICON_IDS__");
    client.clear();
    hydrated.clear();
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, "__CAMOX_API_URL__");
  }
});
