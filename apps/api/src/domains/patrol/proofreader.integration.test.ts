import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { PATROLLER_IDS, type FindingView, type PatrollerView } from "@camox/api-contract/patrol";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  runTranslations,
  seedLive,
} from "../../../test/fixtures";
import {
  answerEvery,
  answerNext,
  forgetScheduledChecks,
  scheduledChecks,
} from "../../../test/generation";
import { runAiJob } from "../../lib/ai-jobs";
import { AiCallError } from "../../lib/retry-ai-call";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { blockDefinitions, blocks } from "../../schema";
import { syncRevisionDefinitions } from "../definitions/service";

// The Proofreader (ADR 0034) in a draft, through the router: editors edit, the draft's at-publish
// check runs as its scheduled job would once the draft is idle, the scripted model proofreads with
// a dictionary of mistakes, and the Patrol says what it found.

type Headers = Record<string, string>;
const startingDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
const inDraft = (id: string): Headers => ({ [DRAFT_HEADER]: id });

/** The mistakes the scripted model knows, and their fixes. */
const MISTAKES: Record<string, { replacement: string; kind: "misspelling" | "grammar" }> = {
  recieve: { replacement: "receive", kind: "misspelling" },
  teh: { replacement: "the", kind: "misspelling" },
  Teh: { replacement: "The", kind: "misspelling" },
  "They was": { replacement: "They were", kind: "grammar" },
};

/** The model fixes every mistake it knows in each text, as the original and its replacement. */
const proofreadWithDictionary = () =>
  answerEvery("proofread", ({ texts }) =>
    texts.flatMap(({ key, text }) =>
      Object.entries(MISTAKES)
        .filter(([original]) => text.includes(original))
        .map(([original, { replacement, kind }]) => ({ key, kind, original, replacement })),
    ),
  );

/** The hero's definition: a title, rich text and a link. */
const HERO_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", fieldType: "String", title: "Title" },
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
  toTitle: "{{title}}",
};

/** Rich text, as content stores it: one paragraph of text nodes, each with its format bits. */
const richText = (...nodes: [text: string, format: number][]) =>
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
          children: nodes.map(([text, format]) => ({
            type: "text",
            text,
            format,
            detail: 0,
            mode: "normal",
            style: "",
            version: 1,
          })),
        },
      ],
    },
  });

/** A rich text's text nodes, as their text and format bits. */
const nodesOf = (value: unknown) =>
  (
    JSON.parse(value as string) as {
      root: { children: { children: { text: string; format: number }[] }[] };
    }
  ).root.children[0]!.children.map((node) => [node.text, node.format]);

/** A project with a hero block holding a title, on Live's home page. */
async function fixture() {
  const base = await createProjectFixture(`proofreader-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await db.insert(blockDefinitions).values({
    projectId,
    blockId: "hero",
    title: "Hero",
    description: "",
    contentSchema: HERO_SCHEMA,
    createdAt: 1,
    updatedAt: 1,
  });
  proofreadWithDictionary();
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page: home } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "", layoutId: base.layout.layoutId, nickname: "Home" },
    member(),
  );
  const hero = await callSeedingLive(
    router.blocks.create,
    { pageId: home.id, type: "hero", content: { title: "Welcome" } },
    member(),
  );
  const editHero = (content: Record<string, unknown>, headers: Headers) =>
    call(router.blocks.updateContent, { id: hero.id, content }, member(headers));

  /** Runs the checks scheduled for a draft, as their alarms would once it's idle. */
  const idle = async (draftId: string) => {
    const jobs = scheduledChecks(draftId);
    forgetScheduledChecks(draftId);
    for (const job of jobs) await runService(runAiJob(db, job));
  };
  const proofreader = async (headers: Headers): Promise<PatrollerView> =>
    (
      await call(router.patrol.get, { projectId, patrollers: [...PATROLLER_IDS] }, member(headers))
    ).patrollers.find((patroller) => patroller.id === "proofreader")!;
  const findings = async (headers: Headers) => (await proofreader(headers)).findings;
  const getHero = async (headers: Headers) =>
    (
      (await call(router.blocks.get, { id: hero.id }, member(headers))).block as {
        content: Record<string, unknown>;
      }
    ).content;
  const apply = (findingId: number, headers: Headers) =>
    call(router.patrol.applyFix, { projectId, findingId }, member(headers));
  const dismiss = (findingId: number, headers: Headers) =>
    call(router.patrol.dismissFinding, { projectId, findingId }, member(headers));
  /** A draft writing `content` into the hero, checked once idle, and its findings. */
  const edited = async (content: Record<string, unknown>) => {
    const draft = generateUuidv7();
    await editHero(content, startingDraft(draft));
    await idle(draft);
    return { draft, found: await findings(inDraft(draft)) };
  };

  return {
    ...base,
    projectId,
    member,
    home,
    hero,
    editHero,
    getHero,
    idle,
    proofreader,
    findings,
    apply,
    dismiss,
    edited,
  };
}

/** What a finding says, in short. */
const said = (finding: FindingView) => ({
  kind: finding.about.kind,
  subject: finding.subject.id,
  locale: finding.locale,
  field: finding.field,
  ...("sentence" in finding.about && {
    text: finding.about.text,
    sentence: finding.about.sentence,
  }),
  fix: finding.fix,
});

describe("the Proofreader in a draft", () => {
  it("raises a misspelling in what the draft changed, with its fix, once the draft is idle", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    await f.editHero({ title: "Guests recieve a gift." }, startingDraft(draft));

    await f.idle(draft);

    expect((await f.findings(inDraft(draft))).map(said)).toEqual([
      {
        kind: "misspelling",
        subject: f.hero.id,
        locale: "en",
        field: "title",
        text: "recieve",
        sentence: "Guests recieve a gift.",
        fix: { kind: "replaceText", replacement: "receive" },
      },
    ]);
  });
});

describe("the Proofreader in the Patrol", () => {
  it("works while its check runs, and is idle at publish otherwise", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    await f.editHero({ title: "Guests recieve a gift." }, startingDraft(draft));
    const before = await f.proofreader(inDraft(draft));
    let during: PatrollerView | undefined;
    answerEvery("proofread", async () => {
      during = await f.proofreader(inDraft(draft));
      return [];
    });

    await f.idle(draft);

    expect([before.duty, before.working]).toEqual(["atPublish", null]);
    expect(during?.working).toEqual({
      subject: expect.objectContaining({ entity: "block", id: f.hero.id }),
      locales: [{ locale: "en", count: 1 }],
    });
    const after = await f.proofreader(inDraft(draft));
    expect(after.working).toBeNull();
    expect(after.lastCheckedAt).not.toBeNull();
  });
});

describe("what the Proofreader reads in a draft", () => {
  it("leaves out fields and content the draft didn't change", async () => {
    const f = await fixture();
    // Live holds mistakes, as a release wrote them: publishing would wait for their findings.
    for (const content of [{ body: richText(["Teh gifts.", 0]) }, { title: "Teh other hero." }]) {
      await seedLive(f.db, blocks, {
        projectId: f.projectId,
        pageId: f.home.id,
        type: "hero",
        content,
        position: `b${crypto.randomUUID()}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const { found } = await f.edited({ title: "Guests recieve a gift." });

    expect(found.map((finding) => [finding.field, finding.about])).toEqual([
      ["title", { kind: "misspelling", text: "recieve", sentence: "Guests recieve a gift." }],
    ]);
  });

  it("reads each text node of rich text and link text", async () => {
    const f = await fixture();

    const { found } = await f.edited({
      body: richText(["Come in. ", 0], ["They was here.", 1]),
      link: { type: "external", href: "https://example.com", text: "Teh shop" },
    });

    expect(found.map(said).toSorted((a, b) => a.field.localeCompare(b.field))).toEqual([
      {
        kind: "grammar",
        subject: f.hero.id,
        locale: "en",
        field: "body",
        text: "They was",
        sentence: "They was here.",
        fix: { kind: "replaceText", replacement: "They were" },
      },
      {
        kind: "misspelling",
        subject: f.hero.id,
        locale: "en",
        field: "link",
        text: "Teh",
        sentence: "Teh shop",
        fix: { kind: "replaceText", replacement: "The" },
      },
    ]);
  });

  it("leaves out text the Translator wrote, and reads a localization edited by hand", async () => {
    const f = await fixture();
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, `${text} recieve`])),
    );
    const draft = generateUuidv7();
    await call(
      router.locales.add,
      { projectId: f.projectId, tag: "fr" },
      f.member(startingDraft(draft)),
    );
    await runTranslations(f.db);
    await f.idle(draft);
    expect(await f.findings(inDraft(draft))).toEqual([]);

    await f.editHero(
      { title: "Ils recieve un cadeau." },
      { ...inDraft(draft), [LOCALE_HEADER]: "fr" },
    );
    await f.idle(draft);

    expect((await f.findings(inDraft(draft))).map(said)).toEqual([
      {
        kind: "misspelling",
        subject: f.hero.id,
        locale: "fr",
        field: "title",
        text: "recieve",
        sentence: "Ils recieve un cadeau.",
        fix: { kind: "replaceText", replacement: "receive" },
      },
    ]);
  });

  it("reads the code-owned defaults the draft's code adds", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    await f.editHero({ title: "Welcome!" }, startingDraft(draft));
    await runService(
      syncRevisionDefinitions(createServiceContext(f.db, f.memberUser), {
        draftId: draft,
        revisionId: generateUuidv7(),
        definitionSet: {
          blocks: [{ blockId: "hero", title: "Hero", description: "", contentSchema: HERO_SCHEMA }],
          layouts: [
            {
              layoutId: f.layout.layoutId,
              description: "Default",
              blocks: [{ type: "hero", content: { title: "Teh footer." } }],
            },
          ],
          collections: [],
          homepage: null,
        },
      }),
    );

    await f.idle(draft);

    expect((await f.findings(inDraft(draft))).map((finding) => finding.about)).toEqual([
      { kind: "misspelling", text: "Teh", sentence: "Teh footer." },
    ]);
  });
});

describe("applying a Proofreader's fix", () => {
  it("replaces only the flagged words, keeping their formatting, and reports it", async () => {
    const f = await fixture();
    const { draft, found } = await f.edited({
      body: richText(["Come in. ", 0], ["They was here, teh end.", 1]),
    });
    const grammar = found.find((finding) => finding.about.kind === "grammar")!;

    expect(await f.apply(grammar.id, inDraft(draft))).toEqual({ applied: true });

    expect(nodesOf((await f.getHero(inDraft(draft))).body)).toEqual([
      ["Come in. ", 0],
      ["They were here, teh end.", 1],
    ]);
    const proofreader = await f.proofreader(inDraft(draft));
    expect(proofreader.findings.map((finding) => finding.about.text)).toEqual(["teh"]);
    expect(proofreader.reports.map(({ summary, outcome }) => [outcome, summary])).toEqual([
      [
        "done",
        {
          kind: "structured",
          verb: "fixedMistake",
          subject: expect.objectContaining({ entity: "block", id: f.hero.id }),
          locale: "en",
        },
      ],
    ]);
  });

  it("checks again instead when the text changed since", async () => {
    const f = await fixture();
    const { draft, found } = await f.edited({ title: "Guests recieve a gift." });
    await f.editHero({ title: "Guests recieve gifts." }, inDraft(draft));
    forgetScheduledChecks(draft);

    expect(await f.apply(found[0]!.id, inDraft(draft))).toEqual({ applied: false });

    expect((await f.getHero(inDraft(draft))).title).toBe("Guests recieve gifts.");
    expect(scheduledChecks(draft).map((job) => [job.patroller, job.delayMs])).toEqual([
      ["proofreader", 0],
    ]);
    await f.idle(draft);
    expect((await f.findings(inDraft(draft))).map((finding) => finding.about)).toEqual([
      { kind: "misspelling", text: "recieve", sentence: "Guests recieve gifts." },
    ]);
    expect((await f.proofreader(inDraft(draft))).reports).toEqual([]);
  });
});

describe("dismissing a Proofreader's finding", () => {
  it("covers that one occurrence, until its sentence changes", async () => {
    const f = await fixture();
    const { draft, found } = await f.edited({ title: "Guests recieve a gift. Come in." });

    await f.dismiss(found[0]!.id, inDraft(draft));
    await f.editHero({ title: "Guests recieve a gift. Come in now." }, inDraft(draft));
    await f.idle(draft);
    expect(await f.findings(inDraft(draft))).toEqual([]);

    await f.editHero({ title: "Our guests recieve a gift. Come in now." }, inDraft(draft));
    await f.idle(draft);
    expect((await f.findings(inDraft(draft))).map((finding) => finding.about)).toEqual([
      { kind: "misspelling", text: "recieve", sentence: "Our guests recieve a gift." },
    ]);
  });
});

describe("the Proofreader when the model fails", () => {
  it("stays up to date with nothing, and reads the text again when the review opens", async () => {
    const f = await fixture();
    const draft = generateUuidv7();
    await f.editHero({ title: "Guests recieve a gift." }, startingDraft(draft));
    answerNext("proofread", new AiCallError({ cause: "down" }));
    await f.idle(draft);
    expect(await f.findings(inDraft(draft))).toEqual([]);
    expect((await f.proofreader(inDraft(draft))).working).toBeNull();

    await call(router.drafts.previewPublish, { projectId: f.projectId }, f.member(inDraft(draft)));
    await f.idle(draft);

    expect((await f.findings(inDraft(draft))).map((finding) => finding.field)).toEqual(["title"]);
  });
});
