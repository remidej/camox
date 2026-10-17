import { generateUuidv7 } from "@camox/api-contract/ids";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture } from "../../../test/fixtures";
import { markdownToLexicalState } from "../../lib/lexical-state";
import { runService } from "../../lib/run-service";
import { blocks, pages } from "../../schema";
import { collectFileIds, pointersIn } from "./fields";
import { referencesTo } from "./references-to";

// `referencesTo` finds what uses a record or a file in SQL, without schemas, so it can scan a
// whole project at once. These tests hold it to the definition of pointers in `fields.ts`.

const schema = {
  properties: {
    author: { fieldType: "Reference", collectionId: "authors" },
    related: { fieldType: "ReferenceList", collectionId: "posts" },
    latest: { fieldType: "ReferenceList", collectionId: "posts", query: { limit: 3 } },
    cover: { fieldType: "Image" },
    attachments: { fieldType: "FileList" },
    body: { fieldType: "String" },
  },
};

async function fixture() {
  const base = await createProjectFixture(`references-to-${crypto.randomUUID()}`);
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const place = async (content: Record<string, unknown>) => {
    const block = await base.db
      .insert(blocks)
      .values({
        projectId: base.project.id,
        pageId: page.id,
        type: "post",
        content,
        position: `a${Math.random().toString(36).slice(2)}`,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { id: block.id, content };
  };
  const usesOf = async (target: { kind: "record" | "file"; id: string }) =>
    (
      await runService(referencesTo(base.db, { projectId: base.project.id, draft: null }, target))
    ).map((use) => use.id);
  return { place, usesOf, pageId: page.id };
}

describe("referencesTo agrees with the pointers fields define", () => {
  it("finds every block pointing at a record or a file", async () => {
    const f = await fixture();
    const [record, listed, file, attached] = [0, 1, 2, 3].map(() => generateUuidv7());
    const placed = [
      await f.place({ author: record }),
      await f.place({ related: [listed, record] }),
      await f.place({ cover: { _fileId: file } }),
      await f.place({ attachments: [{ _fileId: attached }, { _fileId: file }] }),
      await f.place({ body: JSON.stringify(markdownToLexicalState("Plain text")) }),
    ];

    for (const block of placed) {
      for (const { pointer } of pointersIn(schema, block.content)) {
        if (pointer.to === "page") continue;
        expect(await f.usesOf({ kind: pointer.to, id: pointer.id })).toContain(block.id);
      }
    }
    expect((await f.usesOf({ kind: "record", id: record })).sort()).toEqual(
      [placed[0].id, placed[1].id].sort(),
    );
    expect((await f.usesOf({ kind: "file", id: file })).sort()).toEqual(
      [placed[2].id, placed[3].id].sort(),
    );
  });

  it("matches a file wherever `collectFileIds` finds it, even in a field the definition lost", async () => {
    const f = await fixture();
    const [file, other] = [generateUuidv7(), generateUuidv7()];
    const contents = [
      { cover: { _fileId: file } },
      { removedGallery: [{ _fileId: file }] },
      { cover: { fileId: file, url: `/${file}.png` } },
      { cover: { _fileId: other } },
    ];
    const placed = await Promise.all(contents.map((content) => f.place(content)));
    const uses = await f.usesOf({ kind: "file", id: file });
    for (const block of placed) {
      const scanned = new Set<string>();
      collectFileIds(block.content, scanned);
      expect(uses.includes(block.id)).toBe(scanned.has(file));
    }
  });

  it("counts record ids stored where nothing points, so it may over-report and never under-reports", async () => {
    const f = await fixture();
    const record = generateUuidv7();
    // A query-backed list stores nothing it resolves, and a removed field is invisible, but
    // both may still hold an id from before: stored content outlives its definitions (ADR 0007).
    const stale = [await f.place({ latest: [record] }), await f.place({ removedAuthor: record })];
    for (const block of stale) expect(pointersIn(schema, block.content)).toEqual([]);
    expect((await f.usesOf({ kind: "record", id: record })).sort()).toEqual(
      stale.map((block) => block.id).sort(),
    );
  });
});
