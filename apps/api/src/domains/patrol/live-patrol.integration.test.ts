import { CAMOX_ACTOR, DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7, PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
import type { FindingView, PatrollerView } from "@camox/api-contract/patrol";
import { call } from "@orpc/server";
import { abortAllDurableObjects, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { emailsTo } from "../../../test/emails";
import {
  addMember,
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  runAllChecks,
  seedLive,
} from "../../../test/fixtures";
import {
  answerEvery,
  forgetScheduledChecks,
  forgetScheduledPatrols,
  scheduledChecks,
  scheduledPatrols,
} from "../../../test/generation";
import { answerLink, linkFetches, outsideUrl } from "../../../test/link-fetches";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  forgetThreadModel,
  threadModelCalls,
} from "../../../test/thread-model";
import { connectDraftThread, said as saidIn, signIn, threadIdOf } from "../../../test/threads";
import app from "../../index";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blockDefinitions, blocks, member, pages } from "../../schema";
import type { Bindings } from "../../types";
import worker from "../../worker";
import * as overlay from "../drafts/overlay";
import { RELEASE } from "../drafts/scope";
import { LIVE_PATROL_CRON } from "./live-patrol";

// The Link checker's patrol of Live (ADR 0034), through the cron entry: every 6 hours it checks
// every project's Live links, and the Patrol on Live says what it found.

// The Patrol Draft's agent runs on pi-ai's fake provider, scripted per test.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

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
  /** A footer on Live linking to a page Live no longer has, as a release leaves it. */
  const goneLink = async (pathSegment: string, text: string) => {
    const page = await createPage(pathSegment);
    const footer = await liveFooter({ link: { type: "page", text, pageId: page.id } });
    await runService(overlay.remove(db, RELEASE, pages, page.id));
    return footer;
  };
  const drafts = async () =>
    (await call(router.drafts.list, { projectId }, member())).drafts.map((draft) => ({
      id: draft.id,
      name: draft.name,
      createdBy: draft.createdBy,
    }));
  /** Connects to a draft's thread as the member, once its agent is done with `messages`. */
  const threadOf = async (draftId: string, messages: number) => {
    const thread = await connectDraftThread(projectId, draftId, await signIn(db, memberUser.id));
    await thread.untilIdle(messages);
    return thread;
  };
  /** Calls one of Camox's agent's tools as the member, in `headers`' scope. */
  const tool = async (name: string, args: unknown, headers: Headers = {}) => {
    const response = (await call(
      router.agent.callTool,
      { projectId, name, arguments: args },
      member(headers),
    )) as { ok: true; result: any } | { ok: false; error: unknown };
    if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  return {
    ...base,
    projectId,
    member,
    goneLink,
    drafts,
    threadOf,
    tool,
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

describe("the Patrol Draft", () => {
  const PATROL_DRAFT = { name: "Patrol", createdBy: { id: CAMOX_ACTOR, name: "Camox" } };

  it("opens when a Live run raises new findings, started by Camox, its thread opening with a Brief that lists them", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerNext("I'll look into it.");

    await patrolLive(f.db);

    const drafts = await f.drafts();
    expect(drafts).toEqual([{ id: expect.any(String), ...PATROL_DRAFT }]);
    const [brief, answer] = saidIn((await f.threadOf(drafts[0]!.id, 2)).view());
    // The footer, as the Patrol names it.
    const [{ subject }] = (await f.findings()) as [FindingView];
    expect(brief).toEqual({
      from: "camox",
      text: expect.stringContaining(
        `“About us” in ${subject.name} links to a page that no longer exists`,
      ),
    });
    expect(answer).toEqual({ from: "agent", text: "I'll look into it." });
  });

  it("takes a later run's new findings into its thread, and no second one opens", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    const [draft] = await f.drafts();
    (await f.threadOf(draft!.id, 2)).close();

    await f.goneLink("team", "Our team");
    answerNext("On that one too.");
    await patrolLive(f.db);

    expect(await f.drafts()).toEqual([draft]);
    const messages = saidIn((await f.threadOf(draft!.id, 4)).view());
    const [, { subject }] = (await f.findings()) as [FindingView, FindingView];
    expect(messages.slice(2)).toEqual([
      {
        from: "camox",
        text: expect.stringContaining(
          `“Our team” in ${subject.name} links to a page that no longer exists`,
        ),
      },
      { from: "agent", text: "On that one too." },
    ]);
    expect(messages[2]).not.toEqual({ from: "camox", text: expect.stringContaining("About us") });
  });

  it("isn't opened or told anything by a run that raises nothing new", async () => {
    const f = await fixture();
    await f.liveFooter({ link: external(outsideUrl("fine")) });
    await patrolLive(f.db);
    expect(await f.drafts()).toEqual([]);

    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    const [draft] = await f.drafts();
    (await f.threadOf(draft!.id, 2)).close();
    const calls = threadModelCalls();

    await patrolLive(f.db);

    expect(await f.drafts()).toEqual([draft]);
    expect(saidIn((await f.threadOf(draft!.id, 2)).view())).toHaveLength(2);
    expect(threadModelCalls()).toBe(calls);
  });

  it("has its agent, acting for Camox, apply Live's suggested fixes in the draft, leaving Live as it is", async () => {
    const f = await fixture();
    const footer = await f.goneLink("about", "About us");
    answerWithScript(`
      const { findings } = await tools.listFindings({});
      for (const finding of findings) {
        if (finding.fix) await tools.applyFindingFix({ findingId: finding.id });
      }
      text(findings.map((finding) => finding.about.text).join(", "));
    `);
    answerFrom(({ scriptOutput }) => `Fixed: ${scriptOutput}`);

    await patrolLive(f.db);

    const [draft] = await f.drafts();
    const [, answer] = saidIn((await f.threadOf(draft!.id, 2)).view());
    expect(answer).toEqual({ from: "agent", text: "Fixed: About us" });
    const linkIn = async (headers: Headers) =>
      (await f.tool("getBlock", { id: footer.id }, headers)).block.content.link;
    expect(await linkIn(inDraft(draft!.id))).toEqual({
      type: "external",
      href: "",
      text: "About us",
    });
    expect(await linkIn({})).toEqual(expect.objectContaining({ type: "page", text: "About us" }));
    // What's fixed in the draft is no longer listed there, though Live still has it till published.
    expect((await f.tool("listFindings", {}, inDraft(draft!.id))).findings).toEqual([]);
    expect(await f.findings()).toHaveLength(1);
  });

  it("has the Link checker report a broken Live link its agent leads elsewhere as fixed there", async () => {
    const f = await fixture();
    const url = outsideUrl("moved");
    await answerLink(url, { status: 404 });
    const footer = await f.liveFooter({ link: external(url, "Partners") });
    // The link's first failure raises nothing yet.
    await patrolLive(f.db);
    const link = external(outsideUrl("new-home"), "Partners");
    answerWithScript(
      `await tools.editBlock({ id: ${JSON.stringify(footer.id)}, content: { link: ${JSON.stringify(link)} } });`,
    );
    answerNext("Partners moved: I pointed the link to its new address.");

    await patrolLive(f.db);

    const [draft] = await f.drafts();
    await (await f.threadOf(draft!.id, 2)).close();
    const { reports } = await f.linkChecker(inDraft(draft!.id));
    expect(reports.map(({ summary }) => summary.kind === "structured" && summary.verb)).toEqual([
      "fixedLink",
    ]);
  });

  it("is never published by Camox, even once its checks settle with nothing to hold it", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerWithScript(`
      const { findings } = await tools.listFindings({});
      for (const finding of findings) await tools.applyFindingFix({ findingId: finding.id });
    `);
    answerNext("Fixed.");
    await patrolLive(f.db);
    const [draft] = await f.drafts();
    (await f.threadOf(draft!.id, 2)).close();

    await runAllChecks(f.db);

    expect(await f.drafts()).toEqual([draft]);
  });

  it("is where Live's findings lead from the Patrol", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    const [draft] = await f.drafts();

    const view = await call(router.patrol.get, { projectId: f.projectId }, f.member());

    expect(view.patrolDraft).toEqual({ id: draft!.id, name: "Patrol" });
  });
});

describe("the email about Live's new findings", () => {
  it("goes to each member once a run raises new findings, listing them, saying how many need a person, and linking to the Patrol Draft", async () => {
    const f = await fixture();
    const teammate = await addMember(f.db, f.project.organizationId);
    const url = outsideUrl("moved");
    await answerLink(url, { status: 404 });
    await f.liveFooter({ link: external(url, "Partners") });
    // The link's first failure raises nothing yet: nothing to tell.
    await patrolLive(f.db);
    expect(await emailsTo(f.memberUser.email)).toEqual([]);

    await f.goneLink("about", "About us");
    await f.goneLink("team", "Our team");
    // The agent applies the fixes it's handed: the broken link has none, so it's left for a person.
    answerWithScript(`
      const { findings } = await tools.listFindings({});
      for (const finding of findings) {
        if (finding.fix) await tools.applyFindingFix({ findingId: finding.id });
      }
    `);
    answerNext("I removed the links to missing pages. Where does Partners lead now?");
    await patrolLive(f.db);

    const [draft] = await f.drafts();
    const studioLink = `https://${f.project.slug}.camox.site/?camox-draft=${draft!.id}`;
    for (const address of [f.memberUser.email, teammate.email]) {
      const emails = await emailsTo(address);
      expect(emails).toHaveLength(1);
      const [{ subject, text, html }] = emails as [(typeof emails)[number]];
      expect(subject).toBe("The Link checker found 3 new problems on Test project");
      expect(text).toContain("“About us” in footer links to a page that no longer exists");
      expect(text).toContain(
        `“Partners” in footer links to ${url}, which answers with an error (404)`,
      );
      expect(text).toContain("Camox's agent fixed 2 in the Patrol Draft. 1 needs you");
      expect(text).toContain(studioLink);
      expect(html).toContain(studioLink);
    }
    expect(await emailsTo(f.outsiderUser.email)).toEqual([]);
  });

  it("says each finding needs a person when the agent's turn fixed none", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    await f.goneLink("team", "Our team");
    answerNext("Which pages should these lead to now?");

    await patrolLive(f.db);

    const [email] = await emailsTo(f.memberUser.email);
    expect(email!.text).toContain(
      "Camox's agent couldn't fix them in the Patrol Draft. 2 need you",
    );
  });

  it("is one per run, whichever patrollers found something new", async () => {
    const f = await fixture();
    answerEvery("proofread", ({ texts }) =>
      texts.flatMap(({ key, text }) =>
        text.includes("recieve")
          ? [{ key, kind: "misspelling" as const, original: "recieve", replacement: "receive" }]
          : [],
      ),
    );
    await f.liveFooter({ body: "We recieve every letter." });
    await f.goneLink("about", "About us");
    answerNext("On it.");

    // The Proofreader arrives in the project on its first run, beside the Link checker.
    await patrolLive(f.db);

    const emails = await emailsTo(f.memberUser.email);
    expect(emails.map((email) => email.subject)).toEqual([
      "The Link checker and the Proofreader found 2 new problems on Test project",
    ]);
    expect(emails[0]!.text).toContain("“About us” in footer links to a page that no longer exists");
    expect(emails[0]!.text).toContain("“recieve” in footer may be misspelled");
  });

  it("waits for the findings the Patrol Draft's thread didn't take, until a run hands them", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    const [first] = await f.drafts();
    // The draft's thread stops taking messages, as one failing would.
    await env.THREAD.getByName((await threadIdOf(f.db, first!.id))!).end();

    await f.goneLink("team", "Our team");
    await patrolLive(f.db);
    const about = (text: string) =>
      emailsTo(f.memberUser.email).then((emails) =>
        emails.filter((sent) => sent.text.includes(text)),
      );
    expect(await about("Our team")).toEqual([]);

    // Once a member deleted that draft, the next run opens another and hands it what's left.
    await call(router.drafts.delete, { projectId: f.projectId }, f.member(inDraft(first!.id)));
    answerNext("On it.");
    await patrolLive(f.db);
    const [second] = await f.drafts();
    const [brief] = saidIn((await f.threadOf(second!.id, 2)).view());
    expect(brief!.text).toContain("“Our team”");
    expect(brief!.text).not.toContain("“About us”");
    expect(await about("Our team")).toHaveLength(1);
    expect(await about("About us")).toHaveLength(1);
  });

  it("isn't sent again for findings members were told about", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    expect(await emailsTo(f.memberUser.email)).toHaveLength(1);

    await patrolLive(f.db);
    await patrolLive(f.db);

    expect(await emailsTo(f.memberUser.email)).toHaveLength(1);
  });

  it("stops for a member who unsubscribed, from that project only", async () => {
    const [f, other] = [await fixture(), await fixture()];
    // The member belongs to the other project's organization too.
    await f.db.insert(member).values({
      id: `membership-${crypto.randomUUID()}`,
      organizationId: other.project.organizationId,
      userId: f.memberUser.id,
      role: "member",
      createdAt: new Date(),
    });
    const teammate = await addMember(f.db, f.project.organizationId);
    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    const [email] = await emailsTo(f.memberUser.email);
    const link = /^<(.+)>$/.exec(email!.headers["List-Unsubscribe"]!)![1]!;
    expect(email!.text).toContain(`Unsubscribe: ${link}`);

    // As the member's inbox unsubscribes them in one click (RFC 8058).
    const response = await app.request(
      link,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      },
      env,
    );
    expect(response.status).toBe(200);
    await f.goneLink("team", "Our team");
    await other.goneLink("contact", "Contact");
    answerNext("On it.");
    answerNext("On it.");
    await patrolLive(f.db);

    const about = (address: string, text: string) =>
      emailsTo(address).then((emails) => emails.filter((sent) => sent.text.includes(text)));
    expect(await about(f.memberUser.email, "Our team")).toEqual([]);
    expect(await about(teammate.email, "Our team")).toHaveLength(1);
    expect(await about(f.memberUser.email, "Contact")).toHaveLength(1);
  });

  it("unsubscribes from its link only once the member confirms, and only as Camox signed it", async () => {
    const f = await fixture();
    await f.goneLink("about", "About us");
    answerNext("On it.");
    await patrolLive(f.db);
    const [email] = await emailsTo(f.memberUser.email);
    const link = /Unsubscribe: (\S+)/.exec(email!.text)![1]!;

    // Opening the link, as a mail scanner might, asks first.
    const page = await app.request(link, {}, env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post"');
    const forged = new URL(link);
    forged.searchParams.set("user", f.outsiderUser.id);
    expect((await app.request(forged.href, { method: "POST" }, env)).status).toBe(404);
    await f.goneLink("team", "Our team");
    answerNext("On it.");
    await patrolLive(f.db);
    expect(await emailsTo(f.memberUser.email)).toHaveLength(2);

    expect((await app.request(link, { method: "POST" }, env)).status).toBe(200);
    await f.goneLink("contact", "Contact");
    answerNext("On it.");
    await patrolLive(f.db);
    expect(await emailsTo(f.memberUser.email)).toHaveLength(2);
  });
});
