import assert from "node:assert/strict";
import { test } from "node:test";

import { seedDemoArticles } from "./demoArticles.ts";

interface FakeRecord {
  id: string;
  version: number;
  collectionId: string;
  content: Record<string, unknown>;
  publishedAt: number | null;
}

/** An in-memory articles collection behind the record endpoints the seeder uses. */
function fakeApi() {
  const records: FakeRecord[] = [];
  const logs: string[] = [];
  const find = (id: string, expectedVersion: number) => {
    const record = records.find((candidate) => candidate.id === id);
    assert.ok(record, `unknown record ${id}`);
    assert.equal(record.version, expectedVersion, "stale expectedVersion");
    return record;
  };
  const context = {
    projectSlug: "camox-playground-01",
    logger: { info: (message: string) => logs.push(message) },
    client: {
      collectionDefinitions: {
        listRecords: async (input: { projectSlug: string; collectionId: string }) =>
          records.filter((record) => record.collectionId === input.collectionId),
        createRecord: async (input: {
          projectSlug: string;
          collectionId: string;
          content: unknown;
        }) => {
          const record: FakeRecord = {
            id: crypto.randomUUID(),
            version: 1,
            collectionId: input.collectionId,
            content: input.content as Record<string, unknown>,
            publishedAt: null,
          };
          records.push(record);
          return { id: record.id, version: record.version };
        },
        publishRecord: async (input: {
          projectSlug: string;
          collectionId: string;
          id: string;
          expectedVersion: number;
        }) => {
          const record = find(input.id, input.expectedVersion);
          record.version++;
          record.publishedAt ??= performance.now();
          return { record };
        },
      },
    },
  };
  return { records, logs, context };
}

void test("an empty articles collection gets four published articles and one draft", async () => {
  const { records, logs, context } = fakeApi();

  await seedDemoArticles(context);

  assert.equal(records.length, 5);
  assert.ok(records.every((record) => record.collectionId === "articles"));
  assert.equal(records.filter((record) => record.publishedAt !== null).length, 4);
  for (const field of ["title", "slug", "excerpt", "body"]) {
    const values = records.map((record) => record.content[field]);
    assert.ok(
      values.every((value) => typeof value === "string" && value.length > 0),
      `${field} is set`,
    );
    assert.equal(new Set(values).size, 5, `${field} values are distinct`);
  }
  for (const record of records) {
    assert.match(record.content.slug as string, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(record.content.cover, null);
  }
  assert.match(logs.join("\n"), /4 published, 1 draft/);
});

void test("seeded articles are published at distinct moments, so newest-first order is stable", async () => {
  const { records, context } = fakeApi();

  await seedDemoArticles(context);

  const published = records
    .flatMap((record) => (record.publishedAt === null ? [] : [record.publishedAt]))
    .sort((a, b) => a - b);
  const gaps = published.slice(1).map((at, index) => at - published[index]!);
  assert.ok(
    gaps.every((gap) => gap >= 2),
    `publications are at least 2 ms apart: ${gaps.join(", ")}`,
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
    projectSlug: context.projectSlug,
    collectionId: "articles",
    content: { title: "My own article" },
  });

  await seedDemoArticles(context);

  assert.equal(records.length, 1);
});
