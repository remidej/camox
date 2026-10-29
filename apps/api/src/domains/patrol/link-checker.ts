import type { LinkFailure } from "@camox/api-contract/patrol";
import { isPrivateOrLocalHost } from "agents/webfetch";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { camoxContext } from "../drafts/camox-context";
import { changedLinks, missingPageLinks } from "../drafts/content-checks";
import type { Draft } from "../drafts/scope";
import { dismissedIdentities, type RaisedFinding } from "./findings";
import type { Checker } from "./patrollers";
import { linkChecks } from "./schema";

// The Link checker's check of a draft (ADR 0034), in what the draft changed:
// - links to pages the draft is missing, each with "Remove the link" as its fix.
// - links outside the website that fail: an HTTP error, no connection, or no answer in time. A
//   link is raised only once two checks in a row failed, the second shortly after the first, so
//   a site's blip raises nothing.
// A finding's identity is the link's url, project-wide.

/** How soon a link that failed once is checked again. */
export const LINK_RECHECK_MS = 20_000;

/** How long a url's check holds before it's fetched again, so one used everywhere is fetched once. */
const LINK_CACHE_MS = 10 * 60_000;

/** How long a url has to answer, redirects included. */
const LINK_TIMEOUT_MS = 10_000;

const MAX_REDIRECTS = 5;

/** How many urls are fetched at once. */
const CONCURRENT_FETCHES = 6;

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;

/** Checks in a row a link fails before it's raised. */
const FAILURES_TO_RAISE = 2;

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; Camox Link checker; +https://camox.ai)",
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
};

/** A link's url, when it leads outside the website over HTTP(S): what the Link checker fetches. */
function fetchableUrl(url: string) {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : undefined;
}

/**
 * Fetches a url as a visitor would reach it: HEAD first, GET when HEAD isn't allowed, following
 * redirects. Never reaches a private or local address. Null when it answers without an error.
 */
async function fetchLink(start: string): Promise<LinkFailure | null> {
  const signal = AbortSignal.timeout(LINK_TIMEOUT_MS);
  const request = async (url: URL, method: "HEAD" | "GET") => {
    const response = await fetch(url, { method, headers: HEADERS, redirect: "manual", signal });
    await response.body?.cancel();
    return response;
  };
  try {
    let url = new URL(start);
    for (let redirects = 0; ; redirects++) {
      if (isPrivateOrLocalHost(url.hostname)) return { kind: "unreachable" };
      let response = await request(url, "HEAD");
      if (response.status === 405 || response.status === 501) response = await request(url, "GET");
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (redirects === MAX_REDIRECTS) return { kind: "unreachable" };
        url = new URL(location, url);
        continue;
      }
      return response.status >= 400 ? { kind: "status", status: response.status } : null;
    }
  } catch {
    return signal.aborted ? { kind: "timeout" } : { kind: "unreachable" };
  }
}

/** A url's last check: how it failed, if it did, and how many checks in a row failed. */
type UrlCheck = { failure: LinkFailure | null; failures: number };

/**
 * Checks each url once: reuses a check made a moment ago, unless it was a first failure, which
 * only a second fetch confirms, and keeps each one for the project.
 */
const checkUrls = Effect.fn("patrol.checkUrls")(function* (
  db: Database,
  projectId: number,
  urls: readonly string[],
) {
  const last = new Map<string, typeof linkChecks.$inferSelect>();
  for (let start = 0; start < urls.length; start += CHUNK) {
    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(linkChecks)
        .where(
          and(
            eq(linkChecks.projectId, projectId),
            inArray(linkChecks.url, urls.slice(start, start + CHUNK)),
          ),
        ),
    );
    for (const row of rows) last.set(row.url, row);
  }
  const now = Date.now();
  const checks = new Map<string, UrlCheck>();
  yield* Effect.forEach(
    urls,
    (url) =>
      Effect.gen(function* () {
        const previous = last.get(url);
        const fresh = previous !== undefined && now - previous.checkedAt < LINK_CACHE_MS;
        if (fresh && previous.failures !== 1) {
          checks.set(url, { failure: previous.failure, failures: previous.failures });
          return;
        }
        const failure = yield* Effect.promise(() => fetchLink(url));
        const failures = failure === null ? 0 : (previous?.failures ?? 0) + 1;
        checks.set(url, { failure, failures });
        const checkedAt = Date.now();
        yield* Effect.promise(() =>
          db
            .insert(linkChecks)
            .values({ projectId, url, failure, failures, checkedAt })
            .onConflictDoUpdate({
              target: [linkChecks.projectId, linkChecks.url],
              set: { failure, failures, checkedAt },
            }),
        );
      }),
    { concurrency: CONCURRENT_FETCHES, discard: true },
  );
  return checks;
});

/** Links outside the website the draft changed that failed twice in a row, and whether one failed once. */
const brokenLinks = Effect.fn("patrol.brokenLinks")(function* (db: Database, draft: Draft) {
  const dismissed = yield* dismissedIdentities(db, draft.projectId, { id: "linkChecker" });
  const links = (yield* changedLinks(camoxContext(db), draft)).flatMap((found) => {
    const url = fetchableUrl(found.link.url);
    return url === undefined || dismissed.has(found.link.url) ? [] : [{ ...found, url }];
  });
  const checks = yield* checkUrls(db, draft.projectId, [...new Set(links.map(({ url }) => url))]);
  const found: RaisedFinding[] = [];
  for (const { holder, locale, field, link, url } of links) {
    const check = checks.get(url)!;
    if (check.failure === null || check.failures < FAILURES_TO_RAISE) continue;
    found.push({
      entity: holder.entity,
      id: holder.id,
      locale,
      field: field.name,
      identity: link.url,
      about: { kind: "brokenLink", url: link.url, text: link.text, failure: check.failure },
      fix: null,
    });
  }
  const failedOnce = [...checks.values()].some((check) => check.failures === 1);
  return { found, failedOnce };
});

export const checkLinks: Checker = (db: Database, draft: Draft) =>
  Effect.gen(function* () {
    const missing = yield* missingPageLinks(camoxContext(db), draft);
    const broken = yield* brokenLinks(db, draft);
    return {
      checked: "everything" as const,
      found: [
        ...missing.map(({ holder, locale, field, link, page }): RaisedFinding => ({
          entity: holder.entity,
          id: holder.id,
          locale,
          field: field.name,
          identity: link.url,
          about: { kind: "missingPage", url: link.url, text: link.text, page },
          fix: { kind: "removeLink" },
        })),
        ...broken.found,
      ],
      ...(broken.failedOnce && { recheckInMs: LINK_RECHECK_MS }),
    };
  });
