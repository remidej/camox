import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createRpcContext,
  seedLive,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { router } from "../../router";
import { files } from "../../schema";

// Blocks and repeatable items describe what they show as Structured Data nodes, from their
// `toStructuredData` templates. The API evaluates the templates on each page read, as it does
// `toMarkdown`, and the runtime links the nodes into the page's graph.

type Headers = Record<string, string>;

const string = { type: "string", fieldType: "String" };

/** The Template's FAQ block, as its definition syncs. */
const faq = {
  blockId: "faq",
  title: "FAQ",
  description: "Questions",
  contentSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        fieldType: "Repeater",
        items: { type: "object", properties: { question: string, answer: string } },
        toMarkdown: ["Q: {{question}}", "A: {{answer}}"],
        toTitle: "{{question}}",
        toStructuredData: {
          "@type": "Question",
          name: "{{question}}",
          acceptedAnswer: { "@type": "Answer", text: "{{answer}}" },
        },
      },
    },
    toMarkdown: ["{{items}}"],
    toTitle: "FAQ",
    toStructuredData: "{{items}}",
  },
};

/** A block showing a product, with a field of every kind its template can place. */
const showcase = {
  blockId: "showcase",
  title: "Showcase",
  description: "A product",
  contentSchema: {
    type: "object",
    properties: {
      name: string,
      photo: { type: "object", fieldType: "Image" },
      manual: { type: "object", fieldType: "File" },
      link: { type: "object", fieldType: "Link" },
      video: { type: "string", fieldType: "Embed" },
    },
    toMarkdown: ["{{name}}"],
    toStructuredData: [
      {
        "@type": "Product",
        name: "{{name}} by Acme",
        image: "{{photo}}",
        url: "{{link}}",
        offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      },
      { "@type": "VideoObject", name: "{{name}}", embedUrl: "{{video}}" },
      { "@type": "Book", name: "{{name}} manual", author: "Acme", url: "{{manual}}" },
    ],
  },
};

/** A project with the blocks above, a pricing page, and a draft every test reads and writes in. */
async function fixture() {
  const base = await createProjectFixture(`structured-data-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await syncDefinitionSet(db, project, { blocks: [faq, showcase] });
  const draft = generateUuidv7();
  const en: Headers = { [DRAFT_HEADER]: draft };
  const de: Headers = { [DRAFT_HEADER]: draft, [LOCALE_HEADER]: "de" };
  const member = (headers: Headers) => ({ context: createRpcContext(db, memberUser, headers) });
  const createPage = async (pathSegment: string, headers: Headers = en) =>
    (
      await call(
        router.pages.create,
        { projectId, pathSegment, layoutId: base.layout.layoutId },
        member(headers),
      )
    ).page;
  const help = await createPage("help", { ...en, [DRAFT_CREATE_HEADER]: "1" });
  const pricing = await createPage("pricing");
  const create = (type: string, content: Record<string, unknown>) =>
    call(router.blocks.create, { pageId: help.id, type, content }, member(en));
  const read = (headers: Headers = en) =>
    call(router.pages.getByPath, { projectUuid: project.uuid, path: "/help" }, member(headers));
  return { ...base, projectId, help, pricing, en, de, member, create, read };
}

describe("block and repeatable item structured data", () => {
  it("places one node per repeatable item where the block's template places the repeater", async () => {
    const f = await fixture();
    const block = await f.create("faq", {
      items: [
        { question: "How long?", answer: "Two days" },
        { question: "How much?", answer: "Free" },
      ],
    });

    const { structuredData } = await f.read();

    expect(structuredData[block.id]).toEqual([
      {
        "@type": "Question",
        name: "How long?",
        acceptedAnswer: { "@type": "Answer", text: "Two days" },
      },
      {
        "@type": "Question",
        name: "How much?",
        acceptedAnswer: { "@type": "Answer", text: "Free" },
      },
    ]);
  });

  it("gives each placement its own nodes", async () => {
    const f = await fixture();
    const first = await f.create("faq", { items: [{ question: "Why?", answer: "Because" }] });
    const second = await f.create("faq", { items: [{ question: "When?", answer: "Now" }] });

    const { structuredData } = await f.read();

    expect(structuredData[first.id]).toEqual([expect.objectContaining({ name: "Why?" })]);
    expect(structuredData[second.id]).toEqual([expect.objectContaining({ name: "When?" })]);
  });

  it("resolves field tokens: text, images, files, links and embeds, in the page's locale", async () => {
    const f = await fixture();
    const photo = await seedLive(f.db, files, {
      projectId: f.projectId,
      url: "https://api.camox.test/files/serve/1/laptop",
      filename: "laptop.png",
      alt: "A laptop",
      altsByLocale: { de: "Ein Laptop" },
      mimeType: "image/png",
      size: 200_000,
      width: 2560,
      height: 1440,
      blobId: "laptop",
      path: "1/laptop",
      createdAt: 1,
      updatedAt: 1,
    });
    const manual = await seedLive(f.db, files, {
      projectId: f.projectId,
      url: "https://api.camox.test/files/serve/1/manual",
      filename: "manual.pdf",
      alt: "",
      mimeType: "application/pdf",
      size: 200_000,
      blobId: "manual",
      path: "1/manual",
      createdAt: 1,
      updatedAt: 1,
    });
    const block = await f.create("showcase", {
      name: "Laptop",
      photo: { _fileId: photo.id },
      manual: { _fileId: manual.id },
      link: { type: "page", pageId: f.pricing.id, text: "Pricing", newTab: false },
      video: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
    await call(router.locales.add, { projectId: f.projectId, tag: "de" }, f.member(f.en));
    await call(router.pages.update, { id: f.pricing.id, pathSegment: "preise" }, f.member(f.de));
    await call(
      router.blocks.updateContent,
      { id: block.id, content: { name: "Laptop DE" } },
      f.member(f.de),
    );

    const english = (await f.read()).structuredData[block.id];
    const german = (await f.read(f.de)).structuredData[block.id];

    const transformed =
      "https://api.camox.test/cdn-cgi/image/format=auto,quality=85,fit=scale-down,width=1280/files/serve/1/laptop";
    expect(german).toEqual([
      {
        "@type": "Product",
        name: "Laptop DE by Acme",
        image: {
          "@type": "ImageObject",
          url: transformed,
          contentUrl: transformed,
          width: 1280,
          height: 720,
          caption: "Ein Laptop",
        },
        url: { "@camox": "pageUrl", path: "/preise", locale: "de" },
        offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      },
      {
        "@type": "VideoObject",
        name: "Laptop DE",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      },
      {
        "@type": "Book",
        name: "Laptop DE manual",
        author: "Acme",
        url: "https://api.camox.test/files/serve/1/manual",
      },
    ]);
    expect(english?.[0]).toMatchObject({
      name: "Laptop by Acme",
      image: { caption: "A laptop" },
      url: { "@camox": "pageUrl", path: "/pricing" },
    });
  });

  it("links to the default locale's page when the page isn't in the locale", async () => {
    const f = await fixture();
    const block = await f.create("showcase", { name: "Laptop" });
    await call(router.locales.add, { projectId: f.projectId, tag: "de" }, f.member(f.en));
    const later = await call(
      router.pages.create,
      { projectId: f.projectId, pathSegment: "later", layoutId: f.layout.layoutId },
      f.member(f.en),
    );
    const link = { type: "page", pageId: later.page.id, text: "Later", newTab: false };
    await call(router.blocks.updateContent, { id: block.id, content: { link } }, f.member(f.de));

    const [product] = (await f.read(f.de)).structuredData[block.id]!;

    expect(product).toMatchObject({ url: { "@camox": "pageUrl", path: "/later" } });
    expect(product!.url).not.toHaveProperty("locale");
  });

  it("leaves out properties whose fields are empty, and external links as their href", async () => {
    const f = await fixture();
    const block = await f.create("showcase", {
      name: "Laptop",
      link: { type: "external", href: "https://acme.test/laptop", text: "Buy", newTab: true },
    });

    const [product, video, book] = (await f.read()).structuredData[block.id]!;

    expect(product).toMatchObject({ url: "https://acme.test/laptop" });
    expect(product).not.toHaveProperty("image");
    expect(video).not.toHaveProperty("embedUrl");
    expect(book).not.toHaveProperty("url");
  });

  it("has no nodes for blocks without a template", async () => {
    const f = await fixture();
    await syncDefinitionSet(f.db, f.project, {
      blocks: [{ ...faq, contentSchema: { ...faq.contentSchema, toStructuredData: undefined } }],
    });
    const block = await f.create("faq", { items: [{ question: "Why?", answer: "Because" }] });

    expect((await f.read()).structuredData[block.id]).toBeUndefined();
  });

  it("keeps what a template shows under a setting only when the setting holds", async () => {
    const f = await fixture();
    const when = (setting: string, show: unknown, equals?: string) => ({
      "@camox": "if",
      setting,
      ...(equals !== undefined && { equals }),
      show,
    });
    await syncDefinitionSet(f.db, f.project, {
      blocks: [
        {
          blockId: "promo",
          title: "Promo",
          description: "A product",
          contentSchema: {
            type: "object",
            properties: {
              name: string,
              items: {
                type: "array",
                fieldType: "Repeater",
                items: { type: "object", properties: { question: string } },
                itemSettingsSchema: { properties: { answered: { default: true } } },
                toMarkdown: ["{{question}}"],
                toTitle: "{{question}}",
                toStructuredData: {
                  "@type": "Question",
                  name: "{{question}}",
                  answerCount: when("itemSettings.answered", 1),
                },
              },
            },
            toMarkdown: ["{{name}}"],
            toTitle: "{{name}}",
            toStructuredData: [
              {
                "@type": "Product",
                name: "{{name}}",
                award: when("settings.featured", "Best seller"),
                slogan: when("settings.tone", "Buy {{name}}!", "loud"),
                offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
              },
              when("settings.featured", [
                { "@type": "VideoObject", name: "{{name}} ad" },
                "{{items}}",
              ]),
            ],
          },
          settingsSchema: {
            properties: { featured: { default: false }, tone: { default: "quiet" } },
          },
        },
      ],
    });
    const content = { name: "Laptop", items: [{ question: "Why?" }] };
    const plain = await f.create("promo", content);
    const featured = await call(
      router.blocks.create,
      { pageId: f.help.id, type: "promo", content, settings: { featured: true, tone: "loud" } },
      f.member(f.en),
    );

    const { structuredData } = await f.read();

    expect(structuredData[plain.id]).toEqual([
      {
        "@type": "Product",
        name: "Laptop",
        offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      },
    ]);
    expect(structuredData[featured.id]).toEqual([
      {
        "@type": "Product",
        name: "Laptop",
        award: "Best seller",
        slogan: "Buy Laptop!",
        offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      },
      { "@type": "VideoObject", name: "Laptop ad" },
      { "@type": "Question", name: "Why?", answerCount: 1 },
    ]);
  });
});
