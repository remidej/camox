import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  reviewed,
  runAllChecks,
  syncDefinitionSet,
} from "../../../test/fixtures";
import {
  answerEvery,
  answerNext,
  forgetScheduled,
  modelCalls,
  scheduled,
} from "../../../test/generation";
import { isTranslationJob } from "../../lib/ai-job-queue";
import { runAiJob } from "../../lib/ai-jobs";
import type { DraftOverviewRequest } from "../../lib/ai-model";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { CREATED_VALUES, MAX_INPUT_LENGTH, overviewInput } from "./overview-input";
import { runOverviewJob } from "./overview-job";
import { camoxContext, type Change } from "./publish";

// What the model reads to write a draft's overview (#532): the draft's changes, field by field,
// in the default locale, so its bullets can say "Pro goes from $29 to $20".

type Headers = Record<string, string>;

async function fixture() {
  const base = await createProjectFixture(`overview-input-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await syncDefinitionSet(db, project, {
    blocks: [
      {
        blockId: "plan",
        title: "Plan",
        description: "A pricing plan",
        contentSchema: {
          type: "object",
          properties: {
            name: { fieldType: "String", type: "string", title: "Name" },
            price: { fieldType: "String", type: "string", title: "Price" },
          },
          toMarkdown: ["# {{name}}", "{{price}}"],
        },
      },
      {
        blockId: "feature",
        title: "Feature",
        description: "A product feature",
        contentSchema: {
          type: "object",
          properties: {
            title: { fieldType: "String", type: "string", title: "Title" },
            tagline: { fieldType: "String", type: "string", title: "Tagline" },
            body: { fieldType: "String", type: "string", title: "Body" },
            details: { fieldType: "String", type: "string", title: "Details" },
            note: { fieldType: "String", type: "string", title: "Note" },
            footnote: { fieldType: "String", type: "string", title: "Footnote" },
          },
          toMarkdown: ["# {{title}}", "{{tagline}}", "{{body}}"],
        },
      },
    ],
  });
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "pricing", layoutId: base.layout.layoutId },
    member(),
  );
  const addPlan = (content: { name: string; price: string }, headers: Headers = {}) =>
    callSeedingLive(
      router.blocks.create,
      { pageId: page.id, type: "plan", content },
      member(headers),
    );
  const editPlan = (id: string, content: { name: string; price: string }, headers: Headers) =>
    callSeedingLive(router.blocks.updateContent, { id, content }, member(headers));

  /** Opens a draft, which `run` writes in, and returns its id and headers. */
  const draft = async (run: (starting: Headers) => Promise<unknown>) => {
    const id = generateUuidv7();
    await run({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" });
    return { id, headers: { [DRAFT_HEADER]: id } };
  };
  /** Runs the draft's overview job and returns what the model was asked. */
  const overviewRequest = async (draftId: string): Promise<DraftOverviewRequest> => {
    answerNext("draftOverview", {
      nameVerdict: "obsolete",
      name: "A name",
      headline: "A headline",
      bullets: [],
    });
    await runService(runOverviewJob(db, { kind: "overview", draftId }));
    const asked = modelCalls().filter((call) => call.method === "draftOverview");
    return asked.at(-1)!.request as DraftOverviewRequest;
  };
  return { ...base, projectId, page, member, addPlan, editPlan, draft, overviewRequest };
}

describe("the overview's input", () => {
  it("has a changed block's fields before and after, and a created block's values", async () => {
    const { addPlan, editPlan, draft, overviewRequest } = await fixture();
    const pro = await addPlan({ name: "Pro", price: "$29" });

    const mine = await draft(async (headers) => {
      await editPlan(pro.id, { name: "Pro", price: "$20" }, headers);
      await addPlan({ name: "Team", price: "$99" }, headers);
    });

    const request = await overviewRequest(mine.id);
    expect("changes" in request && request.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          place: "Pricing (/pricing)",
          change: "changed",
          fields: [{ field: "Price", before: "$29", after: "$20" }],
        }),
        expect.objectContaining({
          place: "Pricing (/pricing)",
          change: "created",
          values: [
            { field: "Name", value: "Team" },
            { field: "Price", value: "$99" },
          ],
        }),
      ]),
    );
  });

  it("has a created block's main values only: its first fields holding one", async () => {
    const { page, member, draft, overviewRequest } = await fixture();
    const content = {
      title: "Sync",
      tagline: "",
      body: "Keeps every device in step",
      details: "Works offline",
      note: "Beta",
      footnote: "Since 2024",
    };

    const mine = await draft((headers) =>
      callSeedingLive(
        router.blocks.create,
        { pageId: page.id, type: "feature", content },
        member(headers),
      ),
    );

    const request = await overviewRequest(mine.id);
    const held = [
      { field: "Title", value: "Sync" },
      { field: "Body", value: "Keeps every device in step" },
      { field: "Details", value: "Works offline" },
      { field: "Note", value: "Beta" },
      { field: "Footnote", value: "Since 2024" },
    ];
    expect(CREATED_VALUES).toBeLessThan(held.length);
    expect(request).toMatchObject({
      changes: [{ change: "created", values: held.slice(0, CREATED_VALUES) }],
    });
  });

  it("names a deleted block by its label, and a block that only changed position as moved", async () => {
    const { member, addPlan, draft, overviewRequest } = await fixture();
    const pro = await addPlan({ name: "Pro", price: "$29" });
    const team = await addPlan({ name: "Team", price: "$99" });
    const basic = await addPlan({ name: "Basic", price: "$9" });

    const mine = await draft(async (headers) => {
      await callSeedingLive(
        router.blocks.updatePosition,
        { id: team.id, beforePosition: pro.position },
        member(headers),
      );
      await callSeedingLive(router.blocks.delete, { id: basic.id }, member(headers));
    });

    const request = await overviewRequest(mine.id);
    expect(request).toMatchObject({
      changes: expect.arrayContaining([
        { place: "Pricing (/pricing)", label: "Plan", change: "moved" },
        { place: "Pricing (/pricing)", label: "Plan", change: "deleted" },
      ]),
    });
    expect("changes" in request && request.changes).toHaveLength(2);
  });

  it("leaves out what Camox translated, counts hand edits per locale, and lists added locales", async () => {
    const { db, projectId, member, addPlan, editPlan, draft, overviewRequest } = await fixture();
    answerEvery("translate", ({ texts }) =>
      Object.fromEntries(texts.map(({ key, text }) => [key, `${text} (translated)`])),
    );
    const runTranslations = async () => {
      const jobs = scheduled().filter(isTranslationJob);
      forgetScheduled(...jobs.map((job) => job.entityId));
      const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
      for (const job of keyed.values()) await runService(runAiJob(db, job));
      await runAllChecks(db);
    };
    const addLocale = (tag: string, headers: Headers) =>
      call(router.locales.add, { projectId, tag }, member(headers));
    const pro = await addPlan({ name: "Pro", price: "$29" });
    const team = await addPlan({ name: "Team", price: "$99" });
    const german = await draft((headers) => addLocale("de", headers));
    await runTranslations();
    const { token } = await reviewed(
      db,
      german.id,
      call(router.drafts.previewPublish, { projectId }, member(german.headers)),
    );
    await call(router.drafts.publish, { projectId, token }, member(german.headers));

    const mine = await draft(async (headers) => {
      await editPlan(pro.id, { name: "Pro", price: "$20" }, headers);
      await editPlan(
        team.id,
        { name: "Team", price: "99 €" },
        { ...headers, [LOCALE_HEADER]: "de" },
      );
      await addLocale("fr", headers);
    });
    await runTranslations();

    const request = await overviewRequest(mine.id);
    expect(request).toMatchObject({
      changes: expect.arrayContaining([
        {
          place: "Pricing (/pricing)",
          label: "Plan",
          change: "changed",
          fields: [{ field: "Price", before: "$29", after: "$20" }],
        },
        { place: "Languages", label: "fr", change: "created" },
      ]),
      localeEdits: [{ locale: "de", edits: 1, places: ["Pricing (/pricing)"] }],
    });
    expect("changes" in request && request.changes).toHaveLength(2);
  });

  it("groups a draft's changes by place, with counts, once they're too long to list", async () => {
    const { addPlan, draft, overviewRequest } = await fixture();
    const name = "Plan ".repeat(20);
    const price = "$".repeat(100);
    // Each created plan's values alone take more than their name and price.
    const count = Math.ceil(MAX_INPUT_LENGTH / (name.length + price.length)) + 1;

    const mine = await draft(async (headers) => {
      for (let i = 0; i < count; i++) await addPlan({ name, price }, headers);
    });

    const request = await overviewRequest(mine.id);
    expect(request).not.toHaveProperty("changes");
    expect(request).toMatchObject({
      places: [{ place: "Pricing (/pricing)", created: count, changed: 0, deleted: 0, moved: 0 }],
    });
  });

  it("describes a page path rename once, not once per page under it", async () => {
    const { projectId, layout, member, draft, overviewRequest } = await fixture();
    const createPage = async (nickname: string, pathSegment: string, parentPageId?: string) =>
      (
        await callSeedingLive(
          router.pages.create,
          { projectId, nickname, pathSegment, parentPageId, layoutId: layout.layoutId },
          member(),
        )
      ).page;
    const blog = await createPage("Blog", "blog");
    const spring = await createPage("Spring", "spring", blog.id);
    await createPage("Notes", "notes", spring.id);
    const winter = await createPage("Winter", "winter", blog.id);

    const mine = await draft(async (headers) => {
      await call(router.pages.update, { id: blog.id, pathSegment: "news" }, member(headers));
      await call(router.pages.update, { id: winter.id, nickname: "Cold" }, member(headers));
    });

    const request = await overviewRequest(mine.id);
    expect("changes" in request && request.changes).toEqual([
      {
        place: "Blog (/news)",
        label: "Page",
        change: "changed",
        fields: [{ field: "Path", before: "/blog", after: "/news" }],
        pagesUnder: 2,
      },
      {
        place: "Cold (/news/winter)",
        label: "Page",
        change: "changed",
        fields: [
          { field: "Name", before: "Winter", after: "Cold" },
          { field: "Path", before: "/blog/winter", after: "/news/winter" },
        ],
      },
    ]);
  });
});

describe("the overview's input size", () => {
  /** A draft's changes, as its preview lists them, each on its own page with a long name. */
  async function changesOnManyPages(locale: string, change: Change["change"]) {
    const { db, projectId, member } = await fixture();
    const { id } = await call(router.drafts.create, { projectId }, member());
    const nickname = "Page ".repeat(60);
    // Even counted by place, the places alone take more than the input may.
    const count = Math.ceil(MAX_INPUT_LENGTH / nickname.length) + 1;
    const changes: Change[] = Array.from({ length: count }, (_, i) => ({
      entity: "page",
      id: generateUuidv7(),
      label: "Page",
      owner: { kind: "page", id: `${i}`, path: `/${i}`, nickname },
      locale,
      change,
    }));
    const input = (defaultLocale: string) =>
      runService(
        overviewInput(
          camoxContext(db),
          { id, projectId },
          { name: "Big", openingRequest: null },
          changes,
          defaultLocale,
        ),
      );
    return { count, input };
  }

  it("caps the places a draft's changes are counted in, counting the others together", async () => {
    const { count, input } = await changesOnManyPages("en", "deleted");

    const request = await input("en");

    expect(JSON.stringify(request).length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
    expect("places" in request && request.places.at(-1)?.place).toMatch(/other places/);
    const deleted = "places" in request ? request.places.map((place) => place.deleted) : [];
    expect(deleted.reduce((sum, n) => sum + n, 0)).toBe(count);
  });

  it("caps the places a locale's hand edits are in", async () => {
    const { count, input } = await changesOnManyPages("de", "changed");

    const request = await input("en");

    expect(JSON.stringify(request).length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
    expect(request.localeEdits).toMatchObject([{ locale: "de", edits: count }]);
    expect(request.localeEdits[0]!.places.at(-1)).toMatch(/other places/);
  });
});
