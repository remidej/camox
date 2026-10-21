import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger } from "vite-plus";

import type { ServerApiClient } from "../../lib/api-client-server";
import { publishSeededContent } from "./publishSeededContent";

// Dev mode publishes the content it seeded into the development draft. In a project with more
// than one locale, the seeded content is still being translated when it's published.

void test("publishes seeded content while its translations still run", async () => {
  const published: unknown[] = [];
  const preview = {
    blockers: [],
    conflicts: [],
    lost: [],
    warnings: [],
    changes: [{ entity: "block", id: "block-1", change: "created" }],
    translating: ["de"],
    defaultLocale: "en",
    token: "token",
  };
  const client = {
    projects: { getBySlug: async () => ({ id: 7 }) },
    drafts: {
      previewPublish: async () => preview,
      // Like the API: publishing waits for translations unless it's asked to publish anyway.
      publish: async (input: { publishAnyway?: boolean }) => {
        if (preview.translating.length > 0 && !input.publishAnyway) {
          throw new Error("TRANSLATIONS_PENDING");
        }
        published.push(input);
        return { empty: false, ended: null };
      },
    },
  } as unknown as ServerApiClient;

  await publishSeededContent({
    client,
    projectUuid: "test",
    logger: createLogger("silent"),
  });

  assert.equal(published.length, 1);
});
