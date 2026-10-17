import assert from "node:assert/strict";
import { test } from "node:test";

import { inScope, queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import { seedBlockCaches } from "./normalized-data";

type PageData = Parameters<typeof seedBlockCaches>[1];

function file(id: string) {
  return { id, url: `https://cdn.test/${id}.png`, alt: "", filename: `${id}.png` };
}

function record(id: string, content: Record<string, unknown>, references?: unknown) {
  return { id, collectionId: "authors", label: id, content, references };
}

/** A page with one block whose reference links a record, which links another in turn. */
function pageWithLinkedRecords(): PageData {
  const nested = record("team", { logo: { _fileId: "team-logo" } });
  const author = record("ada", { portrait: { _fileId: "portrait" } }, { team: nested });
  return {
    blocks: [
      {
        id: "block-1",
        type: "quote",
        content: { photo: { _fileId: "block-photo" } },
        settings: {},
        position: "a",
        references: { author },
      },
    ],
    repeatableItems: [
      {
        id: "item-1",
        blockId: "block-1",
        content: {},
        settings: {},
        position: "a",
        references: { authors: [record("grace", { portrait: { _fileId: "item-portrait" } })] },
      },
    ],
    files: ["block-photo", "portrait", "team-logo", "item-portrait", "unused"].map(file),
  } as unknown as PageData;
}

const seededFileIds = (queryClient: QueryClient, draftId: string | null) =>
  (
    queryClient.getQueryData(inScope(queryKeys.blocks.get("block-1"), draftId)) as {
      files: { id: string }[];
    }
  ).files
    .map((f) => f.id)
    .sort();

void test("a seeded block bundle holds the files of the records its block and items link", () => {
  const queryClient = new QueryClient();
  seedBlockCaches(queryClient, pageWithLinkedRecords(), null);

  assert.deepEqual(seededFileIds(queryClient, null), [
    "block-photo",
    "item-portrait",
    "portrait",
    "team-logo",
  ]);
  assert.ok(queryClient.getQueryData(inScope(queryKeys.files.get("team-logo"), null)));
});

void test("seeding caches a draft's read under that draft's keys, not Live's", () => {
  const queryClient = new QueryClient();
  seedBlockCaches(queryClient, pageWithLinkedRecords(), "draft-1");

  assert.equal(seededFileIds(queryClient, "draft-1").length, 4);
  assert.equal(queryClient.getQueryData(inScope(queryKeys.blocks.get("block-1"), null)), undefined);
});
