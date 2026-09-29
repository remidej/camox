import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createBlock, Type } from "../createBlock";
import { isImagePlaceholder, type ImageValue } from "./contentType";
import { renderImagePlaceholder } from "./imagePlaceholder";

const placeholder = Type.Image().default as ImageValue;

void test("landscape layers use opaque gradients with unique references per placeholder", () => {
  const html = renderToStaticMarkup(
    <>
      {renderImagePlaceholder(placeholder, <img alt="" />)}
      {renderImagePlaceholder(placeholder, <img alt="" />)}
    </>,
  );
  const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
  const references = [...html.matchAll(/fill="url\(#([^"]+)\)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  assert.deepEqual(references, ids);
  assert.equal((html.match(/<stop /g) ?? []).length, 16);
  assert.match(html, /color-mix\(in oklab, currentColor/);
  assert.doesNotMatch(html, /opacity|transparent/);
});

void test("placeholder labels use field titles and inherit the site's font", () => {
  for (const [value, title] of [
    [Type.Image({ title: "Hero illustration" }).default, "Hero illustration"],
    [Type.ImageList({ title: "Gallery" }).items.default, "Gallery"],
    [placeholder, "image"],
  ] as const) {
    const html = renderToStaticMarkup(renderImagePlaceholder(value, <img alt="" />));
    assert.match(html, new RegExp(`>${title}</span>`));
    assert.match(html, /font-family:inherit/);
    assert.match(html, /justify-content:center/);
    assert.match(html, /background:currentColor/);
    assert.match(html, /user-select:none/);
  }
  const special = Type.Image({ title: "<Cover> & art" }).default;
  const html = renderToStaticMarkup(renderImagePlaceholder(special, <img alt="" />));
  assert.match(html, /&lt;Cover&gt; &amp; art<\/span>/);
});

void test("only explicit local defaults are placeholders, never URL lookalikes or uploads", () => {
  const image = <img src={placeholder.url} alt="" />;
  assert.equal((renderImagePlaceholder(placeholder, image) as React.ReactElement).type, "svg");
  const authored = JSON.parse(JSON.stringify(placeholder)) as ImageValue;
  assert.equal(renderImagePlaceholder(authored, image), image);
  assert.equal(renderImagePlaceholder({ ...placeholder, _fileId: "uploaded" }, image), image);
  assert.equal(isImagePlaceholder(authored), false);
  assert.equal(isImagePlaceholder(Type.ImageList().items.default), true);
});

void test("marker survives local copies but is absent from serialized content schemas", () => {
  assert.equal(isImagePlaceholder({ ...placeholder }), true);
  assert.equal(isImagePlaceholder(structuredClone(placeholder)), false);
  const schema = Type.Image();
  assert.deepEqual(Object.keys(schema.default), ["url", "alt", "filename", "mimeType"]);
  assert.deepEqual(Object.keys(schema.properties), ["url", "alt", "filename", "mimeType"]);
});

void test("wrapped, custom, empty, and behavioral callbacks retain their original result", () => {
  const Custom = () => <img src={placeholder.url} alt="" />;
  const results = [
    null,
    "text",
    <Custom />,
    <>
      <img src={placeholder.url} alt="" />
    </>,
    <picture>
      <img src={placeholder.url} alt="" />
    </picture>,
    <img src={placeholder.url} alt="" ref={React.createRef<HTMLImageElement>()} />,
    <img src={placeholder.url} alt="" onClick={() => {}} />,
    <img src={placeholder.url} alt="" onLoad={() => {}} />,
    <img src={placeholder.url} alt="" useMap="#map" />,
  ];
  for (const result of results) assert.equal(renderImagePlaceholder(placeholder, result), result);
});

void test("SVG preserves presentation and accessible naming, without image-only attributes", () => {
  const rendered = renderImagePlaceholder(
    placeholder,
    <img
      key="hero"
      src={placeholder.url}
      srcSet="image.png 2x"
      sizes="100vw"
      loading="lazy"
      decoding="async"
      alt="Mountain landscape"
      id="hero"
      width={600}
      height={400}
      className="h-auto w-full rounded-xl"
      style={{ maxWidth: 600, aspectRatio: "3 / 2" }}
      data-test="hero"
      aria-describedby="caption"
    />,
  ) as React.ReactElement<Record<string, unknown>>;
  assert.equal(rendered.key, "hero");
  assert.equal(rendered.props.width, 600);
  assert.equal(rendered.props.height, 400);
  assert.equal(rendered.props.className, "h-auto w-full rounded-xl");
  assert.deepEqual(rendered.props.style, { maxWidth: 600, aspectRatio: "3 / 2" });
  assert.equal(rendered.props["data-test"], "hero");
  assert.equal(rendered.props["aria-describedby"], "caption");
  assert.equal(rendered.props["aria-label"], "Mountain landscape");
  assert.equal(rendered.props.role, "img");
  for (const prop of ["src", "srcSet", "sizes", "alt", "loading", "decoding", "ref"]) {
    assert.equal(rendered.props[prop], undefined);
  }
  const decorative = renderToStaticMarkup(renderImagePlaceholder(placeholder, <img alt="" />));
  assert.match(decorative, /aria-hidden="true"/);
  assert.match(decorative, /width="1200" height="auto"/);
  const labeled = renderToStaticMarkup(
    renderImagePlaceholder(placeholder, <img alt="Other" aria-label="Author label" />),
  );
  assert.match(labeled, /aria-label="Author label"/);
});

void test("default SVG height is auto without overriding block sizing classes or inline styles", () => {
  // These callbacks mirror playground hero/gallery and landing video/logo blocks.
  // The auto presentation attribute (not inline style) lets both aspect-ratio
  // utilities and explicit height utilities win over the intrinsic 3:2 ratio.
  for (const className of [
    "mt-10 w-full max-w-xs rounded-lg lg:mt-0 lg:max-w-sm",
    "aspect-square w-full rounded-lg object-cover",
    "block aspect-video w-full object-cover",
    "h-8 w-auto",
    "h-full w-full object-cover",
  ]) {
    const rendered = renderImagePlaceholder(
      placeholder,
      <img className={className} />,
    ) as React.ReactElement<Record<string, unknown>>;
    assert.equal(rendered.props.height, "auto");
    assert.equal(rendered.props.width, 1200);
    assert.equal(rendered.props.viewBox, "0 0 1200 800");
    assert.equal(rendered.props.className, className);
    assert.equal(rendered.props.style, undefined);
  }

  const style = { width: "auto", height: 96 } satisfies React.CSSProperties;
  const rendered = renderImagePlaceholder(
    placeholder,
    <img width={300} height={200} style={style} />,
  ) as React.ReactElement<Record<string, unknown>>;
  assert.equal(rendered.props.width, 300);
  assert.equal(rendered.props.height, 200);
  assert.equal(rendered.props.style, style);
});

void test("normal runtime renders image, list and repeatable defaults with unchanged callback API", () => {
  let calls = 0;
  const image = (props: React.ImgHTMLAttributes<HTMLImageElement>, data: ImageValue) => {
    calls++;
    assert.equal(props.src, data.url);
    assert.equal(isImagePlaceholder(data), true);
    return <img {...props} className="h-auto w-full" />;
  };
  const block = createBlock({
    id: "placeholder-test",
    title: "Placeholder",
    description: "",
    content: {
      hero: Type.Image(),
      gallery: Type.ImageList({ defaultItems: 2 }),
      items: Type.Repeater({
        content: { image: Type.Image(), gallery: Type.ImageList({ defaultItems: 2 }) },
        minItems: 1,
        maxItems: 2,
        toMarkdown: () => [],
      }),
    },
    toMarkdown: () => [],
    component: () => (
      <>
        <block.Image name="hero">{image}</block.Image>
        <block.ImageList name="gallery">{image}</block.ImageList>
        <block.Repeater name="items">
          {(item) => (
            <>
              <item.Image name="image">{image}</item.Image>
              <item.ImageList name="gallery">{image}</item.ImageList>
            </>
          )}
        </block.Repeater>
      </>
    ),
  });
  const html = renderToStaticMarkup(
    <block._internal.Component
      mode="site"
      blockData={{ _id: 1, type: "placeholder-test", position: "a0", content: {} as never }}
    />,
  );
  assert.equal((html.match(/<svg/g) ?? []).length, 6);
  assert.equal(calls, 6);
  assert.deepEqual(block._internal.getInitialContent(), {});
  assert.ok(!JSON.stringify(block._internal.contentSchema).includes("imagePlaceholder"));
});

void test("normal runtime preserves authored images and custom callback URL fallbacks", () => {
  const authored = JSON.parse(JSON.stringify(placeholder)) as ImageValue;
  authored.url = "https://example.com/photo.jpg";
  authored.alt = "Authored photo";
  const block = createBlock({
    id: "authored-test",
    title: "Authored",
    description: "",
    content: { real: Type.Image(), wrapped: Type.Image() },
    toMarkdown: () => [],
    component: () => (
      <>
        <block.Image name="real">{(props) => <img {...props} className="photo" />}</block.Image>
        <block.Image name="wrapped">
          {(props) => (
            <picture>
              <img {...props} />
            </picture>
          )}
        </block.Image>
      </>
    ),
  });
  const html = renderToStaticMarkup(
    <block._internal.Component
      mode="site"
      blockData={{
        _id: 1,
        type: "authored-test",
        position: "a0",
        content: { real: authored } as never,
      }}
    />,
  );
  assert.equal((html.match(/<img/g) ?? []).length, 2);
  assert.ok(!html.includes("<svg"));
  assert.match(html, /alt="Authored photo"/);
  assert.match(html, /<picture><img[^>]+placehold\.co/);
});
