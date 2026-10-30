import type { LinkFailure } from "@camox/api-contract/patrol";
import { isPrivateOrLocalHost } from "agents/webfetch";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { readInChunks } from "../content/chunks";
import { camoxContext } from "../drafts/camox-context";
import type { Draft } from "../drafts/scope";
import { changedLinks, type LinkInContent, liveLinks, missingPageLinks } from "./content";
import { dismissedIdentities, type RaisedFinding } from "./findings";
import type { Checker, LivePatrol } from "./patrollers";
import { linkChecks } from "./schema";

// The Link checker (ADR 0034) checks a draft at publish, in what the draft changed, and patrols
// every link on Live every 6 hours (`live-patrol.ts`). It raises:
// - links to missing pages, each with "Remove the link" as its fix.
// - links outside the website that fail: an HTTP error, no connection, or no answer in time. A
//   link is raised only once two checks in a row failed, so a site's blip raises nothing: in a
//   draft the second check follows shortly after the first, on Live it's the next run.
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
 * Checks each url once: reuses a check younger than `cacheMs`, unless it was a first failure,
 * which only a second fetch confirms, and keeps each one for the project.
 */
const checkUrls = Effect.fn("patrol.checkUrls")(function* (
  db: Database,
  projectId: number,
  urls: readonly string[],
  /** How long a check holds before the url is fetched again. */
  cacheMs: number,
) {
  const rows = yield* readInChunks(urls, (chunk) =>
    Effect.promise(() =>
      db
        .select()
        .from(linkChecks)
        .where(and(eq(linkChecks.projectId, projectId), inArray(linkChecks.url, chunk))),
    ),
  );
  const last = new Map(rows.map((row) => [row.url, row]));
  const now = Date.now();
  const checks = new Map<string, UrlCheck>();
  yield* Effect.forEach(
    urls,
    (url) =>
      Effect.gen(function* () {
        const previous = last.get(url);
        const fresh = previous !== undefined && now - previous.checkedAt < cacheMs;
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

/**
 * The failing links among `links` that failed twice in a row, as findings, and whether one failed
 * once. Dismissed urls aren't fetched.
 */
const brokenAmong = Effect.fn("patrol.brokenAmong")(function* (
  db: Database,
  projectId: number,
  links: readonly LinkInContent[],
  cacheMs: number,
) {
  const dismissed = yield* dismissedIdentities(db, projectId, "linkChecker");
  const fetched = links.flatMap((found) => {
    const url = fetchableUrl(found.link.url);
    return url === undefined || dismissed.has(found.link.url) ? [] : [{ ...found, url }];
  });
  const urls = [...new Set(fetched.map(({ url }) => url))];
  const checks = yield* checkUrls(db, projectId, urls, cacheMs);
  const found: RaisedFinding[] = [];
  for (const { holder, locale, field, link, url } of fetched) {
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

/** A link to a missing page, as a finding: removing the link fixes it. */
const missingPageFinding = (
  { holder, locale, field, link }: LinkInContent,
  page: string | null,
): RaisedFinding => ({
  entity: holder.entity,
  id: holder.id,
  locale,
  field: field.name,
  identity: link.url,
  about: { kind: "missingPage", url: link.url, text: link.text, page },
  fix: { kind: "removeLink" },
});

export const checkLinks: Checker = (db: Database, draft: Draft) =>
  Effect.gen(function* () {
    const missing = yield* missingPageLinks(camoxContext(db), draft);
    const changed = yield* changedLinks(camoxContext(db), draft);
    const broken = yield* brokenAmong(db, draft.projectId, changed, LINK_CACHE_MS);
    return {
      checked: "everything" as const,
      found: [...missing.map((link) => missingPageFinding(link, link.page)), ...broken.found],
      ...(broken.failedOnce && { recheckInMs: LINK_RECHECK_MS }),
    };
  });

/**
 * The Link checker's patrol of Live (ADR 0034): every link in Live's content, to pages Live is
 * missing and outside the website. Each url is fetched once per run, so a link that failed the
 * last run is raised when it fails this one too.
 */
export const patrolLinks: LivePatrol = (db: Database, projectId: number) =>
  Effect.gen(function* () {
    const links = yield* liveLinks(camoxContext(db), projectId);
    const missing = links.filter((link) => link.pageMissing);
    const broken = yield* brokenAmong(db, projectId, links, 0);
    return {
      found: [...missing.map((link) => missingPageFinding(link, null)), ...broken.found],
    };
  });
