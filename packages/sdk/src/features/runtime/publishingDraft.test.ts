import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRAFT_HEADER,
  PUBLISHING_DRAFT_HEADER,
  PUBLISHING_DRAFT_VAR,
} from "@camox/api-contract/drafts";

import { createServerApiClient } from "../routes/pageRuntime";
import { rememberPublishingDraft } from "./publishingDraft";

// A Worker version a publish with code uploaded names its draft on its reads of the API, so they
// see Live overlaid with it while it publishes (spec #560, section 13).

const PUBLISHING = "019a0000-0000-7000-8000-000000000077";
const PREVIEWED = "019a0000-0000-7000-8000-000000000078";

/** The headers of the API requests `read` sends. */
async function headersSent(t: { after(fn: () => void): void }, read: () => Promise<unknown>) {
  const sent: Headers[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (request: Request) => {
    sent.push(new Headers(request.headers));
    return Response.json({ json: { name: "Acme" } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  await read().catch(() => undefined);
  return sent;
}

void test("a Live read of a publishing version names the draft it publishes", async (t) => {
  rememberPublishingDraft({ [PUBLISHING_DRAFT_VAR]: PUBLISHING });
  const [headers] = await headersSent(t, () =>
    createServerApiClient("https://api.camox.test").projects.getSummary({ projectUuid: "p" }),
  );
  assert.equal(headers?.get(PUBLISHING_DRAFT_HEADER), PUBLISHING);
  assert.equal(headers?.get(DRAFT_HEADER), null);
});

void test("a member's read of a draft names only that draft", async (t) => {
  rememberPublishingDraft({ [PUBLISHING_DRAFT_VAR]: PUBLISHING });
  const [headers] = await headersSent(t, () =>
    createServerApiClient("https://api.camox.test", {
      draftId: PREVIEWED,
      authCookieHeader: "better-auth.session_token=s",
    }).projects.getSummary({ projectUuid: "p" }),
  );
  assert.equal(headers?.get(DRAFT_HEADER), PREVIEWED);
  assert.equal(headers?.get(PUBLISHING_DRAFT_HEADER), null);
});
