import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { environments, pages } from "../../schema";
import { callTool } from "../agent/service";
import { executePageSeo } from "./ai";
import { getPage, publishPage, updatePage } from "./service";

const { chat, scheduleAiJob } = vi.hoisted(() => {
  vi.resetModules();
  return { chat: vi.fn(), scheduleAiJob: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@tanstack/ai", () => ({ chat }));
vi.mock("../../lib/schedule-ai-job", () => ({ scheduleAiJob }));

afterEach(() => vi.clearAllMocks());

async function fixture() {
  const base = await createProjectFixture(crypto.randomUUID());
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
      layoutId: base.layout.id,
      pathSegment: "about",
      fullPath: "/about",
      nickname: "About",
      metaTitle: "Original",
      metaDescription: "Original description",
      aiSeoEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contentUpdatedAt: Date.now(),
    })
    .returning()
    .get();
  return { ...base, page, ctx: createServiceContext(base.db, base.memberUser) };
}

describe("page SEO updates", () => {
  it("resolves tool paths and rejects IDs outside the selected project or environment", async () => {
    const { db, ctx, page, project } = await fixture();
    const update = (arguments_: Record<string, unknown>, projectId = project.id, context = ctx) =>
      callTool(context, { projectId, name: "updatePage", arguments: arguments_ });
    expect(await update({ path: "/about", metaTitle: "By path" })).toMatchObject({
      ok: true,
      result: { id: page.id, metaTitle: "By path", aiSeoEnabled: false },
    });
    expect(await update({ id: page.id, metaDescription: "By ID" })).toMatchObject({
      ok: true,
      result: { metaDescription: "By ID" },
    });
    for (const target of [{}, { id: page.id, path: "/about" }]) {
      expect(await update({ ...target, metaTitle: "Invalid" })).toMatchObject({ ok: false });
    }
    expect(await update({ path: "/missing", metaTitle: "Missing" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const other = await fixture();
    expect(await update({ id: other.page.id, metaTitle: "Wrong project" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const devName = `dev:${ctx.user!.email}`;
    await db.insert(environments).values({
      projectId: project.id,
      name: devName,
      type: "development",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(
      await update({ id: page.id, metaTitle: "Wrong environment" }, project.id, {
        ...ctx,
        environmentName: devName,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await getPage(ctx, { id: page.id })).toMatchObject({
      metaTitle: "By path",
      metaDescription: "By ID",
    });
  });
  it("updates manual metadata atomically, preserves omitted fields and leaves live metadata unchanged", async () => {
    const { ctx, page } = await fixture();
    await publishPage(ctx, { id: page.id });
    const updated = await updatePage(ctx, { id: page.id, metaTitle: "Manual" });
    expect(updated).toMatchObject({
      metaTitle: "Manual",
      metaDescription: "Original description",
      aiSeoEnabled: false,
    });
    expect(await getPage(ctx, { id: page.id, source: "live" })).toMatchObject({
      metaTitle: "Original",
      aiSeoEnabled: true,
    });
    expect(await updatePage(ctx, { id: page.id, metaDescription: "" })).toMatchObject({
      metaTitle: "Manual",
      metaDescription: "",
      aiSeoEnabled: false,
    });
    expect(
      await updatePage(ctx, { id: page.id, metaTitle: "Both", metaDescription: "Together" }),
    ).toMatchObject({ metaTitle: "Both", metaDescription: "Together", aiSeoEnabled: false });
    expect(scheduleAiJob).not.toHaveBeenCalled();
  });

  it("enables AI asynchronously and disables it without clearing metadata", async () => {
    const { ctx, page } = await fixture();
    const waitUntil = vi.fn();
    ctx.waitUntil = waitUntil;
    expect(await updatePage(ctx, { id: page.id, aiSeoEnabled: false })).toMatchObject({
      aiSeoEnabled: false,
      metaTitle: "Original",
    });
    expect(scheduleAiJob).not.toHaveBeenCalled();
    expect(await updatePage(ctx, { id: page.id, aiSeoEnabled: true })).toMatchObject({
      aiSeoEnabled: true,
      metaTitle: "Original",
    });
    expect(scheduleAiJob).toHaveBeenCalledWith(ctx.env.AI_JOB_SCHEDULER, {
      entityTable: "pages",
      entityId: page.id,
      type: "seo",
      delayMs: 0,
    });
    expect(scheduleAiJob).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(scheduleAiJob.mock.results[0]!.value);
  });

  it("rejects empty updates, conflicts and unauthorized edits without changing the row", async () => {
    const { ctx, db, page, outsiderUser } = await fixture();
    for (const input of [
      { id: page.id },
      { id: page.id, metaTitle: "", aiSeoEnabled: true },
      { id: page.id, metaDescription: "Manual", aiSeoEnabled: true },
    ]) {
      await expect(updatePage(ctx, input)).rejects.toThrow();
    }
    await expect(
      updatePage(createServiceContext(db, outsiderUser), { id: page.id, metaTitle: "Forbidden" }),
    ).rejects.toThrow();
    expect(await db.select().from(pages).where(eq(pages.id, page.id)).get()).toEqual(page);
  });

  it.each([true, null])("allows generation when automatic SEO is %s", async (aiSeoEnabled) => {
    const { db, page } = await fixture();
    await db.update(pages).set({ aiSeoEnabled }).where(eq(pages.id, page.id));
    chat.mockResolvedValue({ metaTitle: "Generated", metaDescription: "Generated description" });
    await executePageSeo(db, "test-key", page.id);
    expect(await db.select().from(pages).where(eq(pages.id, page.id)).get()).toMatchObject({
      metaTitle: "Generated",
    });
  });

  it.each(["manual", "disable", "revision", "content"])(
    "does not overwrite an in-flight %s change",
    async (change) => {
      const { db, ctx, page } = await fixture();
      chat.mockImplementationOnce(async () => {
        if (change === "manual") await updatePage(ctx, { id: page.id, metaTitle: "Manual" });
        if (change === "disable") await updatePage(ctx, { id: page.id, aiSeoEnabled: false });
        if (change === "revision") await updatePage(ctx, { id: page.id, nickname: "Renamed" });
        if (change === "content")
          await db
            .update(pages)
            .set({ contentUpdatedAt: page.contentUpdatedAt + 1 })
            .where(eq(pages.id, page.id));
        return { metaTitle: "Stale generated title", metaDescription: "Stale description" };
      });
      await executePageSeo(db, "test-key", page.id);
      expect(chat).toHaveBeenCalledOnce();
      expect(await db.select().from(pages).where(eq(pages.id, page.id)).get()).toMatchObject({
        metaTitle: change === "manual" ? "Manual" : "Original",
        metaDescription: "Original description",
      });
    },
  );
});
