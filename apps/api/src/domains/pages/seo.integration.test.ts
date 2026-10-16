import { generateUuidv7 } from "@camox/api-contract/ids";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { drafts, pages } from "../../schema";
import { callTool } from "../agent/service";
import { executePageSeo } from "./ai";
import { getPage } from "./service";

const { chat, scheduleAiJob } = vi.hoisted(() => {
  vi.resetModules();
  return { chat: vi.fn(), scheduleAiJob: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@tanstack/ai", () => ({ chat }));
vi.mock("../../lib/schedule-ai-job", () => ({ scheduleAiJob }));

afterEach(() => {
  vi.clearAllMocks();
  chat.mockReset();
});

async function fixture() {
  const base = await createProjectFixture(crypto.randomUUID());
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      layoutId: base.layout.layoutId,
      pathSegment: "about",
      fullPath: "/about",
      nickname: "About",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contentUpdatedAt: Date.now(),
    })
    .returning()
    .get();
  // AI tools write content, so the page's SEO is set, generated and read in a draft: Live is
  // read-only.
  const scope = {
    id: generateUuidv7(),
    kind: "regular" as const,
    projectId: base.project.id,
  };
  await base.db.insert(drafts).values({
    id: scope.id,
    projectId: scope.projectId,
    kind: scope.kind,
    createdBy: base.memberUser.id,
    createdAt: Date.now(),
  });
  const ctx = {
    ...createServiceContext(base.db, base.memberUser),
    draft: { id: scope.id, create: false },
  };
  const generate = async (seo: { metaTitle: string; metaDescription: string }) => {
    chat.mockResolvedValueOnce(seo);
    await runService(executePageSeo(base.db, "test-key", page.id, scope));
  };
  const tool = (name: string, arguments_: Record<string, unknown>, context = ctx) =>
    runService(callTool(context, { projectId: base.project.id, name, arguments: arguments_ }));
  return { ...base, page, ctx, scope, generate, tool };
}

describe("setPageSeo", () => {
  it("sets either field by path or id, making the page's SEO manual", async () => {
    const { ctx, page, scope, generate, tool } = await fixture();
    await generate({ metaTitle: "Generated", metaDescription: "Generated description" });

    expect(await tool("setPageSeo", { path: "/about", metaDescription: "Manual" })).toMatchObject({
      ok: true,
      result: {
        id: page.id,
        metaTitle: "Generated",
        metaDescription: "Manual",
        aiSeo: false,
      },
    });
    expect(
      await tool("setPageSeo", { id: page.id, metaTitle: "Both", metaDescription: "Together" }),
    ).toMatchObject({ ok: true, result: { metaTitle: "Both", metaDescription: "Together" } });
    expect(await runService(getPage(ctx, { id: page.id }, scope))).toMatchObject({
      metaTitle: "Both",
      metaDescription: "Together",
      aiSeo: false,
    });
  });

  it("makes the page's SEO generated again, requesting it", async () => {
    const { page, tool } = await fixture();
    await tool("setPageSeo", { id: page.id, metaTitle: "Manual" });

    expect(await tool("setPageSeo", { id: page.id, aiSeo: true })).toMatchObject({
      ok: true,
      result: { aiSeo: true, metaTitle: null },
    });
    expect(scheduleAiJob).toHaveBeenCalledOnce();
  });

  it("rejects empty or conflicting input, and pages outside the project", async () => {
    const { page, tool } = await fixture();
    for (const input of [
      { id: page.id },
      { id: page.id, path: "/about", metaTitle: "Both targets" },
      { id: page.id, metaTitle: "Manual", aiSeo: true },
    ]) {
      expect(await tool("setPageSeo", input)).toMatchObject({ ok: false });
    }
    expect(await tool("setPageSeo", { path: "/missing", metaTitle: "Missing" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const other = await fixture();
    expect(await tool("setPageSeo", { id: other.page.id, metaTitle: "Elsewhere" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("replaces the separate meta title and description tools", async () => {
    const { page, tool } = await fixture();
    for (const name of ["setPageMetaTitle", "setPageMetaDescription"]) {
      expect(await tool(name, { id: page.id, metaTitle: "Old" })).toMatchObject({ ok: false });
    }
    expect(await tool("updatePage", { id: page.id, metaTitle: "Old" })).toMatchObject({
      ok: false,
    });
  });
});

describe("page SEO generation", () => {
  it("skips a page whose SEO is manual", async () => {
    const { ctx, page, scope, generate, tool } = await fixture();
    await tool("setPageSeo", { id: page.id, metaTitle: "Manual", metaDescription: "Manual" });

    await generate({ metaTitle: "Generated", metaDescription: "Generated" });

    expect(chat).not.toHaveBeenCalled();
    expect(await runService(getPage(ctx, { id: page.id }, scope))).toMatchObject({
      metaTitle: "Manual",
    });
  });
});
