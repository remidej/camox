import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { drafts, pages, projects } from "../../schema";

const now = 1_700_000_000_000;
const customImage = "https://api.camox.ai/files/serve/7/page-og/custom.png";

async function fixture() {
  const base = await createProjectFixture(`homepage-og-${crypto.randomUUID()}`);
  const homepage = (values: Partial<typeof pages.$inferInsert> = {}) =>
    base.db
      .insert(pages)
      .values({
        projectId: base.project.id,
        layoutId: base.layout.layoutId,
        pathSegment: "",
        fullPath: "/",
        nickname: "Home",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
        ...values,
      })
      .returning()
      .get();
  /** The homepage OG image URL of each entry the project list has for the project. */
  const listedImages = async () => {
    const list = await call(
      router.projects.list,
      { organizationId: base.project.organizationId },
      { context: createRpcContext(base.db, base.memberUser) },
    );
    return list
      .filter((project) => project.id === base.project.id)
      .map((project) => project.homepageOgImageUrl);
  };
  const generated = `https://${base.project.slug}.camox.site/og?path=%2F`;
  return { ...base, homepage, listedImages, generated };
}

describe("The project list's homepage OG image", () => {
  it("is the website's generated image when the Live homepage has no custom one", async () => {
    const f = await fixture();
    await f.homepage();

    expect(await f.listedImages()).toEqual([f.generated]);
  });

  it("is generated at the project's Custom Domain when it has one", async () => {
    const f = await fixture();
    const customDomain = `${f.project.slug}.example`;
    await f.db.update(projects).set({ customDomain }).where(eq(projects.id, f.project.id));
    await f.homepage();

    expect(await f.listedImages()).toEqual([`https://${customDomain}/og?path=%2F`]);
  });

  it("is the Live homepage's custom image when it has one", async () => {
    const f = await fixture();
    await f.homepage({
      customOgImageBlobId: "7/page-og/custom.png",
      customOgImageUrl: customImage,
    });

    expect(await f.listedImages()).toEqual([customImage]);
  });

  it("ignores a custom image only a draft's copy of the homepage has", async () => {
    const f = await fixture();
    const live = await f.homepage();
    const draft = await f.db
      .insert(drafts)
      .values({
        projectId: f.project.id,
        createdBy: f.memberUser.id,
        createdAt: now,
      })
      .returning()
      .get();
    await f.homepage({
      id: live.id,
      draftId: draft.id,
      baseVersion: live.version,
      customOgImageBlobId: "7/page-og/custom.png",
      customOgImageUrl: customImage,
    });

    expect(await f.listedImages()).toEqual([f.generated]);
  });

  it("ignores a custom image on the homepage of a locale other than the Default Locale", async () => {
    const f = await fixture();
    await f.homepage();
    await f.homepage({
      locale: "zz",
      customOgImageBlobId: "7/page-og/custom.png",
      customOgImageUrl: customImage,
    });

    expect(await f.listedImages()).toEqual([f.generated]);
  });

  it("lists the project once even when Live has two homepages in the Default Locale", async () => {
    const f = await fixture();
    // Nothing in the schema keeps a path unique, so the list can't rely on it.
    await f.homepage();
    await f.homepage();

    expect(await f.listedImages()).toEqual([f.generated]);
  });
});
