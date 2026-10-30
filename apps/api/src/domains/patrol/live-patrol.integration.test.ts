import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7, PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
import type { FindingView, PatrollerView } from "@camox/api-contract/patrol";
import { call } from "@orpc/server";
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  seedLive,
} from "../../../test/fixtures";
import {
  forgetScheduledChecks,
  forgetScheduledPatrols,
  scheduledChecks,
  scheduledPatrols,
} from "../../../test/generation";
import { answerLink, linkFetches, outsideUrl } from "../../../test/link-fetches";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blockDefinitions, blocks, pages } from "../../schema";
import type { Bindings } from "../../types";
import worker from "../../worker";
import * as overlay from "../drafts/overlay";
import { RELEASE } from "../drafts/scope";
import { LIVE_PATROL_CRON } from "./live-patrol";

// The Link checker's patrol of Live (ADR 0034), through the cron entry: every 6 hours it checks
// every project's Live links, and the Patrol on Live says what it found.

type Headers = Record<string, string>;
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

const external = (href: string, text = "Visit") => ({ type: "external", text, href });

/**
 * Calls the cron entry as its 6-hourly trigger would, then runs the patrols it scheduled, as their
 * alarms would.
 */
async function patrolLive(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  await worker.scheduled(createScheduledController({ cron: LIVE_PATROL_CRON }), env as Bindings);
  const jobs = scheduledPatrols();
  forgetScheduledPatrols();
  for (const job of jobs) await runService(runAiJob(db, job));
}

/** A project with a footer block holding a Link field, and a home page, on Live. */
async function fixture() {
  const base = await createProjectFixture(`live-patrol-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await db.insert(blockDefinitions).values({
    projectId,
    blockId: "footer",
    title: "Footer",
    description: "",
    contentSchema: {
      type: "object",
      properties: {
        body: { type: "string", fieldType: "String", title: "Body" },
        link: {
          fieldType: "Link",
          title: "Link",
          type: "object",
          properties: {
            type: { type: "string", enum: ["external", "page"] },
            text: { type: "string" },
            href: { type: "string" },
            pageId: { type: "string" },
          },
          default: { type: "external", text: "", href: "" },
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const createPage = async (pathSegment: string) => {
    const { page } = await callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId, nickname: pathSegment || "Home" },
      member(),
    );
    // A manual meta title keeps its SEO out of publishing's checks.
    await callSeedingLive(router.pages.setSeo, { id: page.id, metaTitle: page.nickname }, member());
    return page;
  };
  const home = await createPage("");
  /** A footer on Live's home page, as a release writes it: publishing would check its links. */
  const liveFooter = (content: Record<string, unknown>) =>
    seedLive(db, blocks, {
      projectId,
      pageId: home.id,
      type: "footer",
      content,
      position: "b0",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  const linkChecker = async (headers: Headers = {}): Promise<PatrollerView> =>
    (await call(router.patrol.get, { projectId }, member(headers))).patrollers.find(
      (patroller) => patroller.id === "linkChecker",
    )!;
  const findings = async (headers: Headers = {}) => (await linkChecker(headers)).findings;
  const dismiss = (findingId: number, headers: Headers = {}) =>
    call(router.patrol.dismissFinding, { projectId, findingId }, member(headers));
  const publish = async (draftId: string) => {
    const input = { projectId };
    const { token } = await reviewed(
      db,
      draftId,
      call(router.drafts.previewPublish, input, member(inDraft(draftId))),
    );
    await call(router.drafts.publish, { ...input, token }, member(inDraft(draftId)));
  };
  /** Runs the checks scheduled for a draft, as their alarms would once it's idle. */
  const runChecksOf = async (draftId: string) => {
    const jobs = scheduledChecks(draftId);
    forgetScheduledChecks(draftId);
    for (const job of jobs) await runService(runAiJob(db, job));
  };
  return {
    ...base,
    projectId,
    member,
    runChecksOf,
    createPage,
    home,
    liveFooter,
    linkChecker,
    findings,
    dismiss,
    publish,
  };
}

/** What a finding says, in short. */
const said = (finding: FindingView) => ({
  subject: finding.subject.id,
  field: finding.field,
  about: finding.about,
  live: finding.live,
});

describe("the Link checker's patrol of Live", () => {
  it("raises a Live link that failed two runs in a row, and not after one", async () => {
    const f = await fixture();
    const url = outsideUrl("gone");
    await answerLink(url, { status: 404 });
    const footer = await f.liveFooter({ link: external(url) });

    await patrolLive(f.db);
    const once = await f.linkChecker();
    expect(once.findings).toEqual([]);
    expect(once.lastCheckedAt).not.toBeNull();

    await patrolLive(f.db);
    expect((await f.findings()).map(said)).toEqual([
      {
        subject: footer.id,
        field: "link",
        about: { kind: "brokenLink", url, text: "Visit", failure: { kind: "status", status: 404 } },
        live: true,
      },
    ]);
  });

  it("checks every project's Live links", async () => {
    const [first, second] = [await fixture(), await fixture()];
    const urls = [outsideUrl("first"), outsideUrl("second")];
    await answerLink(urls[0]!, { status: 500 });
    await answerLink(urls[1]!, { status: 502 });
    await first.liveFooter({ link: external(urls[0]!) });
    await second.liveFooter({ body: "Hello", link: external(urls[1]!) });

    await patrolLive(first.db);
    await patrolLive(first.db);

    expect((await first.findings()).map((finding) => finding.about)).toEqual([
      { kind: "brokenLink", url: urls[0], text: "Visit", failure: { kind: "status", status: 500 } },
    ]);
    expect((await second.findings()).map((finding) => finding.about)).toEqual([
      { kind: "brokenLink", url: urls[1], text: "Visit", failure: { kind: "status", status: 502 } },
    ]);
  });

  it("raises nothing for a link whose failures aren't in a row", async () => {
    const f = await fixture();
    const url = outsideUrl("blip");
    await answerLink(url, { status: 503 }, { status: 200 }, { status: 503 });
    await f.liveFooter({ link: external(url) });

    await patrolLive(f.db);
    await patrolLive(f.db);
    await patrolLive(f.db);

    expect(await linkFetches(url)).toEqual(["HEAD", "HEAD", "HEAD"]);
    expect(await f.findings()).toEqual([]);
  });

  it("raises Live links to pages Live doesn't have on the first run, with removing the link as their fix", async () => {
    const f = await fixture();
    const about = await f.createPage("about");
    const footer = await f.liveFooter({ link: { type: "page", text: "About", pageId: about.id } });
    // Live loses the page without a draft: no publish deletes a page Live links to, a release does.
    await runService(overlay.remove(f.db, RELEASE, pages, about.id));

    await patrolLive(f.db);

    const found = await f.findings();
    expect(found.map(said)).toEqual([
      {
        subject: footer.id,
        field: "link",
        about: {
          kind: "missingPage",
          url: `${PAGE_TEXT_LINK_PREFIX}${about.id}`,
          text: "About",
          page: null,
        },
        live: true,
      },
    ]);
    expect(found[0]!.fix).toEqual({ kind: "removeLink" });
  });
});

describe("Live's findings", () => {
  /** A Live footer linking to a url that fails, raised by two runs. */
  async function raised() {
    const f = await fixture();
    const url = outsideUrl("down");
    await answerLink(url, { status: 404 });
    const footer = await f.liveFooter({ link: external(url) });
    await patrolLive(f.db);
    await patrolLive(f.db);
    expect(await f.findings()).toHaveLength(1);
    return { f, url, footer };
  }

  it("close once a later run finds the link working", async () => {
    const { f, url } = await raised();

    await answerLink(url, { status: 200 });
    await patrolLive(f.db);

    expect(await f.findings()).toEqual([]);
  });

  it("close once a publish took the link off Live", async () => {
    const { f, footer } = await raised();
    const draft = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: footer.id, content: { link: external("") } },
      f.member(startingDraft(draft)),
    );
    await f.publish(draft);

    await patrolLive(f.db);

    expect(await f.findings()).toEqual([]);
  });

  it("stay as they were when a run finds nothing new, which only changes when it last checked", async () => {
    const { f } = await raised();
    const before = await f.linkChecker();
    // Lets the clock move past the last run's check.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const startedAt = Date.now();

    await patrolLive(f.db);

    const after = await f.linkChecker();
    expect(after.findings).toEqual(before.findings);
    expect(after.reports).toEqual(before.reports);
    expect(before.lastCheckedAt).toBeLessThan(startedAt);
    expect(after.lastCheckedAt).toBeGreaterThanOrEqual(startedAt);
    // What the Patrol shows of it: when the Link checker was last at work.
    expect(after.lastActivityAt).toBeGreaterThanOrEqual(startedAt);
  });

  it("are never raised for a url the project dismissed, even in a draft since deleted", async () => {
    const f = await fixture();
    const url = outsideUrl("crawlers-unwelcome");
    await answerLink(url, { status: 403 });
    const draft = generateUuidv7();
    await call(
      router.blocks.create,
      { pageId: f.home.id, type: "footer", content: { link: external(url) } },
      f.member(startingDraft(draft)),
    );
    for (let check = 0; check < 2; check++) await f.runChecksOf(draft);
    const [inDraftFinding] = await f.findings(inDraft(draft));
    await f.dismiss(inDraftFinding!.id, inDraft(draft));
    await call(router.drafts.delete, { projectId: f.projectId }, f.member(inDraft(draft)));
    await f.liveFooter({ link: external(url) });
    const fetchedBefore = (await linkFetches(url)).length;

    await patrolLive(f.db);
    await patrolLive(f.db);

    expect(await f.findings()).toEqual([]);
    expect(await linkFetches(url)).toHaveLength(fetchedBefore);
  });

  it("are dismissed on Live for good", async () => {
    const { f } = await raised();
    const [finding] = await f.findings();

    await f.dismiss(finding!.id);
    await patrolLive(f.db);

    expect(await f.findings()).toEqual([]);
    expect((await f.linkChecker()).dismissals).toHaveLength(1);
  });
});
