import { setTimeout as sleep } from "node:timers/promises";

/**
 * Demo content for the playground's `articles` collection, seeded through the record
 * endpoints by the camox plugin's dev-only `afterSync` hook. Listed oldest first: the
 * first four are published in this order, the last one stays a draft.
 */
const DEMO_ARTICLES = [
  {
    title: "Why we moved our docs to plain Markdown",
    slug: "docs-in-plain-markdown",
    excerpt: "Fewer tools, faster reviews: what changed when our docs left the wiki.",
    body: "Our documentation used to live in a wiki that only half the team could edit. Moving it next to the code, as plain Markdown, meant every change went through review like any other pull request. Reviews got faster, broken links got caught in CI, and new contributors stopped asking where the docs were.",
  },
  {
    title: "A field guide to content modeling",
    slug: "content-modeling-field-guide",
    excerpt: "Start from the pages you need, then name the records they share.",
    body: "Good content models start from real pages, not from a database diagram. List the screens you need, mark the pieces that repeat across them, and give each repeated piece a name. Those names become your collections; everything else stays inside the page that owns it.",
  },
  {
    title: "Shipping a design system in six weeks",
    slug: "design-system-in-six-weeks",
    excerpt: "How a small team traded a component wishlist for a weekly release.",
    body: "We did not start with a grand inventory of components. Each week we picked the two components causing the most inconsistency, built them, and shipped them to one product team. After six weeks we had a small system that people actually used, and a backlog driven by real requests.",
  },
  {
    title: "Editing in context beats editing in forms",
    slug: "editing-in-context",
    excerpt: "Writers fix more typos when they can see the page they are changing.",
    body: "When editors change text directly on the page, they notice awkward line breaks, repeated words and headlines that are too long. Forms hide all of that. Inline editing is not only friendlier; it produces better copy because the reader's view is the editor's view.",
  },
  {
    title: "Notes on our next release (draft)",
    slug: "next-release-notes",
    excerpt: "Unpublished: a draft that only shows up in preview.",
    body: "This article is intentionally left as a draft. It appears in Studio and in preview, and never on the live site until someone publishes it.",
  },
];
const PUBLISHED_COUNT = 4;
/** Publication times have millisecond precision; spacing keeps newest-first order stable. */
const PUBLICATION_GAP_MS = 10;

interface ArticlesScope {
  projectSlug: string;
  collectionId: string;
}

/** The record endpoints the seeder needs, as exposed by the plugin's authed API client. */
export interface DemoArticlesContext {
  projectSlug: string;
  logger: { info: (message: string) => void };
  client: {
    collectionDefinitions: {
      listRecords: (input: ArticlesScope) => Promise<readonly unknown[]>;
      createRecord: (
        input: ArticlesScope & { content: unknown },
      ) => Promise<{ id: string; version: number }>;
      publishRecord: (
        input: ArticlesScope & { id: string; expectedVersion: number },
      ) => Promise<unknown>;
    };
  };
}

/** Seeds the demo articles once: a collection that has any article is left alone. */
export async function seedDemoArticles({ client, projectSlug, logger }: DemoArticlesContext) {
  const scope = { projectSlug, collectionId: "articles" };
  const existing = await client.collectionDefinitions.listRecords(scope);
  if (existing.length > 0) return;

  const records = [];
  for (const article of DEMO_ARTICLES) {
    records.push(
      await client.collectionDefinitions.createRecord({
        ...scope,
        content: { ...article, cover: null },
      }),
    );
  }
  for (const [index, record] of records.slice(0, PUBLISHED_COUNT).entries()) {
    if (index > 0) await sleep(PUBLICATION_GAP_MS);
    await client.collectionDefinitions.publishRecord({
      ...scope,
      id: record.id,
      expectedVersion: record.version,
    });
  }

  const drafts = records.length - PUBLISHED_COUNT;
  logger.info(
    `[playground] Seeded ${records.length} demo articles (${PUBLISHED_COUNT} published, ${drafts} draft)`,
  );
}
