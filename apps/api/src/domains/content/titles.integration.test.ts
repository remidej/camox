import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext, syncDefinitionSet } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { saveValue } from "../generated-values/service";

// Blocks and repeatable items are identified by their title until they have a Summary. Titles are
// evaluated from `toTitle` templates on default-locale content, like Summaries (ADR 0012).

type Headers = Record<string, string>;

const string = { type: "string", fieldType: "String" };

/** A project with an FAQ block definition, and a draft every test reads and writes in. */
async function fixture() {
  const base = await createProjectFixture(`titles-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await syncDefinitionSet(db, project, {
    blocks: [
      {
        blockId: "faq",
        title: "FAQ",
        description: "Questions",
        contentSchema: {
          type: "object",
          properties: {
            headline: string,
            questions: {
              type: "array",
              fieldType: "Repeater",
              items: { type: "object", properties: { question: string, answer: string } },
              toMarkdown: ["{{question}}"],
              toTitle: "Q: {{question}}",
            },
          },
          toMarkdown: ["# {{headline}}", "{{questions}}"],
          toTitle: "{{headline}} (FAQ)",
        },
      },
      {
        blockId: "cta",
        title: "Call to action",
        description: "A link",
        contentSchema: {
          type: "object",
          properties: { link: { fieldType: "Link" } },
          toMarkdown: ["{{link}}"],
          toTitle: "Go to {{link}}",
        },
      },
      {
        blockId: "plain",
        title: "Plain",
        description: "No title",
        contentSchema: {
          type: "object",
          properties: { text: string },
          toMarkdown: ["{{text}}"],
        },
      },
    ],
  });
  const draft = generateUuidv7();
  const en: Headers = { [DRAFT_HEADER]: draft };
  const de: Headers = { [DRAFT_HEADER]: draft, [LOCALE_HEADER]: "de" };
  const member = (headers: Headers) => ({ context: createRpcContext(db, memberUser, headers) });
  const { page } = await call(
    router.pages.create,
    { projectId, pathSegment: "help", layoutId: base.layout.layoutId },
    member({ ...en, [DRAFT_CREATE_HEADER]: "1" }),
  );
  const create = (type: string, content: Record<string, unknown>) =>
    call(router.blocks.create, { pageId: page.id, type, content }, member(en));
  const read = (id: string, headers = en) => call(router.blocks.get, { id }, member(headers));
  const summarize = (entity: "block" | "repeatableItem", entityId: string, summary: string) =>
    runService(
      saveValue(
        db,
        { projectId, draftId: draft },
        { entity, entityId, type: "summary" },
        { summary },
        Date.now(),
      ),
    );
  return { ...base, projectId, page, en, de, member, create, read, summarize };
}

describe("block and repeatable item titles", () => {
  it("are evaluated from their templates and returned beside their Summaries", async () => {
    const f = await fixture();
    const block = await f.create("faq", {
      headline: "Shipping",
      questions: [{ question: "How long?", answer: "Two days" }],
    });

    const view = await f.read(block.id);
    expect(view.block).toMatchObject({ title: "Shipping (FAQ)", summary: "" });
    expect(view.repeatableItems).toEqual([
      expect.objectContaining({ title: "Q: How long?", summary: "" }),
    ]);

    await f.summarize("block", block.id, "Shipping questions");
    await f.summarize("repeatableItem", view.repeatableItems[0]!.id, "Delivery time");
    const summarized = await f.read(block.id);
    expect(summarized.block).toMatchObject({
      title: "Shipping (FAQ)",
      summary: "Shipping questions",
    });
    expect(summarized.repeatableItems[0]).toMatchObject({
      title: "Q: How long?",
      summary: "Delivery time",
    });
  });

  it("name blocks and items in a publish preview until they have a Summary", async () => {
    const f = await fixture();
    const block = await f.create("faq", {
      headline: "Shipping",
      questions: [{ question: "How long?", answer: "Two days" }],
    });
    const plain = await f.create("plain", { text: "Hello" });
    const item = (await f.read(block.id)).repeatableItems[0]!;
    const preview = () =>
      call(router.drafts.previewPublish, { projectId: f.projectId }, f.member(f.en));
    const labelOf = (changes: Awaited<ReturnType<typeof preview>>["changes"], id: string) =>
      changes.find((change) => change.id === id)?.label;

    const { changes } = await preview();
    expect(labelOf(changes, block.id)).toBe("Shipping (FAQ)");
    expect(labelOf(changes, item.id)).toBe("Q: How long?");
    // Without a title template, the definition's title names the block.
    expect(labelOf(changes, plain.id)).toBe("Plain");

    await f.summarize("block", block.id, "Shipping questions");
    await f.summarize("repeatableItem", item.id, "Delivery time");
    const summarized = (await preview()).changes;
    expect(labelOf(summarized, block.id)).toBe("Shipping questions");
    expect(labelOf(summarized, item.id)).toBe("Delivery time");
  });

  it("read as plain text, a link by its text", async () => {
    const f = await fixture();
    const block = await f.create("cta", { link: { text: "the docs", href: "/docs" } });

    expect((await f.read(block.id)).block.title).toBe("Go to the docs");
  });

  it("are empty for definitions without a title template", async () => {
    const f = await fixture();
    const block = await f.create("plain", { text: "Hello" });

    expect((await f.read(block.id)).block).toMatchObject({ title: "", summary: "" });
  });

  it("are the default locale's in every locale", async () => {
    const f = await fixture();
    const block = await f.create("faq", {
      headline: "Shipping",
      questions: [{ question: "How long?", answer: "Two days" }],
    });
    await call(
      router.locales.add,
      { projectId: f.projectId, tag: "de" },
      f.member({ ...f.en, [DRAFT_CREATE_HEADER]: "1" }),
    );
    const item = (await f.read(block.id)).repeatableItems[0]!;
    const updatedBlock = await call(
      router.blocks.updateContent,
      { id: block.id, content: { headline: "Versand" } },
      f.member(f.de),
    );
    const updatedItem = await call(
      router.repeatableItems.updateContent,
      { id: item.id, content: { question: "Wie lange?" } },
      f.member(f.de),
    );
    expect(updatedBlock).toMatchObject({ title: "Shipping (FAQ)" });
    expect(updatedItem).toMatchObject({ title: "Q: How long?" });

    const german = await f.read(block.id, f.de);
    expect(german.block.content.headline).toBe("Versand");
    expect(german.block.title).toBe("Shipping (FAQ)");
    expect(german.repeatableItems[0]).toMatchObject({ title: "Q: How long?" });
    const itemView = await call(router.repeatableItems.get, { id: item.id }, f.member(f.de));
    expect(itemView.item).toMatchObject({ title: "Q: How long?" });
  });
});
