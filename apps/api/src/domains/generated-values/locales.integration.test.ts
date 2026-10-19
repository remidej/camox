import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOCALE_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  callSeedingLive,
  createProjectFixture,
  createRpcContext,
  createServiceContext,
} from "../../../test/fixtures";
import { answerNext, forgetScheduled, modelCalls, scheduledFor } from "../../../test/generation";
import type { GenerationJob } from "../../lib/generation-scheduler";
import { runService } from "../../lib/run-service";
import { router } from "../../router";
import { files } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { runGenerationJob } from "./generation";

// Generated values follow the locale (ADR 0012, ADR 0015): SEO and alt text are generated per
// locale, summaries in the default locale only.

type Headers = Record<string, string>;

/**
 * A project with a page holding a block and an image on Live in `en`, and a draft adding `de`:
 * every content read and write of the tests runs in that draft.
 */
async function fixture() {
  const base = await createProjectFixture(`generated-locales-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  const projectId = project.id;
  await runService(
    upsertBlockDefinition(createServiceContext(db, null), {
      projectSlug: project.slug,
      deployToken: project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      contentSchema: {
        type: "object",
        properties: { title: { fieldType: "String", type: "string" } },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const member = (headers: Headers = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  const { page } = await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "about", layoutId: base.layout.layoutId },
    member(),
  );
  const block = await callSeedingLive(
    router.blocks.create,
    { pageId: page.id, type: "hero", content: { title: "About us" } },
    member(),
  );
  const now = Date.now();
  const file = await db
    .insert(files)
    .values({
      projectId,
      url: "http://localhost/files/serve/team.png",
      alt: null,
      filename: null,
      mimeType: "image/png",
      size: 68,
      blobId: crypto.randomUUID(),
      path: "/",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const draft = generateUuidv7();
  const en: Headers = { [DRAFT_HEADER]: draft };
  const de: Headers = { [DRAFT_HEADER]: draft, [LOCALE_HEADER]: "de" };
  await call(
    router.locales.add,
    { projectId, tag: "de" },
    member({ ...en, [DRAFT_CREATE_HEADER]: "1" }),
  );

  /** Runs a scheduled job in the draft. */
  const run = (job: Omit<GenerationJob, "draftId">) =>
    runService(runGenerationJob(db, { ...job, draftId: draft }));
  const generateSeo = (
    locale: string | undefined,
    seo: { metaTitle: string; metaDescription: string },
  ) => {
    answerNext("pageSeo", seo);
    return run({ entity: "page", entityId: page.id, ...(locale ? { locale } : {}) });
  };
  const generateMetadata = (
    locale: string | undefined,
    metadata: { alt: string; filename: string },
  ) => {
    answerNext("imageMetadata", metadata);
    return run({ entity: "file", entityId: file.id, ...(locale ? { locale } : {}) });
  };
  const pageIn = async (headers: Headers) =>
    call(router.pages.get, { id: page.id }, member(headers));
  const setSeo = (headers: Headers, input: { metaTitle?: string; aiSeo?: boolean }) =>
    call(router.pages.setSeo, { id: page.id, ...input }, member(headers));
  const fileIn = (headers: Headers) => call(router.files.get, { id: file.id }, member(headers));
  const setAlt = (headers: Headers, alt: string) =>
    call(router.files.setAlt, { id: file.id, alt }, member(headers));
  const preview = (id = draft) =>
    call(router.drafts.previewPublish, { projectId }, member({ [DRAFT_HEADER]: id }));
  const publish = async (id: string) =>
    call(
      router.drafts.publish,
      { projectId, token: (await preview(id)).token },
      member({ [DRAFT_HEADER]: id }),
    );

  return {
    ...base,
    projectId,
    page,
    block,
    file,
    draft,
    en,
    de,
    member,
    run,
    generateSeo,
    generateMetadata,
    pageIn,
    setSeo,
    fileIn,
    setAlt,
    preview,
    publish,
  };
}

describe("SEO per locale", () => {
  it("generates a de page's meta title and description in German", async () => {
    const f = await fixture();

    await f.generateSeo("de", { metaTitle: "Über uns", metaDescription: "Wer wir sind" });

    expect(modelCalls()).toEqual([
      { method: "pageSeo", request: expect.objectContaining({ locale: "de" }) },
    ]);
    expect(await f.pageIn(f.de)).toMatchObject({
      metaTitle: "Über uns",
      metaDescription: "Wer wir sind",
      aiSeo: true,
    });
    expect(await f.pageIn(f.en)).not.toMatchObject({ metaTitle: "Über uns" });
  });

  it("written by hand on the de page leaves the default locale's SEO generated", async () => {
    const f = await fixture();
    await f.generateSeo(undefined, { metaTitle: "About us", metaDescription: "Who we are" });

    expect(await f.setSeo(f.de, { metaTitle: "Über uns" })).toMatchObject({
      metaTitle: "Über uns",
      aiSeo: false,
    });

    expect(await f.pageIn(f.en)).toMatchObject({
      metaTitle: "About us",
      metaDescription: "Who we are",
      aiSeo: true,
    });
  });

  it("made generated again on the de page is requested in German only", async () => {
    const f = await fixture();
    await f.setSeo(f.de, { metaTitle: "Über uns" });
    forgetScheduled(f.page.id);

    await f.setSeo(f.de, { aiSeo: true });

    expect(scheduledFor(f.page.id)).toEqual([
      expect.objectContaining({ entity: "page", draftId: f.draft, locale: "de" }),
    ]);
  });

  it("is requested in a locale for each of its pages when the locale is added", async () => {
    const f = await fixture();

    expect(scheduledFor(f.page.id)).toContainEqual(
      expect.objectContaining({ entity: "page", draftId: f.draft, locale: "de" }),
    );
  });
});

describe("a file's alt text per locale", () => {
  it("is generated in each locale, under the default locale's filename", async () => {
    const f = await fixture();

    await f.generateMetadata(undefined, { alt: "The team", filename: "the-team" });
    await f.generateMetadata("de", { alt: "Das Team", filename: "das-team" });

    expect(modelCalls()).toEqual([
      { method: "imageMetadata", request: expect.objectContaining({ locale: "en" }) },
      { method: "imageMetadata", request: expect.objectContaining({ locale: "de" }) },
    ]);
    expect(await f.fileIn(f.en)).toMatchObject({
      alt: "The team",
      filename: "the-team",
      aiMetadata: true,
    });
    expect(await f.fileIn(f.de)).toMatchObject({
      alt: "Das Team",
      filename: "the-team",
      aiMetadata: true,
    });
  });

  it("is requested in a locale for each file when the locale is added", async () => {
    const f = await fixture();

    expect(scheduledFor(f.file.id)).toContainEqual(
      expect.objectContaining({ entity: "file", draftId: f.draft, locale: "de" }),
    );
  });

  it("written by hand in German doesn't change the English one", async () => {
    const f = await fixture();
    await f.generateMetadata(undefined, { alt: "The team", filename: "the-team" });

    expect(await f.setAlt(f.de, "Unser Team")).toMatchObject({
      alt: "Unser Team",
      filename: "the-team",
      aiMetadata: false,
    });

    expect(await f.fileIn(f.en)).toMatchObject({
      alt: "The team",
      filename: "the-team",
      aiMetadata: true,
    });
    // The German alt text alone is manual: generating again leaves it as it is.
    await f.generateMetadata("de", { alt: "Das Team", filename: "das-team" });
    expect(await f.fileIn(f.de)).toMatchObject({ alt: "Unser Team", aiMetadata: false });
  });

  it("made generated again in German is requested in German only", async () => {
    const f = await fixture();
    await f.setAlt(f.de, "Unser Team");
    forgetScheduled(f.file.id);

    expect(
      await call(router.files.setAiMetadata, { id: f.file.id, enabled: true }, f.member(f.de)),
    ).toMatchObject({ alt: "Unser Team", aiMetadata: true });

    expect(scheduledFor(f.file.id)).toEqual([
      expect.objectContaining({ entity: "file", draftId: f.draft, locale: "de" }),
    ]);
  });

  it("can't rename the file outside the default locale, whose filename every locale shares", async () => {
    const f = await fixture();

    await expect(
      call(router.files.setFilename, { id: f.file.id, filename: "das-team" }, f.member(f.de)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("summaries", () => {
  it("are generated for default-locale content only: a de edit requests the de page's SEO instead", async () => {
    const f = await fixture();
    forgetScheduled(f.page.id, f.block.id);

    await call(
      router.blocks.updateContent,
      { id: f.block.id, content: { title: "Über uns" } },
      f.member(f.de),
    );

    expect(scheduledFor(f.page.id, f.block.id)).toEqual([
      expect.objectContaining({ entity: "page", draftId: f.draft, locale: "de" }),
    ]);
  });

  it("read the same in every locale: the default locale's", async () => {
    const f = await fixture();
    answerNext("summarize", "About us hero");
    await f.run({ entity: "block", entityId: f.block.id });

    const summaryIn = async (headers: Headers) =>
      (await call(router.blocks.get, { id: f.block.id }, f.member(headers))).block.summary;
    expect(await summaryIn(f.de)).toBe("About us hero");
    expect(await summaryIn(f.en)).toBe("About us hero");
  });

  it("generated on demand in de are the default locale's, from its content", async () => {
    const f = await fixture();
    await call(
      router.blocks.updateContent,
      { id: f.block.id, content: { title: "Über uns" } },
      f.member(f.de),
    );
    answerNext("summarize", "About us hero");

    await call(router.blocks.generateSummary, { id: f.block.id }, f.member(f.de));

    expect(modelCalls()).toEqual([
      { method: "summarize", request: expect.objectContaining({ markdown: "# About us" }) },
    ]);
  });
});

describe("publishing", () => {
  it("copies each locale's values to Live, and requests Live's in the locales of what changed", async () => {
    const f = await fixture();
    await f.generateSeo("de", { metaTitle: "Über uns", metaDescription: "Wer wir sind" });
    await f.generateMetadata("de", { alt: "Das Team", filename: "das-team" });
    await f.publish(f.draft);
    expect(await f.pageIn({ [LOCALE_HEADER]: "de" })).toMatchObject({ metaTitle: "Über uns" });
    expect(await f.fileIn({ [LOCALE_HEADER]: "de" })).toMatchObject({ alt: "Das Team" });

    const next = generateUuidv7();
    await call(
      router.blocks.updateContent,
      { id: f.block.id, content: { title: "Über uns" } },
      f.member({ [DRAFT_HEADER]: next, [DRAFT_CREATE_HEADER]: "1", [LOCALE_HEADER]: "de" }),
    );
    forgetScheduled(f.page.id, f.block.id);
    await f.publish(next);

    expect(scheduledFor(f.page.id, f.block.id)).toEqual([
      expect.objectContaining({ entity: "page", draftId: null, locale: "de" }),
    ]);
  });
});

describe("the meta title blocker per locale", () => {
  it("warns while a de page's SEO is being generated, and blocks once it generated no meta title", async () => {
    const f = await fixture();
    const pending = await f.preview();
    expect(pending.blockers).toEqual([]);
    expect(pending.warnings).toEqual([
      expect.objectContaining({ id: f.page.id, locale: "de", code: "metaTitlePending" }),
    ]);

    await f.generateSeo("de", { metaTitle: "", metaDescription: "" });

    expect((await f.preview()).blockers).toEqual([
      expect.objectContaining({ id: f.page.id, locale: "de", code: "missingMetaTitle" }),
    ]);
  });
});
