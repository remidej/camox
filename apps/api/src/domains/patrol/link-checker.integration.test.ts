import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7, PAGE_TEXT_LINK_PREFIX } from "@camox/api-contract/ids";
import type { FindingView, PatrollerView } from "@camox/api-contract/patrol";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { callSeedingLive, createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { forgetScheduledChecks, scheduledChecks } from "../../../test/generation";
import { runAiJob } from "../../lib/ai-jobs";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blockDefinitions, pages } from "../../schema";
import * as overlay from "../drafts/overlay";
import { RELEASE } from "../drafts/scope";
import { CHECK_IDLE_MS } from "./checks";

// The Link checker (ADR 0034) in a draft, through the router: editors edit, the draft's at-publish
// check runs as its scheduled job would once the draft is idle, and the Patrol says what it found.

type Headers = Record<string, string>;
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

/** Rich text, as content stores it: plain text, then a bold link to `url` reading `label`. */
const richText = (before: string, url: string, label: string) =>
  JSON.stringify({
    root: {
      type: "root",
      version: 1,
      direction: "ltr",
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              text: before,
              format: 0,
              detail: 0,
              mode: "normal",
              style: "",
              version: 1,
            },
            {
              type: "link",
              url,
              version: 1,
              direction: "ltr",
              format: "",
              indent: 0,
              children: [
                {
                  type: "text",
                  text: label,
                  format: 1,
                  detail: 0,
                  mode: "normal",
                  style: "",
                  version: 1,
                },
              ],
            },
          ],
        },
      ],
    },
  });

/** The Link checker's checks scheduled for a draft. */
const linkChecks = (draftId: string) =>
  scheduledChecks(draftId).filter((job) => job.patroller === "linkChecker");

const pageUrl = (pageId: string) => `${PAGE_TEXT_LINK_PREFIX}${pageId}`;

/** A project with a footer block holding a Link field and rich text, on Live's home page. */
async function fixture() {
  const base = await createProjectFixture(`link-checker-${crypto.randomUUID()}`);
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
  const createPage = async (pathSegment: string, headers: Headers = {}) => {
    const { page } = await callSeedingLive(
      router.pages.create,
      { projectId, pathSegment, layoutId: base.layout.layoutId, nickname: pathSegment || "Home" },
      member(headers),
    );
    // A manual meta title keeps its SEO out of publishing's checks.
    await callSeedingLive(
      router.pages.setSeo,
      { id: page.id, metaTitle: page.nickname },
      member(headers),
    );
    return page;
  };
  const createFooter = (pageId: string, content: Record<string, unknown>, headers: Headers = {}) =>
    callSeedingLive(router.blocks.create, { pageId, type: "footer", content }, member(headers));
  const editFooter = (id: string, content: Record<string, unknown>, headers: Headers) =>
    call(router.blocks.updateContent, { id, content }, member(headers));
  const getBlock = async (id: string, headers: Headers) =>
    (await call(router.blocks.get, { id }, member(headers))).block as {
      content: Record<string, unknown>;
    };
  const deletePage = (id: string, headers: Headers) =>
    call(router.pages.delete, { id }, member(headers));

  /** Runs the checks scheduled for a draft, as their alarms would once it's idle. */
  const idle = async (draftId: string) => {
    const jobs = scheduledChecks(draftId);
    forgetScheduledChecks(draftId);
    for (const job of jobs) await runService(runAiJob(db, job));
  };
  const linkChecker = async (headers: Headers): Promise<PatrollerView> =>
    (await call(router.patrol.get, { projectId }, member(headers))).patrollers.find(
      (patroller) => patroller.id === "linkChecker",
    )!;
  const findings = async (headers: Headers) => (await linkChecker(headers)).findings;
  const preview = (draftId: string) =>
    call(router.drafts.previewPublish, { projectId }, member(inDraft(draftId)));
  const apply = (findingId: number, headers: Headers) =>
    call(router.patrol.applyFix, { projectId, findingId }, member(headers));
  const dismiss = (findingId: number, headers: Headers) =>
    call(router.patrol.dismissFinding, { projectId, findingId }, member(headers));
  const deleteDraft = (draftId: string) =>
    call(router.drafts.delete, { projectId }, member(inDraft(draftId)));

  /**
   * Home, an About page, and a footer on home linking to About in rich text and in its Link field,
   * on Live; then a draft deleting About, checked once idle.
   */
  const aboutDeleted = async () => {
    const home = await createPage("");
    const about = await createPage("about");
    const footer = await createFooter(home.id, {
      body: richText("Read ", pageUrl(about.id), "about us"),
      link: { type: "page", text: "About", pageId: about.id },
    });
    const draft = generateUuidv7();
    await deletePage(about.id, startingDraft(draft));
    await idle(draft);
    const found = await findings(inDraft(draft));
    const inField = (field: string) => found.find((finding) => finding.field === field)!;
    return { home, about, footer, draft, inField };
  };

  return {
    ...base,
    projectId,
    member,
    createPage,
    createFooter,
    editFooter,
    getBlock,
    deletePage,
    idle,
    linkChecker,
    findings,
    preview,
    apply,
    dismiss,
    deleteDraft,
    aboutDeleted,
  };
}

/** What a finding says, in short. */
const said = (finding: FindingView) => ({
  kind: finding.about.kind,
  subject: finding.subject.id,
  field: finding.field,
  ...(finding.about.kind === "missingPage" && {
    url: finding.about.url,
    text: finding.about.text,
    page: finding.about.page,
  }),
  fix: finding.fix?.kind ?? null,
});

describe("the Link checker in a draft", () => {
  it("raises links to a page the draft deleted, once the draft is idle", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const about = await f.createPage("about");
    const footer = await f.createFooter(home.id, {
      body: richText("Read ", pageUrl(about.id), "about us"),
      link: { type: "page", text: "About", pageId: about.id },
    });
    const draft = generateUuidv7();
    await f.deletePage(about.id, startingDraft(draft));

    await f.idle(draft);

    const found = await f.findings(inDraft(draft));
    expect(found.map(said).toSorted((a, b) => a.field.localeCompare(b.field))).toEqual([
      {
        kind: "missingPage",
        subject: footer.id,
        field: "body",
        url: pageUrl(about.id),
        text: "about us",
        page: "about",
        fix: "removeLink",
      },
      {
        kind: "missingPage",
        subject: footer.id,
        field: "link",
        url: pageUrl(about.id),
        text: "About",
        page: "about",
        fix: "removeLink",
      },
    ]);
    expect(found[0]!.place).toEqual({
      kind: "page",
      pageId: home.id,
      blockId: footer.id,
      itemId: null,
    });
  });
});

describe("the Link checker when the review opens", () => {
  it("checks a draft that changed since its last check right away, and not again once it's up to date", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const about = await f.createPage("about");
    await f.createFooter(home.id, { link: { type: "page", text: "About", pageId: about.id } });
    const draft = generateUuidv7();
    await f.deletePage(about.id, startingDraft(draft));
    // The draft's last edit is too recent for the check that waits for it to be idle.
    expect(linkChecks(draft).map((job) => job.delayMs)).toEqual([CHECK_IDLE_MS]);
    forgetScheduledChecks(draft);

    await f.preview(draft);
    expect(linkChecks(draft).map((job) => job.delayMs)).toEqual([0]);
    await f.idle(draft);
    expect((await f.findings(inDraft(draft))).map((finding) => finding.field)).toEqual(["link"]);

    await f.preview(draft);
    expect(linkChecks(draft)).toEqual([]);
  });
});

describe("what the Link checker raises in a draft", () => {
  it("leaves out links Live already left leading nowhere, until the draft changes their content", async () => {
    const f = await fixture();
    const home = await f.createPage("");
    const about = await f.createPage("about");
    const footer = await f.createFooter(home.id, {
      link: { type: "page", text: "About", pageId: about.id },
    });
    // Live loses the page without a draft: no publish deletes a page Live links to, a release does.
    await runService(overlay.remove(f.db, RELEASE, pages, about.id));
    const draft = generateUuidv7();
    await f.createPage("contact", startingDraft(draft));

    await f.idle(draft);
    expect(await f.findings(inDraft(draft))).toEqual([]);

    await f.editFooter(footer.id, { body: "Hello" }, inDraft(draft));
    await f.idle(draft);
    expect((await f.findings(inDraft(draft))).map(said)).toEqual([
      {
        kind: "missingPage",
        subject: footer.id,
        field: "link",
        url: pageUrl(about.id),
        text: "About",
        page: null,
        fix: "removeLink",
      },
    ]);
  });
});

describe("applying a Link checker's fix", () => {
  it("removes the link, keeping its text, resolves the finding and reports it", async () => {
    const f = await fixture();
    const { footer, draft, inField } = await f.aboutDeleted();

    expect(await f.apply(inField("body").id, inDraft(draft))).toEqual({ applied: true });
    expect(await f.apply(inField("link").id, inDraft(draft))).toEqual({ applied: true });

    const { content } = await f.getBlock(footer.id, inDraft(draft));
    const body = JSON.parse(content.body as string);
    const paragraph = body.root.children[0].children;
    expect(
      paragraph.map((node: { type: string; text?: string }) => [node.type, node.text]),
    ).toEqual([
      ["text", "Read "],
      ["text", "about us"],
    ]);
    // The link's text keeps its formatting.
    expect(paragraph[1].format).toBe(1);
    expect(content.link).toMatchObject({ type: "external", href: "", text: "About" });
    const linkChecker = await f.linkChecker(inDraft(draft));
    expect(linkChecker.findings).toEqual([]);
    expect(linkChecker.reports.map(({ summary, outcome }) => [outcome, summary])).toEqual([
      [
        "done",
        {
          kind: "structured",
          verb: "removedLink",
          subject: expect.objectContaining({ entity: "block", id: footer.id }),
          locale: "en",
        },
      ],
    ]);
    // Checking again finds nothing.
    await f.idle(draft);
    expect(await f.findings(inDraft(draft))).toEqual([]);
  });

  it("checks again instead when the content changed since", async () => {
    const f = await fixture();
    const { home, footer, draft, inField } = await f.aboutDeleted();
    const link = { type: "page", text: "Home", pageId: home.id };
    await f.editFooter(footer.id, { link }, inDraft(draft));

    expect(await f.apply(inField("link").id, inDraft(draft))).toEqual({ applied: false });

    expect((await f.getBlock(footer.id, inDraft(draft))).content.link).toMatchObject(link);
    await f.idle(draft);
    expect((await f.findings(inDraft(draft))).map((finding) => finding.field)).toEqual(["body"]);
    expect((await f.linkChecker(inDraft(draft))).reports).toEqual([]);
  });
});

describe("dismissing a Link checker's finding", () => {
  it("resolves it, records who dismissed it and when, and never raises it again, even after its draft is deleted", async () => {
    const f = await fixture();
    const { about, footer, draft, inField } = await f.aboutDeleted();
    const before = Date.now();

    await f.dismiss(inField("link").id, inDraft(draft));

    // The url is dismissed project-wide: the rich text's link to it goes too.
    const linkChecker = await f.linkChecker(inDraft(draft));
    expect(linkChecker.findings).toEqual([]);
    expect(linkChecker.dismissals).toEqual([
      {
        id: expect.any(Number),
        about: { kind: "missingPage", url: pageUrl(about.id), text: "About", page: "about" },
        by: { id: f.memberUser.id, name: "Member" },
        at: expect.any(Number),
      },
    ]);
    expect(linkChecker.dismissals[0]!.at).toBeGreaterThanOrEqual(before);
    // An edit checks the draft again.
    await f.editFooter(
      footer.id,
      { body: richText("See ", pageUrl(about.id), "us") },
      inDraft(draft),
    );
    await f.idle(draft);
    expect(await f.findings(inDraft(draft))).toEqual([]);

    await f.deleteDraft(draft);
    const other = generateUuidv7();
    await f.deletePage(about.id, startingDraft(other));
    await f.idle(other);
    expect(await f.findings(inDraft(other))).toEqual([]);
    expect((await f.linkChecker(inDraft(other))).dismissals).toHaveLength(1);
    expect((await f.linkChecker({})).dismissals).toHaveLength(1);
  });
});
