import assert from "node:assert/strict";
import { test } from "node:test";

import { seedDemoArticles } from "./demoArticles.ts";

interface FakeRecord {
  id: string;
  collectionId: string;
  content: Record<string, unknown>;
  createdAt: number;
}

/** An in-memory articles collection behind the record endpoints the seeder uses. */
function fakeApi() {
  const records: FakeRecord[] = [];
  const logs: string[] = [];
  const context = {
    projectUuid: "camox-playground-01",
    logger: { info: (message: string) => logs.push(message) },
    client: {
      collectionDefinitions: {
        listRecords: async (input: { projectUuid: string; collectionId: string }) =>
          records.filter((record) => record.collectionId === input.collectionId),
        createRecord: async (input: {
          projectUuid: string;
          collectionId: string;
          content: unknown;
        }) => {
          const record: FakeRecord = {
            id: crypto.randomUUID(),
            collectionId: input.collectionId,
            content: input.content as Record<string, unknown>,
            createdAt: performance.now(),
          };
          records.push(record);
          return { id: record.id };
        },
      },
    },
  };
  return { records, logs, context };
}

void test("an empty articles collection gets four articles", async () => {
  const { records, logs, context } = fakeApi();

  await seedDemoArticles(context);

  assert.equal(records.length, 4);
  assert.ok(records.every((record) => record.collectionId === "articles"));
  for (const field of ["title", "slug", "excerpt", "body"]) {
    const values = records.map((record) => record.content[field]);
    assert.ok(
      values.every((value) => typeof value === "string" && value.length > 0),
      `${field} is set`,
    );
    assert.equal(new Set(values).size, 4, `${field} values are distinct`);
  }
  for (const record of records) {
    assert.match(record.content.slug as string, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(record.content.cover, null);
  }
  assert.match(logs.join("\n"), /Seeded 4 demo articles/);
});

void test("seeded articles are created at distinct moments, so newest-first order is stable", async () => {
  const { records, context } = fakeApi();

  await seedDemoArticles(context);

  const created = records.map((record) => record.createdAt).sort((a, b) => a - b);
  const gaps = created.slice(1).map((at, index) => at - created[index]!);
  assert.ok(
    gaps.every((gap) => gap >= 2),
    `creations are at least 2 ms apart: ${gaps.join(", ")}`,
  );
});

void test("seeding again leaves existing articles untouched", async () => {
  const { records, logs, context } = fakeApi();
  await seedDemoArticles(context);
  const before = structuredClone(records);
  logs.length = 0;

  await seedDemoArticles(context);

  assert.deepEqual(records, before);
  assert.deepEqual(logs, []);
});

void test("a collection with any article, even a user-created one, is not seeded", async () => {
  const { records, context } = fakeApi();
  await context.client.collectionDefinitions.createRecord({
    projectUuid: context.projectUuid,
    collectionId: "articles",
    content: { title: "My own article" },
  });

  await seedDemoArticles(context);

  assert.equal(records.length, 1);
});
